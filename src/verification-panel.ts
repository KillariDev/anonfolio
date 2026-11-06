import type { Wallet } from './balances';
import { config } from './config';
import { checkLabel, stageLabels, progressTime, type VerificationStage } from './verification/progress';

function progressClock(startedAt: number, deadline?: number) {
  const clock = document.createElement('small'); clock.className = 'progress-clock';
  clock.dataset.progressStart = String(startedAt);
  if (deadline) clock.dataset.progressDeadline = String(deadline);
  clock.setAttribute('aria-live', 'off');
  clock.textContent = progressTime(startedAt, Date.now(), deadline);
  return clock;
}
export function verificationPanel(wallet: Wallet) {
  const panel = document.createElement('section'); panel.className = 'verification-panel' + (wallet.loading ? '' : ' is-finished');
  panel.setAttribute('aria-label', 'Verification progress');
  const stage = wallet.verificationStage || 'connection';
  const phases: VerificationStage[] = ['verifier', 'consensus', 'balances', 'pricing'];
  const index = !wallet.loading ? 4 : stage === 'queued' ? 0 : stage === 'balances-pricing' ? 2 : phases.indexOf(stage);
  const steps = document.createElement('ol'); steps.className = 'verification-stages';
  ['Verifier', 'Consensus', 'Balances', 'Prices'].forEach((label, step) => {
    const item = document.createElement('li'); item.textContent = label; item.dataset.viewKey = label;
    item.className = !wallet.loading ? '' : step < index ? 'completed' : (step === index || stage === 'balances-pricing' && step === 3) ? 'current' : '';
    if (wallet.loading && (step === index || stage === 'balances-pricing' && step === 3)) item.setAttribute('aria-current', 'step');
    steps.append(item);
  });
  const heading = document.createElement('div'); heading.className = 'progress-heading';
  const title = document.createElement('strong'); title.textContent = wallet.loading ? stage === 'connection' ? 'Verification' : stageLabels[stage] : wallet.checkProgress ? 'Read attempt finished' : 'Saved balances';
  if (wallet.checkProgress) title.textContent = checkLabel(wallet.checkProgress) + ' · ' + title.textContent;
  title.title = title.textContent + ' · Counts balance and price checks, including failed checks. Extra code/storage requests are discovered as contracts execute.';
  const active = wallet.loading && !wallet.queuedForVerifier && stage !== 'connection';
  const clock = active ? progressClock(wallet.stageStartedAt || Date.now()) : document.createElement('small');
  clock.className = 'progress-clock';
  if (!active) clock.textContent = '';
  heading.append(title, clock);
  panel.append(steps, heading);
  const requestArea = document.createElement('div'); requestArea.className = 'progress-requests';
  const requests = wallet.networkRequests || [];
  if (wallet.loading && requests.length) {
    for (const request of requests.slice(0, 2)) {
      const row = document.createElement('div'); row.className = 'progress-request'; row.dataset.viewKey = String(request.requestId);
      const operation = document.createElement('p'); operation.textContent = (request.purpose || request.method) + ' → ' + request.host;
      const state = document.createElement('span'); state.textContent = request.state === 'waiting' ? (config.mode === 'https' ? 'Direct HTTPS · waiting for response headers' : 'Submitted to Anon-RPC · waiting for response headers') : 'Response headers received · reading response body';
      row.append(operation, state, progressClock(request.startedAt, request.deadline));
      operation.title = operation.textContent + ' · ' + request.method + (request.target ? ' · ' + request.target : '') + ' → ' + request.host; state.title = state.textContent;
      requestArea.append(row);
    }
    const hint = document.createElement('p'); hint.className = 'progress-hint';
    hint.textContent = requests.length > 2 ? '+' + (requests.length - 2) + ' more ' + (config.mode === 'https' ? 'HTTPS' : 'private') + ' requests' : '';
    requestArea.append(hint);
  } else {
    const operation = document.createElement('p'); operation.className = 'verification-progress';
    operation.setAttribute('role', 'status');
    const detail = wallet.verificationStatus || '';
    operation.textContent = wallet.loading && stage !== 'connection' && stage !== 'queued' && detail !== stageLabels[stage] ? detail : '';
    operation.title = operation.textContent;
    requestArea.append(operation);
  }
  panel.append(requestArea);
  return panel;
}
