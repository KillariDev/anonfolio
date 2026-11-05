export type ReadFailure = { message: string; stage?: string; at: number };

export function errorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'No error details were returned.';
  if (error instanceof Error && error.cause) {
    const cause = error.cause instanceof Error ? error.cause.message : typeof error.cause === 'string' ? error.cause : '';
    if (cause && !message.includes(cause)) message += ' · ' + cause;
  }
  // Provider/library errors can echo credential-bearing endpoint URLs. Keep only
  // their origin; the UI identifies the RPC separately by hostname.
  return message.replace(/https?:\/\/[^\s"'<>]+/gi, value => {
    try { const url = new URL(value); return url.origin + (url.pathname !== '/' || url.search || url.hash ? '/[redacted]' : '/'); }
    catch { return '[redacted URL]'; }
  }).replace(/^(?:(?:Error|TypeError|ReferenceError|TimeoutError):\s*)+/i, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 1200) || 'No error details were returned.';
}
export function readFailure(error: unknown, stage?: string): ReadFailure {
  return { message: errorMessage(error), ...(stage ? { stage: errorMessage(stage).slice(0, 600) } : {}), at: Date.now() };
}
export function explainFailure(failure: ReadFailure) {
  const message = failure.message.toLowerCase();
  const context = (failure.stage || '').toLowerCase();
  let summary = failure.message.split('\n')[0]!.slice(0, 90);
  let action = 'Use Refresh to retry. If this keeps happening, check the network and RPC settings.';
  if (/no direct pool qualifies/.test(message)) {
    summary = 'No qualifying direct pool';
    action = 'This asset needs a direct pool against the selected quote token with 30 minutes of history and sufficient liquidity. Check Price estimates in Settings or leave this holding unpriced.';
  } else if (/checkpoint.*(trust window|expired|outside)/.test(message)) {
    summary = 'Consensus checkpoint needs updating';
    action = 'Check your device clock. If it is correct, install an updated application release with a reviewed mainnet checkpoint. Changing RPC or gateway settings cannot renew the checkpoint.';
  } else if (/digest|wasm.*hash|tor worker.*hash/.test(message)) {
    summary = 'Verifier integrity check failed';
    action = 'Reload from a trusted, updated application deployment. The downloaded verifier or Tor worker did not match its pinned hash.';
  } else if (/proof window|historical.*(proof|state)|missing trie node|pruned|archive/.test(message)) {
    summary = 'RPC proof history unavailable';
    action = 'In Settings → Network connection, choose a balance RPC endpoint that supports account and storage proofs at finalized block hashes, then save and reconnect.';
  } else if (/offline/.test(message)) {
    summary = 'Browser is offline';
    action = 'Reconnect to the internet. Pending balance reads retry automatically when the browser comes online.';
  } else if (/wasm download/.test(message)) {
    summary = 'Verifier download failed';
    action = 'Check your connection and reload the application. If the verifier file is missing, use an updated deployment.';
  } else if (/consensus get/.test(message) || (/consensus/.test(context) && /fetch|http|network|timed out/.test(message))) {
    summary = 'Consensus API unavailable';
    action = 'The private beacon request failed before state could be verified. Check your connection and retry. If it persists, the application deployment may need an updated beacon endpoint.';
  } else if (/429|rate.?limit|too many requests/.test(message)) {
    summary = 'RPC rate limit reached';
    action = 'Wait for the automatic retry, or configure another balance RPC endpoint in Settings → Network connection.';
  } else if (/401|403|unauthori[sz]ed|forbidden|access denied/.test(message)) {
    summary = 'RPC access denied';
    action = 'Check the endpoint credentials and whether the operator accepts Tor traffic. Update the balance RPC endpoints in Settings → Network connection if needed.';
  } else if (/verification timed out/.test(message)) {
    summary = 'Verification timed out';
    action = 'The queued or running verification session exceeded five minutes. Retry this address after other reads finish; check the private connection and RPC if it repeats.';
  } else if (/timeout|timed out|aborted/.test(message)) {
    summary = 'Request timed out';
    action = 'Retry when the connection is stable. If timeouts persist, check the configured Tor gateway and RPC endpoints in Settings → Network connection.';
  } else if (/proof|bytecode|state root|pinned finalized block/.test(message)) {
    summary = 'Proof verification rejected';
    action = 'The returned data could not be verified. Retry with a compatible mainnet RPC endpoint; the application will keep the previous value until verification succeeds.';
  } else if (/evm|revert|balanceof|contract/.test(message)) {
    summary = 'Contract read failed';
    action = 'Check that the tracked token contract is correct for Ethereum mainnet. Retry the read or use another compatible balance RPC endpoint.';
  } else if (/connection|network|fetch|gateway|worker.*(unavailable|stopped)/.test(message)) {
    summary = 'Connection unavailable';
    action = 'Check your internet connection and the Tor gateway/RPC endpoints in Settings → Network connection. Failed balance reads retry automatically.';
  }
  if (/starting the private/.test(context) && !/checkpoint|digest|hash|offline/.test(message)) action = 'Check Tor gateways in Settings → Network connection, then save and reconnect. Failed balance reads retry automatically.';
  if (/pricing/.test(context) && /automatic/.test(action)) action = 'Use the address Refresh button to retry the price read. Check the network settings if the request keeps failing.';
  return { summary, action };
}
