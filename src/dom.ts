// Update rendered output in place so progress messages do not restart animations,
// reload images, or detach the reader's focused/scrolling elements.
function key(node: Node): string {
  if (!(node instanceof Element)) return String(node.nodeType);
  if (node.hasAttribute('data-view-key')) return [node.namespaceURI, node.tagName, node.getAttribute('data-view-key')].join('|');
  return [node.namespaceURI, node.tagName, node.id, node.getAttribute('data-address'),
    node.getAttribute('data-asset'), node.getAttribute('data-block'), node.getAttribute('data-log-id'),
    node.classList[0], node instanceof HTMLImageElement ? node.getAttribute('src') : ''].join('|');
}

function updateNode(current: Node, next: Node) {
  if (!(current instanceof Element) || !(next instanceof Element)) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const attribute of [...current.attributes]) {
    // Disclosures belong to the reader, rather than to a progress update.
    if (attribute.name !== 'open' && !next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  if (current instanceof HTMLElement && next instanceof HTMLElement) {
    current.onclick = next.onclick;
    current.ontoggle = next.ontoggle;
  }
  updateChildren(current, [...next.childNodes]);
}

export function updateChildren(parent: Node, output: readonly Node[]) {
  const available = new Map<string, Node[]>();
  for (const node of parent.childNodes) {
    const identity = key(node);
    const siblings = available.get(identity) || [];
    siblings.push(node); available.set(identity, siblings);
  }
  let cursor = parent.firstChild;
  for (const next of output) {
    const current = available.get(key(next))?.shift();
    const node = current || next;
    if (current) updateNode(current, next);
    if (node !== cursor) parent.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  while (cursor) { const next = cursor.nextSibling; parent.removeChild(cursor); cursor = next; }
}
