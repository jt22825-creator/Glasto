// Signs in to your Google account (read-only YouTube access) and keeps the
// sign-in fresh. Uses the "Desktop app" OAuth flow: the server opens Google's
// sign-in page in your browser, Google sends the browser back to a temporary
// page on this computer, and the server saves the resulting token in
// secrets/token.json so you don't need to sign in every time.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { ensureDir, secretsDir } from '../paths.ts';

export const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = (): string => process.env.NR_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface ClientSecret {
  client_id: string;
  client_secret: string;
}

interface SavedToken {
  refresh_token: string;
  access_token?: string;
  /** Milliseconds since 1970 when access_token stops working. */
  expires_at?: number;
}

export class SetupError extends Error {}

export class GoogleAuth {
  private clientPath = join(secretsDir(), 'client_secret.json');
  private tokenPath = join(secretsDir(), 'token.json');
  private token: SavedToken | undefined;
  private refreshing: Promise<string> | undefined;

  private client(): ClientSecret {
    if (!existsSync(this.clientPath)) {
      throw new SetupError(
        `Missing ${this.clientPath}.\n` +
          'Follow README section 3 to create a "Desktop app" OAuth client, download its JSON, and save it there as client_secret.json.',
      );
    }
    let raw: { installed?: ClientSecret; web?: ClientSecret };
    try {
      raw = JSON.parse(readFileSync(this.clientPath, 'utf8'));
    } catch {
      throw new SetupError(`${this.clientPath} isn't valid JSON. Download it again from Google Cloud.`);
    }
    if (raw.web && !raw.installed) {
      throw new SetupError('client_secret.json is for a "Web application" client. Create a "Desktop app" client instead (README section 3d).');
    }
    if (!raw.installed?.client_id || !raw.installed.client_secret) {
      throw new SetupError(`${this.clientPath} doesn't look like a Google OAuth client file.`);
    }
    return raw.installed;
  }

  /** Make sure we have a working sign-in, opening the browser if needed. */
  async ensure(): Promise<void> {
    this.client(); // fail early with a clear message if the file is missing
    if (!this.token && existsSync(this.tokenPath)) {
      try {
        this.token = JSON.parse(readFileSync(this.tokenPath, 'utf8')) as SavedToken;
      } catch {
        this.token = undefined;
      }
    }
    if (!this.token?.refresh_token) {
      await this.login();
      return;
    }
    await this.accessToken();
  }

  /** A valid access token, refreshed automatically shortly before it expires. */
  async accessToken(): Promise<string> {
    if (!this.token) await this.ensure();
    const t = this.token!;
    if (t.access_token && t.expires_at && t.expires_at - Date.now() > 60_000) return t.access_token;
    this.refreshing ??= this.refresh().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  /** Force a refresh on the next request (e.g. after YouTube says the token was rejected). */
  invalidate(): void {
    if (this.token) this.token.expires_at = 0;
  }

  private async refresh(): Promise<string> {
    const { client_id, client_secret } = this.client();
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id, client_secret, refresh_token: this.token!.refresh_token, grant_type: 'refresh_token' }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (body.error === 'invalid_grant') {
      // Revoked, or expired (sign-ins expire after 7 days while the app is in "Testing").
      console.warn('[youtube] Your Google sign-in has expired. Opening the sign-in page again...');
      rmSync(this.tokenPath, { force: true });
      this.token = undefined;
      await this.login();
      return this.token!.access_token!;
    }
    if (!res.ok || !body.access_token) throw new Error(`Token refresh failed (${res.status} ${body.error ?? ''})`);
    this.token = { ...this.token!, access_token: body.access_token, expires_at: Date.now() + (body.expires_in ?? 3600) * 1000 };
    this.save();
    return body.access_token;
  }

  private save(): void {
    ensureDir(secretsDir());
    writeFileSync(this.tokenPath, JSON.stringify(this.token, null, 2), { mode: 0o600 });
  }

  /** Browser sign-in. Resolves once Google redirects back with a code and we've exchanged it. */
  async login(): Promise<void> {
    const { client_id, client_secret } = this.client();
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('hex');

    const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const error = url.searchParams.get('error');
        const gotCode = url.searchParams.get('code');
        const ok = !error && gotCode && url.searchParams.get('state') === state;
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          `<body style="font-family:sans-serif;background:#16132d;color:#fff;display:grid;place-items:center;height:100vh;margin:0">` +
            `<h1>${ok ? 'Signed in. You can close this tab.' : `Sign-in failed: ${error ?? 'unexpected response'}`}</h1></body>`,
        );
        clearTimeout(timer);
        server.close();
        if (ok) resolve({ code: gotCode, redirectUri });
        else reject(new SetupError(`Google sign-in failed: ${error ?? 'state mismatch'}`));
      });
      let redirectUri = '';
      const timer = setTimeout(() => {
        server.close();
        reject(new SetupError('Timed out waiting for Google sign-in (5 minutes). Run the command again.'));
      }, LOGIN_TIMEOUT_MS);
      server.listen(0, '127.0.0.1', () => {
        redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
        const url =
          `${AUTH_URL}?` +
          new URLSearchParams({
            client_id,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: SCOPE,
            access_type: 'offline',
            prompt: 'consent',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
          });
        console.log('\n[youtube] Sign in with the Google account that owns your channel.');
        console.log('[youtube] Your browser should open. If it doesn\'t, copy this link into it:\n');
        console.log(`  ${url}\n`);
        openBrowser(url);
      });
    });

    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code.code,
        client_id,
        client_secret,
        redirect_uri: code.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.refresh_token || !body.access_token) {
      throw new SetupError(`Could not finish sign-in: ${body.error_description ?? body.error ?? res.status}`);
    }
    this.token = { refresh_token: body.refresh_token, access_token: body.access_token, expires_at: Date.now() + (body.expires_in ?? 3600) * 1000 };
    this.save();
    console.log('[youtube] Signed in. Saved to secrets/token.json.');
  }
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // The link is printed above, so the user can open it by hand.
  }
}
