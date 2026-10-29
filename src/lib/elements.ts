export const findElement = (parent: HTMLElement, selector: string): HTMLElement | undefined => {
  return parent?.shadowRoot?.querySelector(selector) || undefined;
};

export const getElement = (parent: HTMLElement, selector: string): HTMLElement => {
  const el = findElement(parent, selector);
  if (!el) throw new Error(`Could not find child of ${parent.tagName} with selector: ${selector}`);
  return el as HTMLElement;
};

export const closestAcrossShadows = (start: Element, selector: string): HTMLElement | undefined => {
  let node: Element | undefined = start;
  while (node) {
    const found = node.closest(selector);
    if (found) return found as HTMLElement;
    node = (node.getRootNode() as ShadowRoot).host;
  }
  return undefined;
};
