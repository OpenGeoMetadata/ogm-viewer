// Look for an element in shadow DOM that may or may not be there
export const findElement = (parent: HTMLElement, selector: string): HTMLElement | undefined => {
  return parent?.shadowRoot?.querySelector(selector) || undefined;
};

// Get an element from shadow DOM that definitely should be there
export const getElement = (parent: HTMLElement, selector: string): HTMLElement => {
  const el = findElement(parent, selector);
  if (!el) throw new Error(`Could not find child of ${parent.tagName} with selector: ${selector}`);
  return el as HTMLElement;
};

// The nearest ancestor matching the selector, looking out through any shadow roots we're inside.
// closest() stops at a shadow boundary, and a component has no way to know how many boundaries lie
// between it and what it's looking for - or whether that ancestor is there at all.
export const closestAcrossShadows = (start: Element, selector: string): HTMLElement | undefined => {
  let node: Element | undefined = start;
  while (node) {
    const found = node.closest(selector);
    if (found) return found as HTMLElement;
    // Out through one shadow boundary. A light-DOM root is the document, which has no host, and
    // that is what ends the walk.
    node = (node.getRootNode() as ShadowRoot).host;
  }
  return undefined;
};
