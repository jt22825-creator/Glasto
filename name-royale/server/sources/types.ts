import type { PaidEvent, Viewer } from '../../shared/protocol.ts';

/** Something that happened in chat, before the server turns it into a game command. */
export type ChatEvent =
  | { kind: 'text'; viewer: Viewer; text: string }
  | { kind: 'paid'; event: PaidEvent };

export interface ChatSource {
  readonly name: string;
  start(emit: (event: ChatEvent) => void): Promise<void>;
  stop(): void;
}
