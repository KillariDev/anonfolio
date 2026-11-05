import { errorMessage } from '../errors';
// Local application asset only; this does not carry wallet or consensus traffic.
export async function downloadVerifier(url: URL, fetcher: (url: URL, init?: RequestInit) => Promise<Response> = fetch) {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.arrayBuffer();
  } catch (error) {
    throw new Error('Helios WASM download from ' + url.hostname + ' failed: ' + errorMessage(error));
  }
}
