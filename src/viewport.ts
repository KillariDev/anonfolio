// Keep the same visible record in the portfolio when content above it changes.
// The portfolio owns vertical scrolling; details, requests and logs do not.
export function captureViewport(root: HTMLElement) {
  const bounds = root.getBoundingClientRect();
  const top = Math.max(0, bounds.top + (root.querySelector('thead')?.getBoundingClientRect().height || 0));
  const bottom = Math.min(bounds.bottom, window.innerHeight);
  const entries = [...root.querySelectorAll<HTMLElement>('[data-view-key], [data-log-id], .balances, .activity-item, .detail-disclosure > summary, .retrieval-log > summary, .progress-heading, .read-times tbody tr[data-asset], .failure-technical > summary, .failure-message, .snapshot-hash > summary')]
    .map(node => {
      const rect=node.getBoundingClientRect();
      const token=node.matches('.read-times tbody tr[data-asset]') ? {wallet:node.closest<HTMLElement>('.wallet')?.dataset.address,asset:node.dataset.asset} : undefined;
      return {node,offset:rect.top-bounds.top,rect,token};
    }).filter(entry => entry.rect.height>0 && entry.rect.bottom>top && entry.rect.top<bottom);
  const anchors = [
    ...entries.filter(entry => entry.rect.top<top-1 && entry.rect.bottom-top>=Math.min(entry.rect.height/2,24) && entry.node.matches('[data-log-id], .read-times tbody tr, .failure-message')),
    ...entries.filter(entry => entry.rect.top>=top-1),
  ];
  const tails = [...root.querySelectorAll<HTMLDetailsElement>('.retrieval-log[open]')].filter(log => {
    const rect=log.querySelector('.log-stream > li:last-child')?.getBoundingClientRect();
    return rect && rect.height>0 && rect.bottom>=top && rect.bottom<=bottom+4;
  });
  const floors = [...root.querySelectorAll<HTMLElement>('.detail-disclosure[open] > .disclosure-body')]
    .map(node=>({node,height:node.getBoundingClientRect().height}));
  return {top:root.scrollTop,left:root.scrollLeft,anchors,tails,floors};
}
export function restoreViewport(root:HTMLElement, saved:ReturnType<typeof captureViewport>) {
  for(const {node,height} of saved.floors) if(node.isConnected) node.style.minHeight=Math.max(height,node.getBoundingClientRect().height)+'px';
  root.scrollLeft=saved.left;
  root.scrollTop=saved.top;
  for(const anchor of saved.anchors) {
    let node:HTMLElement|undefined=anchor.node.isConnected?anchor.node:undefined;
    // A proved token can move from the pending group to a new block card.
    // Resolve that same token row even when its former DOM parent was removed.
    if(!node && anchor.token) {
      const wallet=[...root.querySelectorAll<HTMLElement>('.wallet')].find(node=>node.dataset.address===anchor.token!.wallet);
      node=[...wallet?.querySelectorAll<HTMLElement>('.read-times tbody tr[data-asset]')||[]].find(node=>node.dataset.asset===anchor.token!.asset);
    }
    if(node && node.getBoundingClientRect().height>0) {
      root.scrollTop+=node.getBoundingClientRect().top-root.getBoundingClientRect().top-anchor.offset;
      break;
    }
  }
  for(const log of saved.tails) if(log.isConnected&&log.open) {
    const end=log.querySelector('.log-stream > li:last-child')?.getBoundingClientRect();
    if(end) root.scrollTop+=Math.max(0,end.bottom-Math.min(root.getBoundingClientRect().bottom,window.innerHeight)+8);
  }
}
