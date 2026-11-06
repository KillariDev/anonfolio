import type { Wallet } from './balances';
import { LOG_LIMIT } from './retrieval-log';

export function logStream(wallet:Wallet,open=false) {
  const details=document.createElement('details'); details.className='retrieval-log'; details.open=open;
  const summary=document.createElement('summary'); summary.textContent='Retrieval log'; summary.setAttribute('aria-label','Retrieval log for '+wallet.address);
  const count=document.createElement('span'); count.className='log-count'; count.textContent=String(wallet.retrievalLog?.length||0); summary.append(count);
  const hint=document.createElement('p'); hint.className='log-hint';
  hint.textContent='Current browser session · oldest first'+(wallet.droppedLogEntries?' · '+wallet.droppedLogEntries+' earlier entries omitted (latest '+LOG_LIMIT+' kept)':'');
  const stream=document.createElement('ol'); stream.className='log-stream'; stream.setAttribute('role','log'); stream.setAttribute('aria-label','Retrieval messages'); stream.setAttribute('aria-live','off'); stream.tabIndex=0;
  const fill=(target:HTMLDetailsElement)=>{
    const stream=target.querySelector<HTMLOListElement>('.log-stream')!;
    const version=(wallet.logSequence||0)+':'+(wallet.retrievalLog?.length||0);
    if(stream.dataset.logVersion===version) return;
    stream.dataset.logVersion=version;
    stream.replaceChildren();
    for(const entry of wallet.retrievalLog||[]) {
      const row=document.createElement('li'); row.dataset.level=entry.level; row.dataset.logId=String(entry.id);
      const date=new Date(entry.at), time=document.createElement('time'); time.dateTime=date.toISOString(); time.title=date.toLocaleString()+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone;
      time.textContent=date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false});
      const message=document.createElement('span'); message.textContent=entry.message;
      row.append(time,message); stream.append(row);
    }
    if(!stream.children.length) { const empty=document.createElement('li'); empty.textContent='No retrieval messages in this session yet.'; stream.append(empty); }
  };
  details.append(summary,hint,stream);
  if(open) fill(details);
  details.ontoggle=event=>{
    const target=event.currentTarget as HTMLDetailsElement;
    if(target.open) {
      fill(target);
      const end=target.querySelector('.log-stream > li:last-child'), root=target.closest<HTMLElement>('#wallets');
      if(end && root) {
        root.scrollIntoView({block:'nearest',inline:'nearest'});
        root.scrollTop+=Math.max(0,end.getBoundingClientRect().bottom-Math.min(root.getBoundingClientRect().bottom,window.innerHeight)+8);
      }
    }
  };
  return details;
}
