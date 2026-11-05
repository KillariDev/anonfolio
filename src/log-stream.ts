import type { Wallet } from './balances';
import { LOG_LIMIT } from './retrieval-log';

export function logStream(wallet:Wallet,open=false) {
  const details=document.createElement('details'); details.className='retrieval-log'; details.open=open;
  const summary=document.createElement('summary'); summary.textContent='Retrieval log'; summary.setAttribute('aria-label','Retrieval log for '+wallet.address);
  const count=document.createElement('span'); count.className='log-count'; count.textContent=String(wallet.retrievalLog?.length||0); summary.append(count);
  const hint=document.createElement('p'); hint.className='log-hint';
  hint.textContent='Current browser session · oldest first'+(wallet.droppedLogEntries?' · '+wallet.droppedLogEntries+' earlier entries omitted (latest '+LOG_LIMIT+' kept)':'');
  const stream=document.createElement('ol'); stream.className='log-stream'; stream.setAttribute('role','log'); stream.setAttribute('aria-label','Retrieval messages'); stream.setAttribute('aria-live','off'); stream.tabIndex=0;
  let filled=false;
  const fill=()=>{
    if(filled) return; filled=true;
    for(const entry of wallet.retrievalLog||[]) {
      const row=document.createElement('li'); row.dataset.level=entry.level;
      const date=new Date(entry.at), time=document.createElement('time'); time.dateTime=date.toISOString(); time.title=date.toLocaleString()+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone;
      time.textContent=date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false});
      const message=document.createElement('span'); message.textContent=entry.message;
      row.append(time,message); stream.append(row);
    }
    if(!stream.children.length) { const empty=document.createElement('li'); empty.textContent='No retrieval messages in this session yet.'; stream.append(empty); }
  };
  if(open) fill();
  details.addEventListener('toggle',()=>{if(details.open&&!filled) {fill();stream.scrollTop=stream.scrollHeight;}});
  details.append(summary,hint,stream);
  return details;
}
