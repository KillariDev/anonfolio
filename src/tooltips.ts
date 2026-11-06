// One delegated tooltip works with the in-place renderer, without a UI library.
// Text is never HTML, and explanations remain available on keyboard and touch.
export function explain(node: HTMLElement, text: string, focusable = true) {
  node.dataset.tooltip = text;
  if (focusable) node.tabIndex = 0;
}
export function explanationGroup(node: HTMLElement, extra = '') {
  const messages = [extra, ...[...node.querySelectorAll<HTMLElement>('.status-icon[data-tooltip]')].map(icon => icon.dataset.tooltip!)].filter(Boolean);
  // Avoid showing a native browser title on top of the accessible explanation.
  const native = [node, ...node.querySelectorAll<HTMLElement>('[title]')];
  for (const item of native) {
    const title = item.getAttribute('title');
    if (!title) continue;
    if (!(item instanceof HTMLImageElement && item.closest('.status-icon[data-tooltip]')) && !item.dataset.tooltip) item.dataset.tooltip = title;
    item.removeAttribute('title');
  }
  if (messages.length) explain(node, [...new Set(messages)].join('\n'));
}
export function installTooltips() {
  const bubble = document.createElement('div');
  bubble.id = 'explanation-tooltip'; bubble.className = 'explanation-tooltip';
  bubble.setAttribute('role', 'tooltip'); bubble.hidden = true;
  document.body.append(bubble);
  let source: HTMLElement | undefined;
  let pinned = false;
  let dismissed: HTMLElement | undefined;
  const target = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip]') || undefined : undefined;
  function close() {
    source?.removeAttribute('aria-describedby'); source = undefined;
    pinned = false; bubble.hidden = true;
  }
  function open(node: HTMLElement) {
    if (dismissed === node) return;
    close(); source = node;
    bubble.textContent = node.dataset.tooltip || '';
    bubble.hidden = false;
    node.setAttribute('aria-describedby', bubble.id);
    const rect = node.getBoundingClientRect(), size = bubble.getBoundingClientRect();
    bubble.style.left = Math.max(8, Math.min(innerWidth - size.width - 8, rect.left)) + 'px';
    bubble.style.top = (rect.bottom + size.height + 10 < innerHeight ? rect.bottom + 7 : Math.max(8, rect.top - size.height - 7)) + 'px';
  }
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch' || pinned) return;
    const node = target(event);
    if (node && node !== source) open(node);
  });
  document.addEventListener('pointerout', event => {
    if (pinned || !source) return;
    if (event.relatedTarget instanceof Node && bubble.contains(event.relatedTarget)) return;
    if (!(event.relatedTarget instanceof Node) || !source.contains(event.relatedTarget)) {
      if (document.activeElement !== source) close();
      dismissed = undefined;
    }
  });
  document.addEventListener('focusin', event => { const node = target(event); if (node && node !== source) open(node); });
  document.addEventListener('focusout', () => { if (!pinned) close(); dismissed = undefined; });
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && bubble.contains(event.target)) return;
    const node = target(event);
    if (!node) { close(); dismissed = undefined; return; }
    if (event.pointerType === 'touch') {
      if (pinned && node === source) close();
      else { dismissed = undefined; open(node); pinned = true; }
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && source) {
      dismissed = source; close(); event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('scroll', event => { if (event.target instanceof Node && bubble.contains(event.target)) return; if (source && document.activeElement === source) open(source); else close(); }, true);
  new MutationObserver(() => {
    if (source && !source.isConnected) close();
    else if (source && (bubble.textContent !== source.dataset.tooltip || source.getAttribute('aria-describedby') !== bubble.id)) open(source);
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tooltip'] });
  window.addEventListener('resize', close);
}
