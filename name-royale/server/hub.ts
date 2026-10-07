// WebSocket server that the game page connects to. Usually there is one
// client (the OBS browser source), but a preview tab can connect too.
import { WebSocketServer, type WebSocket } from 'ws';
import type { GameToServer, ServerToGame } from '../shared/protocol.ts';

export class Hub {
  private wss: WebSocketServer;
  private onConnect: (send: (msg: ServerToGame) => void) => void = () => {};
  private onMessage: (msg: GameToServer) => void = () => {};

  constructor(port: number) {
    // Only accept connections from this computer.
    this.wss = new WebSocketServer({ port, host: '127.0.0.1' });
    this.wss.on('listening', () => console.log(`[hub] Waiting for the game on ws://localhost:${port}`));
    this.wss.on('error', (err) => {
      console.error(`[hub] ${err.message}. Is another copy of the server already running?`);
      process.exit(1);
    });
    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`[hub] Game connected (${this.wss.clients.size} open)`);
      this.onConnect((msg) => ws.send(JSON.stringify(msg)));
      ws.on('message', (data) => {
        try {
          this.onMessage(JSON.parse(String(data)) as GameToServer);
        } catch {
          console.warn('[hub] Ignored a malformed message from the game');
        }
      });
      ws.on('close', () => console.log(`[hub] Game disconnected (${this.wss.clients.size} open)`));
    });
  }

  handleConnect(fn: (send: (msg: ServerToGame) => void) => void): void {
    this.onConnect = fn;
  }

  handleMessage(fn: (msg: GameToServer) => void): void {
    this.onMessage = fn;
  }

  broadcast(msg: ServerToGame): void {
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) if (client.readyState === client.OPEN) client.send(data);
  }

  close(): void {
    this.wss.close();
  }
}
