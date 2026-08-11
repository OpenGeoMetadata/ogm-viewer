import { describe, it, expect } from '@stencil/vitest';

import Theme from './theme';

// A theme reading from an element carrying the given custom properties; see maplibre.test.tsx for
// why the properties go on the element itself rather than on an ancestor.
const themed = (tokens: Record<string, string> = {}) => {
  const el = document.createElement('div');
  Object.entries(tokens).forEach(([name, value]) => el.style.setProperty(name, value));
  document.body.appendChild(el);
  return new Theme(el);
};

describe('Theme', () => {
  describe('padding', () => {
    it('reads an override', () => {
      expect(themed({ '--ogm-padding': '64' }).getPadding()).toBe(64);
    });

    // Both renderers hand this to a camera, so it has to be a pixel count either way
    it('keeps the default when the property is unset or unparseable', () => {
      expect(themed().getPadding()).toBe(32);
      expect(themed({ '--ogm-padding': 'var(--wa-space-xl)' }).getPadding()).toBe(32);
    });

    // An app that asks for no gap has asked for something, so it isn't read as having asked for nothing
    it('honors an override of zero', () => {
      expect(themed({ '--ogm-padding': '0' }).getPadding()).toBe(0);
    });
  });
});
