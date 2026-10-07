// Connection to the Node server. Reconnects forever, because OBS may start
// the browser source before the server is running.
import type { GameToServer, ServerToGame } from '../shared/protocol.ts';

export type ConnectionState = 'connecting' | 'open' | 'closed';

export class Net {
  private ws: WebSocket | undefined;
  private listeners = new Set<(msg: ServerToGame) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private url: string;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.url = params.get('ws') ?? `ws://${window.location.hostname || 'localhost'}:8787`;
    this.connect();
  }

  private connect(): void {
    this.emitState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => this.emitState('open');
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerToGame;
      for (const fn of this.listeners) fn(msg);
    };
    ws.onclose = () => {
      this.emitState('closed');
      setTimeout(() => this.connect(), 2000);
    };
  }

  private emitState(state: ConnectionState): void {
    for (const fn of this.stateListeners) fn(state);
  }

  onMessage(fn: (msg: ServerToGame) => void): void {
    this.listeners.add(fn);
  }

  onState(fn: (state: ConnectionState) => void): void {
    this.stateListeners.add(fn);
  }

  send(msg: GameToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
