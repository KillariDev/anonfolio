import { readResponseBytes } from './response-body';
import { withDeadline } from './deadline';
export const BOOTSTRAP_MAX_BYTES = 8 * 1024 * 1024;
export const BOOTSTRAP_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const boundedBytes = (response: Response, limit: number) => readResponseBytes(response, limit, 'Bootstrap');
// Public Tor directory only. A missing/stale mirror is optional; Tor can obtain
// and verify directory data from its gateways. Arti authenticates the archive.
export async function loadTorBootstrap(manifestUrl: string, signal: AbortSignal, progress: (message: string) => void,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch, base = document.baseURI): Promise<Uint8Array | undefined> {
  if (!manifestUrl) return;
  const manifest = new URL(manifestUrl, base);
  if (manifest.username || manifest.password || manifest.hash || (manifest.protocol !== 'https:' && manifest.origin !== new URL(base).origin)) throw new Error('Bootstrap mirror must use HTTPS.');
  try {
    return await withDeadline(async requestSignal => {
      progress('Loading public Tor directory mirror from ' + manifest.hostname + '. No wallet addresses are sent.');
      const options: RequestInit = { signal: requestSignal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' };
      const data = JSON.parse(new TextDecoder().decode(await boundedBytes(await fetcher(manifest.href, options), 4096)));
      if (data.version !== 1 || !Number.isFinite(data.updatedAt) || Date.now() - data.updatedAt > BOOTSTRAP_MAX_AGE_MS
        || data.updatedAt > Date.now() + 60_000 || typeof data.archive !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error('Stale or invalid Tor directory manifest.');
      const archive = new URL(data.archive, manifest);
      if (archive.origin !== manifest.origin || archive.username || archive.password || archive.hash) throw new Error('Tor directory archive must share the mirror origin.');
      const bytes = await boundedBytes(await fetcher(archive.href, options), BOOTSTRAP_MAX_BYTES);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (!bytes.length || digest !== data.sha256) throw new Error('Tor directory archive digest mismatch.');
      progress('Public Tor directory mirror loaded; Tor will verify directory signatures.');
      return bytes;
    }, 8000, 'Tor directory mirror timed out.', signal);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    progress('Tor directory mirror unavailable; using the saved directory or configured gateways.');
    return undefined;
  }
}
export function torStartupStage(message: string): string | undefined {
  if (/could not connect to guard|guard.*(?:connecting|failed|retrying)/i.test(message)) return 'Connecting to a Tor guard…';
  if (/bootstrap\.zip|directory.*(?:download|fetch)|microdesc|consensus.*(?:download|fetch)/i.test(message)) return 'Loading Tor directory…';
  if (/circuit.*(?:building|launch|extend)/i.test(message)) return 'Building a Tor circuit…';
  if (/gateway.*(?:dial|connect)|(?:dial|connect).*gateway|webrtc|ice.*(?:failed|checking)/i.test(message)) return 'Connecting to Tor gateways…';
  return undefined;
}
