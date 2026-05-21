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
