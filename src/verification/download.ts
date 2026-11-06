import { readResponseBytes } from '../response-body';
import { withDeadline } from '../deadline';
import { errorMessage } from '../errors';
// Local application asset only; this does not carry wallet or consensus traffic.
export async function downloadVerifier(url: URL, fetcher: (url: URL, init?: RequestInit) => Promise<Response> = fetch) {
  try {
    return await withDeadline(async signal => {
      const response = await fetcher(url, { signal });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('HTTP ' + response.status); }
      return (await readResponseBytes(response, 8 * 1024 * 1024, 'Helios WASM', signal)).buffer;
    }, 90_000, 'Verifier download timed out after 90 seconds.');
  } catch (error) {
    throw new Error('Helios WASM download from ' + url.hostname + ' failed: ' + errorMessage(error));
  }
}
