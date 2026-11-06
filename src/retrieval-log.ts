import { checkLabel, type CheckProgress } from './verification/progress';
import { errorMessage } from './errors';
import type { Token } from './tokens';
import type { VerificationEvent } from './verification/client';

export type RetrievalEntry = { id:number; at:number; level:'info'|'success'|'error'; message:string };
export type RetrievalLog = { retrievalLog?:RetrievalEntry[]; logSequence?:number; droppedLogEntries?:number };
export const LOG_LIMIT = 1000;
export function appendRetrievalLog(owner: RetrievalLog, message: string, level:RetrievalEntry['level']='info') {
  const entries = owner.retrievalLog ??= [];
  const at = Date.now();
  for (const line of errorMessage(message).split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    entries.push({id:owner.logSequence=(owner.logSequence||0)+1,at,level,message:line.slice(0,2000)});
  }
  if(entries.length>LOG_LIMIT) { owner.droppedLogEntries=(owner.droppedLogEntries||0)+entries.length-LOG_LIMIT; entries.splice(0,entries.length-LOG_LIMIT); }
}
export function logVerificationEvent(owner:RetrievalLog,event:VerificationEvent,tokens:Token[], mode?:'tor'|'https', checks?:CheckProgress) {
  const token=tokens.find(token=>token.address===event.asset)?.symbol || 'Token';
  if(event.message) appendRetrievalLog(owner,event.message,event.type.endsWith('error')?'error':'info');
  if(event.type==='network'&&event.request) {
    const request=event.request;
    const status=request.state==='waiting'?(mode==='https'?'Direct HTTPS; waiting for response headers':'Submitted to Anon-RPC; waiting for response headers'):request.state==='reading'?'Response headers received; reading body':'Response body received';
    appendRetrievalLog(owner, request.purpose
      ? (checks ? checkLabel(checks)+' · ' : '') + request.purpose + ' · ' + (request.state === 'waiting' ? 'requested' : request.state === 'reading' ? 'receiving' : 'received')
      : 'Request #'+request.requestId+' · '+request.method+' → '+request.host+' · '+status);
  } else if(event.type==='block'&&event.block) appendRetrievalLog(owner,'Selected verified finalized block '+BigInt(event.block.number)+' · '+event.block.hash);
  else if(event.type==='asset') appendRetrievalLog(owner,token+' · Starting balance proof / local execution.');
  else if(event.type==='balance'&&event.block&&event.amount!==undefined) appendRetrievalLog(owner,token+' · Balance proved at finalized block '+event.block.hash+'.','success');
  else if(event.type==='price-start') appendRetrievalLog(owner,token+' · Starting verified price-oracle reads.');
  else if(event.type==='price') appendRetrievalLog(owner,token+' · Price quote received for block '+(event.block?.hash||'unknown')+'. Holding values require a matching balance proof.','success');
  else if(event.type==='price-error'||event.type==='asset-error') appendRetrievalLog(owner,token+' · '+(event.type==='price-error'?'Price':'Balance')+' lookup failed: '+errorMessage(event.error),'error');
}
