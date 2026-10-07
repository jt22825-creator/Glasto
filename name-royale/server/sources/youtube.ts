// YouTube live chat source. Built in stage 3.
import type { ChatEvent, ChatSource } from './types.ts';

export class YouTubeSource implements ChatSource {
  readonly name = 'youtube';

  async start(_emit: (event: ChatEvent) => void): Promise<void> {
    throw new Error('YouTube chat is not built yet (stage 3). Use "npm run sim" for now.');
  }

  stop(): void {}
}
