import type { PaidEvent, Viewer } from '../../shared/protocol.ts';

/** Something that happened in chat, before the server turns it into a game command. */
export type ChatEvent =
  | { kind: 'text'; viewer: Viewer; text: string }
  | { kind: 'paid'; event: PaidEvent }
  /** The chat source can't continue today (e.g. the YouTube quota is used up). */
  | { kind: 'exhausted'; reason: string };

export interface ChatSource {
  readonly name: string;
  start(emit: (event: ChatEvent) => void): Promise<void>;
  stop(): void;
}
