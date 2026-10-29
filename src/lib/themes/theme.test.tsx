import { describe, it, expect } from '@stencil/vitest';

import Theme from './theme';

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

    it('keeps the default when the property is unset or unparseable', () => {
      expect(themed().getPadding()).toBe(32);
      expect(themed({ '--ogm-padding': 'var(--wa-space-xl)' }).getPadding()).toBe(32);
    });

    it('honors an override of zero', () => {
      expect(themed({ '--ogm-padding': '0' }).getPadding()).toBe(0);
    });
  });
});
