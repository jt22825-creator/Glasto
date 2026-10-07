// Connection to the Node server. Reconnects forever, because OBS may start
// the browser source before the server is running.
import type { GameToServer, ServerToGame } from '../shared/protocol.ts';

export type ConnectionState = 'connecting' | 'open' | 'closed';

export class Net {
  private ws: WebSocket | undefined;
  private listeners = new Set<(msg: ServerToGame) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  /** Last message of these types, replayed to listeners that subscribe late. */
  private latest = new Map<ServerToGame['type'], ServerToGame>();
  /** Results waiting to be sent while the server is unreachable. */
  private outbox: GameToServer[] = [];
  private url: string;
  state: ConnectionState = 'connecting';

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.url = params.get('ws') ?? `ws://${window.location.hostname || 'localhost'}:8787`;
    this.connect();
  }

  private connect(): void {
    this.setState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.setState('open');
      for (const msg of this.outbox.splice(0)) ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (e) => {
      let msg: ServerToGame;
      try {
        msg = JSON.parse(String(e.data)) as ServerToGame;
      } catch {
        return;
      }
      if (msg.type === 'hello' || msg.type === 'leaderboard') this.latest.set(msg.type, msg);
      for (const fn of this.listeners) fn(msg);
    };
    ws.onclose = () => {
      this.setState('closed');
      setTimeout(() => this.connect(), 2000);
    };
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const fn of this.stateListeners) fn(state);
  }

  onMessage(fn: (msg: ServerToGame) => void): void {
    this.listeners.add(fn);
    for (const msg of this.latest.values()) fn(msg);
  }

  onState(fn: (state: ConnectionState) => void): void {
    this.stateListeners.add(fn);
    fn(this.state);
  }

  send(msg: GameToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.outbox.push(msg);
  }
}
