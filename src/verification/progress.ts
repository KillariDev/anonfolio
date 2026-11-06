export type VerificationStage = 'connection' | 'queued' | 'verifier' | 'consensus' | 'balances' | 'balances-pricing' | 'pricing';
export const stageLabels: Record<VerificationStage, string> = {
  connection: 'Starting private connection', queued: 'Queued for the verifier', verifier: 'Preparing verifier',
  consensus: 'Syncing finalized Ethereum state', balances: 'Verifying balances', 'balances-pricing': 'Verifying balances and prices', pricing: 'Reading price estimates',
};
export type NetworkProgress = { requestId: number; method: string; host: string; state: 'waiting' | 'reading' | 'received'; startedAt: number; deadline: number; asset?: string; purpose?: string; target?: string };
export function progressTime(startedAt: number, now = Date.now(), deadline?: number) {
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  return elapsed + 's elapsed' + (deadline ? ' · request timeout in ' + Math.max(0, Math.ceil((deadline - now) / 1000)) + 's' : '');
}
export function waitingReason(stage?: VerificationStage) {
  return stage === 'queued' ? 'Queued for the verifier'
    : stage === 'connection' ? 'Waiting for the private connection'
    : stage === 'verifier' ? 'Waiting for verifier initialization'
    : stage === 'consensus' ? 'Waiting for consensus sync; balance request not sent'
    : 'Waiting for this token’s turn';
}

export type CheckProgress = { completed: number; total: number };
export function checkLabel(progress: CheckProgress | undefined) {
  return progress ? progress.completed + '/' + progress.total + ' checks' : '';
}
