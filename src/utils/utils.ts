import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import { getAssetPath, Build } from '@stencil/core';

// Utility to set the base path for assets so that e.g. icon images are loaded
export const setAssetBasePath = () => {
  // Points to the top-level package directory, corresponding to src/ in this repo
  // In local dev, it will be an empty string instead
  const assetPath = getAssetPath('');
  const packageRoot = assetPath.split('/').filter(Boolean).slice(0, -1).join('/');

  console.log('dev', Build.isDev);
  console.log('browser', Build.isBrowser);
  console.log('server', Build.isServer);
  console.log('testing', Build.isTesting);
  console.log('assetPath', getAssetPath(''));
  console.log('packageRoot', packageRoot);

  setBasePath(assetPath);

  // Set the asset path for icon images – src/ will become dist/collection/
  // If in local dev, just set it to the root, since Stencil handles serving assets
  // if (packageRoot) setBasePath(`${packageRoot}/collection`);
  // else setBasePath('');
};
