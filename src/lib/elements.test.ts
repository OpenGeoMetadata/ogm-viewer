import { describe, it, expect, beforeEach } from '@stencil/vitest';
import { Window } from 'happy-dom';
import { getElement, findElement } from './elements';

describe('getElement', () => {
  beforeEach(() => {
    // Reset the DOM before each test
    const window = new Window();
    (global as any).window = window;
    (global as any).document = window.document;
  });

  it('should return the element inside the parent shadow DOM', () => {
    const parent = document.createElement('div');
    const shadowRoot = parent.attachShadow({ mode: 'open' });
    const child = document.createElement('span');
    child.className = 'child';
    shadowRoot.appendChild(child);

    const foundElement = getElement(parent, '.child');
    expect(foundElement).toBe(child);
  });

  it('should throw an error if the element is not found', () => {
    const parent = document.createElement('div');
    parent.attachShadow({ mode: 'open' });
    expect(() => getElement(parent, '.nonexistent')).toThrow(`Could not find child of DIV with selector: .nonexistent`);
  });
});

describe('findElement', () => {
  beforeEach(() => {
    // Reset the DOM before each test
    const window = new Window();
    (global as any).window = window;
    (global as any).document = window.document;
  });

  it('should return undefined if the element is not found', () => {
    const parent = document.createElement('div');
    parent.attachShadow({ mode: 'open' });

    const foundElement = findElement(parent, '.nonexistent');
    expect(foundElement).toBeUndefined();
  });
});
