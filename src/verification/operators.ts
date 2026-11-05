import { privateExecutionRpc, ProofHistoryUnavailable, type RpcRequest } from './transport';
import type { PrivateWorker } from '../balances';
export type OperatorRoute = { current:string; urls:string[]; rejected:Set<string> };
export function operatorRoute(preferred:string,configured:string[]):OperatorRoute {
  return { current:preferred,urls:[...new Set([preferred,...configured])],rejected:new Set() };
}
// Recover only from an explicit provider proof-history rejection. Invalid proofs,
// malformed replies, ordinary RPC errors and private transport failures still fail closed.
export async function executionWithOperators(worker:PrivateWorker,route:OperatorRoute,isolationKey:string,request:RpcRequest,signal:AbortSignal,
  progress:(url:string,state:'waiting'|'reading'|'received')=>void,onSwitch:(from:string,to:string)=>void) {
  for (;;) {
    if(signal.aborted) throw signal.reason;
    const url=route.current;
    progress(url,'waiting');
    try {
      return await privateExecutionRpc(worker,{rpcUrl:url,isolationKey},request,signal,state=>progress(url,state));
    } catch(error) {
      if(!(error instanceof ProofHistoryUnavailable)||signal.aborted) throw error;
      route.rejected.add(url);
      const next=!route.rejected.has(route.current)?route.current:route.urls.find(candidate=>!route.rejected.has(candidate));
      if(!next) throw new ProofHistoryUnavailable(error.message+' No configured RPC can serve the required finalized-block proofs. Add a historical-proof endpoint in Settings → Network connection.');
      route.current=next;
      onSwitch(url,next);
    }
  }
}
