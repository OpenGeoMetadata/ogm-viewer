import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import { getAssetPath } from '@stencil/core';

// Utility to set the base path for assets so that e.g. icon images are loaded
export const setAssetBasePath = () => {
  // Points to the top-level package directory, corresponding to src/ in this repo
  // In local dev, it will be an empty string instead
  const packageRoot = getAssetPath('').split('/').filter(Boolean).slice(0, -1).join('/');

  // Set the asset path for icon images – src/ will become dist/collection/
  // If in local dev, just set it to the root, since Stencil handles serving assets
  if (packageRoot) setBasePath(`${packageRoot}/collection`);
  else setBasePath('');
};
