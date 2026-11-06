import { expect,test } from 'bun:test';
import { appendRetrievalLog,logVerificationEvent,LOG_LIMIT,type RetrievalLog } from '../src/retrieval-log';
import { defaultTokens } from '../src/tokens';

test('timestamped log preserves repeated messages and uses bounded, explicit retention',()=>{
  const owner:RetrievalLog={};
  const before=Date.now();
  appendRetrievalLog(owner,'Waiting'); appendRetrievalLog(owner,'Waiting');
  expect(owner.retrievalLog?.map(entry=>entry.message)).toEqual(['Waiting','Waiting']);
  expect(owner.retrievalLog!.every(entry=>entry.at>=before&&entry.at<=Date.now())).toBe(true);
  for(let i=0;i<LOG_LIMIT;i++) appendRetrievalLog(owner,'Message '+i);
  expect(owner.retrievalLog).toHaveLength(LOG_LIMIT);
  expect(owner.droppedLogEntries).toBe(2);
  expect(owner.retrievalLog![0]!.id).toBe(3);
  expect(owner.retrievalLog!.at(-1)!.id).toBe(LOG_LIMIT+2);
});
test('event log records all network phases and results without serializing private request payloads',()=>{
  const owner:RetrievalLog={}, tokens=defaultTokens();
  const request={requestId:7,method:'eth_getProof',host:'rpc.example',startedAt:Date.now(),deadline:Date.now()+90_000};
  for(const state of ['waiting','reading','received'] as const) logVerificationEvent(owner,{type:'network',request:{...request,state},body:{params:['private-wallet']},isolationKey:'private-key'} as any,tokens);
  logVerificationEvent(owner,{type:'progress',message:'Verifying storage proofs'},tokens);
  logVerificationEvent(owner,{type:'asset-error',asset:'eth',error:'Failed https://user:password@rpc.example/key-secret?token=query-secret'},tokens);
  const messages=owner.retrievalLog!.map(entry=>entry.message);
  expect(messages[0]).toContain('Request #7 · eth_getProof → rpc.example');
  expect(messages.slice(0,3).join(' ')).toContain('Response body received');
  expect(messages[1]).toContain('Response headers received');
  expect(messages[3]).toBe('Verifying storage proofs');
  expect(owner.retrievalLog!.at(-1)!.level).toBe('error');
  expect(messages.join(' ')).not.toMatch(/password|key-secret|query-secret|private-wallet|private-key/);
});

test('multiline Tor failures keep each diagnostic in a separate timestamped log entry', () => {
  const owner: RetrievalLog = {};
  appendRetrievalLog(owner, 'Private connection timed out\nRecent Tor diagnostics:\n[01:52.583] Guard unavailable\n[01:57.599] Guard unavailable', 'error');
  expect(owner.retrievalLog!.map(entry => entry.message)).toEqual(['Private connection timed out','Recent Tor diagnostics:','[01:52.583] Guard unavailable','[01:57.599] Guard unavailable']);
  expect(owner.retrievalLog!.map(entry => entry.id)).toEqual([1,2,3,4]);
  expect(new Set(owner.retrievalLog!.map(entry => entry.at)).size).toBe(1);
  expect(owner.retrievalLog!.every(entry => entry.level === 'error')).toBe(true);
});
