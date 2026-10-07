// npm test: stopping the stream through a fake OBS WebSocket server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WebSocketServer } from 'ws';

const PASSWORD = 'hunter2';
const b64 = (s: string) => createHash('sha256').update(s).digest('base64');
let wss: WebSocketServer;
let url: string;
let streaming = true;
const requests: string[] = [];

describe('OBS control', () => {
  before(async () => {
    const secrets = mkdtempSync(join(tmpdir(), 'nr-obs-'));
    process.env.NR_SECRETS_DIR = secrets;
    writeFileSync(join(secrets, 'obs-password.txt'), `${PASSWORD}\n`);

    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss.on('listening', r));
    url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
    wss.on('connection', (ws) => {
      const salt = 'salty', challenge = 'chally';
      ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1, authentication: { salt, challenge } } }));
      ws.on('message', (raw) => {
        const { op, d } = JSON.parse(String(raw));
        if (op === 1) {
          if (d.authentication !== b64(b64(PASSWORD + salt) + challenge)) return ws.close(4009, 'Authentication failed.');
          ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        } else if (op === 6) {
          requests.push(d.requestType);
          const ok = { result: true, code: 100 };
          if (d.requestType === 'GetStreamStatus') ws.send(JSON.stringify({ op: 7, d: { ...d, requestStatus: ok, responseData: { outputActive: streaming } } }));
          else if (d.requestType === 'StopStream') {
            streaming = false;
            ws.send(JSON.stringify({ op: 7, d: { ...d, requestStatus: ok } }));
          }
        }
      });
    });
  });
  after(() => wss.close());

  it('logs in with the password and stops the stream', async () => {
    const { obsStatus, stopObsStream } = await import('../server/obs.ts');
    assert.deepEqual(await obsStatus(url), { streaming: true });
    assert.equal(await stopObsStream(url), 'OBS stream stopped');
    assert.equal(await stopObsStream(url), 'OBS was not streaming');
    assert.deepEqual(requests, ['GetStreamStatus', 'GetStreamStatus', 'StopStream', 'GetStreamStatus']);
  });

  it('explains a wrong password', async () => {
    writeFileSync(join(process.env.NR_SECRETS_DIR!, 'obs-password.txt'), 'wrong');
    const { obsStatus } = await import('../server/obs.ts');
    await assert.rejects(obsStatus(url), /rejected the password/);
  });

  it('explains when OBS is not running', async () => {
    const { obsStatus } = await import('../server/obs.ts');
    await assert.rejects(obsStatus('ws://127.0.0.1:1'), /can't reach OBS/);
  });
});
