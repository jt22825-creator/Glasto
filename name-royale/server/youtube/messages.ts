// Turns YouTube chat messages into Name Royale chat events. Handles both
// formats: REST (liveChatMessages.list, type "textMessageEvent") and the
// gRPC stream (streamList, type "TEXT_MESSAGE_EVENT"). Field names are the
// same in both once the gRPC client converts them to camelCase.
import type { ChatEvent } from '../sources/types.ts';

export interface RawChatItem {
  id?: string;
  snippet?: {
    type?: string | number;
    publishedAt?: string;
    displayMessage?: string;
    textMessageDetails?: { messageText?: string };
    superChatDetails?: { amountMicros?: string | number; currency?: string; tier?: number; userComment?: string };
    superStickerDetails?: { amountMicros?: string | number; currency?: string; tier?: number };
    newSponsorDetails?: { memberLevelName?: string; isUpgrade?: boolean };
  };
  authorDetails?: { channelId?: string; displayName?: string };
}

/** "TEXT_MESSAGE_EVENT" and "textMessageEvent" both become "textmessageevent". */
const normType = (t: unknown): string => String(t ?? '').replace(/_/g, '').toLowerCase();

export interface Converted {
  events: ChatEvent[];
  /** The broadcast's chat has closed. */
  chatEnded: boolean;
}

export function convertItem(item: RawChatItem): Converted {
  const type = normType(item.snippet?.type);
  const a = item.authorDetails;
  if (type === 'chatendedevent') return { events: [], chatEnded: true };
  if (!a?.channelId || !a.displayName) return { events: [], chatEnded: false };
  const viewer = { id: a.channelId, name: a.displayName };
  const s = item.snippet!;

  switch (type) {
    case 'textmessageevent': {
      const text = s.textMessageDetails?.messageText ?? s.displayMessage ?? '';
      return { events: text ? [{ kind: 'text', viewer, text }] : [], chatEnded: false };
    }
    case 'superchatevent': {
      const d = s.superChatDetails ?? {};
      const events: ChatEvent[] = [
        { kind: 'paid', event: { kind: 'superChat', viewer, amountMicros: Number(d.amountMicros ?? 0), currency: d.currency ?? '', tier: d.tier ?? 1 } },
      ];
      // A Super Chat's message can also be a command, e.g. "!join".
      if (d.userComment?.trim().startsWith('!')) events.push({ kind: 'text', viewer, text: d.userComment });
      return { events, chatEnded: false };
    }
    case 'superstickerevent': {
      const d = s.superStickerDetails ?? {};
      return {
        events: [{ kind: 'paid', event: { kind: 'superChat', viewer, amountMicros: Number(d.amountMicros ?? 0), currency: d.currency ?? '', tier: d.tier ?? 1 } }],
        chatEnded: false,
      };
    }
    case 'newsponsorevent':
      return { events: [{ kind: 'paid', event: { kind: 'sponsor', viewer } }], chatEnded: false };
    default:
      return { events: [], chatEnded: false };
  }
}

/** Remembers recent message IDs so nothing is handled twice (e.g. after reconnecting). */
export class SeenIds {
  private ids = new Set<string>();
  private order: string[] = [];
  private max: number;

  constructor(max = 5000) {
    this.max = max;
  }

  /** True the first time an ID is seen. */
  add(id: string | undefined): boolean {
    if (!id) return true;
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    this.order.push(id);
    if (this.order.length > this.max) this.ids.delete(this.order.shift()!);
    return true;
  }
}
