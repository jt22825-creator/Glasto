// WebSocket server that the game page connects to. Usually there is one
// client (the OBS browser source), but a preview tab can connect too.
// The first screen to connect is "primary": only its round results are
// recorded. If it disconnects, the next oldest screen takes over.
import { WebSocketServer, type WebSocket } from 'ws';
import type { GameToServer, ServerToGame } from '../shared/protocol.ts';

export type Send = (msg: ServerToGame) => void;

export class Hub {
  private wss: WebSocketServer;
  private clients: WebSocket[] = [];
  private onConnect: (send: Send, primary: boolean) => void = () => {};
  private onMessage: (msg: GameToServer, fromPrimary: boolean) => void = () => {};

  constructor(port: number) {
    // Only accept connections from this computer.
    this.wss = new WebSocketServer({ port, host: '127.0.0.1' });
    this.wss.on('listening', () => console.log(`[hub] Waiting for the game on ws://localhost:${port}`));
    this.wss.on('error', (err) => {
      console.error(`[hub] ${err.message}. Is another copy of the server already running?`);
      process.exit(1);
    });
    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.push(ws);
      const primary = this.clients[0] === ws;
      console.log(`[hub] Game connected (${this.clients.length} open${primary ? ', primary' : ', preview only'})`);
      this.onConnect((msg) => send(ws, msg), primary);
      ws.on('message', (data) => {
        let msg: GameToServer;
        try {
          msg = JSON.parse(String(data)) as GameToServer;
        } catch {
          console.warn('[hub] Ignored a malformed message from the game');
          return;
        }
        this.onMessage(msg, this.clients[0] === ws);
      });
      ws.on('close', () => {
        const wasPrimary = this.clients[0] === ws;
        this.clients = this.clients.filter((c) => c !== ws);
        console.log(`[hub] Game disconnected (${this.clients.length} open)`);
        if (wasPrimary && this.clients[0]) {
          send(this.clients[0], { type: 'role', primary: true });
          console.log('[hub] Another open screen is now primary');
        }
      });
    });
  }

  handleConnect(fn: (send: Send, primary: boolean) => void): void {
    this.onConnect = fn;
  }

  handleMessage(fn: (msg: GameToServer, fromPrimary: boolean) => void): void {
    this.onMessage = fn;
  }

  broadcast(msg: ServerToGame): void {
    for (const ws of this.clients) send(ws, msg);
  }

  close(): void {
    this.wss.close();
  }
}

function send(ws: WebSocket, msg: ServerToGame): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
