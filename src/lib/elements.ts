// Helper to find elements in the shadow DOM
export const findElement = (parent: HTMLElement, selector: string): HTMLElement => {
  const el = parent?.shadowRoot?.querySelector(selector);
  if (!el) throw new Error(`Could not find child of ${parent.tagName} with selector: ${selector}`);
  return el as HTMLElement;
};
