// liveChatMessages.streamList: YouTube pushes new chat messages over a
// long-lived gRPC connection, so there's no polling delay and far less quota
// use than liveChatMessages.list. The server ends the stream from time to
// time; the caller reconnects with the last nextPageToken.
import { fileURLToPath } from 'node:url';
import type { RawChatItem } from './messages.ts';

const PROTO_PATH = fileURLToPath(new URL('./live_chat.proto', import.meta.url));
const target = (): string => process.env.NR_YT_GRPC_TARGET ?? 'youtube.googleapis.com:443';
const insecure = (): boolean => process.env.NR_YT_GRPC_INSECURE === '1'; // only for local tests

export interface StreamResponse {
  items?: RawChatItem[];
  nextPageToken?: string;
  offlineAt?: string;
}

export type StreamEnd =
  | { kind: 'ended' } // the server closed the stream normally; reconnect
  | { kind: 'cancelled' }
  | { kind: 'error'; code: number; codeName: string; message: string };

export interface StreamHandle {
  cancel(): void;
  done: Promise<StreamEnd>;
}

type Grpc = typeof import('@grpc/grpc-js');
type ServiceCtor = new (target: string, creds: import('@grpc/grpc-js').ChannelCredentials) => {
  StreamList(req: object, md: import('@grpc/grpc-js').Metadata): import('@grpc/grpc-js').ClientReadableStream<StreamResponse>;
  close(): void;
};

let loaded: Promise<{ grpc: Grpc; Service: ServiceCtor }> | undefined;

/** Load gRPC lazily, so a problem with it only disables streaming (polling still works). */
function load() {
  loaded ??= (async () => {
    const grpc = await import('@grpc/grpc-js');
    const protoLoader = await import('@grpc/proto-loader');
    const def = protoLoader.loadSync(PROTO_PATH, { keepCase: false, longs: String, enums: String, defaults: false, oneofs: true });
    const pkg = grpc.loadPackageDefinition(def) as unknown as { youtube: { api: { v3: { V3DataLiveChatMessageService: ServiceCtor } } } };
    return { grpc, Service: pkg.youtube.api.v3.V3DataLiveChatMessageService };
  })();
  return loaded;
}

export async function openStream(opts: {
  accessToken: string;
  liveChatId: string;
  pageToken?: string;
  onResponse: (r: StreamResponse) => void;
}): Promise<StreamHandle> {
  const { grpc, Service } = await load();
  const client = new Service(target(), insecure() ? grpc.credentials.createInsecure() : grpc.credentials.createSsl());
  const md = new grpc.Metadata();
  md.add('authorization', `Bearer ${opts.accessToken}`);
  const req: Record<string, unknown> = { liveChatId: opts.liveChatId, part: ['id', 'snippet', 'authorDetails'] };
  if (opts.pageToken) req.pageToken = opts.pageToken;

  const call = client.StreamList(req, md);
  let cancelled = false;
  const done = new Promise<StreamEnd>((resolve) => {
    call.on('data', (r: StreamResponse) => opts.onResponse(r));
    call.on('end', () => resolve(cancelled ? { kind: 'cancelled' } : { kind: 'ended' }));
    call.on('error', (err: { code?: number; details?: string; message?: string }) => {
      const code = err.code ?? -1;
      if (cancelled || code === grpc.status.CANCELLED) resolve({ kind: 'cancelled' });
      else resolve({ kind: 'error', code, codeName: grpc.status[code] ?? String(code), message: err.details ?? err.message ?? '' });
    });
  }).finally(() => client.close());

  return {
    cancel() {
      cancelled = true;
      call.cancel();
    },
    done,
  };
}

/** gRPC status codes we react to (numbers are fixed by the gRPC spec). */
export const GrpcCode = {
  INVALID_ARGUMENT: 3,
  NOT_FOUND: 5,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  UNIMPLEMENTED: 12,
  UNAUTHENTICATED: 16,
} as const;
