// Talks to OBS's built-in WebSocket server (OBS 28 and newer) to stop the
// stream. Only two requests are used: GetStreamStatus and StopStream.
// Protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { secretsDir } from './paths.ts';

const TIMEOUT_MS = 5000;

/** The OBS WebSocket password, from secrets/obs-password.txt (empty if OBS has authentication turned off). */
function obsPassword(): string {
  const p = join(secretsDir(), 'obs-password.txt');
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : '';
}

const sha256b64 = (s: string) => createHash('sha256').update(s).digest('base64');

/** Connect, log in, run `fn`, disconnect. */
async function withObs<T>(url: string, fn: (request: (type: string) => Promise<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const ws = new WebSocket(url);
  const pending = new Map<string, { resolve: (d: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  let identified: () => void;
  let failed: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    identified = res;
    failed = rej;
  });
  const timer = setTimeout(() => failed(new Error(`no answer from OBS at ${url}`)), TIMEOUT_MS);

  ws.on('error', (err) => failed(new Error(`can't reach OBS at ${url} (${err.message})`)));
  ws.on('close', (code, reason) => {
    const e = new Error(code === 4009 ? 'OBS rejected the password (check secrets/obs-password.txt)' : `OBS closed the connection (${code} ${reason})`);
    failed(e);
    for (const p of pending.values()) p.reject(e);
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as { op: number; d: Record<string, any> };
    if (msg.op === 0) {
      // Hello: answer with Identify, plus the auth string if OBS asks for one.
      const auth = msg.d.authentication as { challenge: string; salt: string } | undefined;
      const d: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: 0 };
      if (auth) d.authentication = sha256b64(sha256b64(obsPassword() + auth.salt) + auth.challenge);
      ws.send(JSON.stringify({ op: 1, d }));
    } else if (msg.op === 2) {
      identified();
    } else if (msg.op === 7) {
      const p = pending.get(msg.d.requestId);
      pending.delete(msg.d.requestId);
      if (!p) return;
      const status = msg.d.requestStatus as { result: boolean; code: number; comment?: string };
      if (status.result) p.resolve(msg.d.responseData ?? {});
      else p.reject(new Error(`OBS refused ${msg.d.requestType}: ${status.comment ?? status.code}`));
    }
  });

  try {
    await ready;
    const request = (requestType: string) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const requestId = randomUUID();
        pending.set(requestId, { resolve, reject });
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId } }));
        setTimeout(() => reject(new Error(`OBS didn't answer ${requestType}`)), TIMEOUT_MS);
      });
    return await fn(request);
  } finally {
    clearTimeout(timer);
    ws.removeAllListeners('close');
    ws.close();
  }
}

/** Check we can talk to OBS. Returns whether it is currently streaming. */
export async function obsStatus(url: string): Promise<{ streaming: boolean }> {
  return withObs(url, async (request) => ({ streaming: Boolean((await request('GetStreamStatus')).outputActive) }));
}

/** Stop the OBS stream. Returns a short description of what happened. */
export async function stopObsStream(url: string): Promise<string> {
  return withObs(url, async (request) => {
    const status = await request('GetStreamStatus');
    if (!status.outputActive) return 'OBS was not streaming';
    await request('StopStream');
    return 'OBS stream stopped';
  });
}
