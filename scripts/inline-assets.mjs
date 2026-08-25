/**
 * Writes src/lib/assets.generated.ts: things a component needs at runtime that used to be files
 * beside it - Web Awesome's default theme, our bootstrap-icons subset, and the colormap sprite
 * scalar COGs are drawn through - as strings and base64 the bundler carries with the rest of the
 * library.
 *
 * All three used to be (or, for the sprite, would otherwise be) fetched from a URL beside this
 * package's own files, anchored to the module's import.meta.url. That is right for a script tag and
 * for a CDN importmap, and wrong for every app that bundles us: a bundler copies the JavaScript it
 * was asked for, and knows nothing about a sibling directory of assets it was never pointed at. So
 * `npm i ogm-viewer` and `import 'ogm-viewer'` drew the map correctly and everything around it
 * unstyled - serif fallback font, no icons - with a handful of failed requests to explain it.
 * Nothing a consumer can configure fixes that; the files have to be inside the module graph, which
 * is what this puts them there for.
 *
 * Run ahead of Stencil by `npm run build` and `npm start`, rather than checked in, so the tree can
 * never carry a copy of Web Awesome's CSS, or of a sprite from @developmentseed/deck.gl-raster, that
 * disagrees with the version in package.json.
 *
 * A step ahead of the compiler rather than a Rollup transform like the decoder worker's in
 * stencil.config.ts, because the two fail differently: that source can be empty in a build that
 * skips the plugin and only costs speed, where an empty theme *is* the unstyled viewer this fixes,
 * with nothing failing to say so. Writing a real module instead leaves one copy of the truth for
 * tsc, for vitest, and for every output target.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { COLORMAP_INDEX } from '@developmentseed/deck.gl-raster/gpu-modules';

// The stylesheet every component used to link, resolved through Web Awesome's own exports rather
// than from a path into node_modules, so this holds wherever the package manager hoisted it to.
const THEME = '@awesome.me/webawesome/dist/styles/themes/default.css';

// Our icons: the subset of bootstrap-icons checked in beside this repo's other assets. Whatever is
// in that directory is what <wa-icon name="..."> can name - see registerIconLibrary in src/lib/init.ts.
const ICONS = new URL('../assets/icons/', import.meta.url);

// The 107 named color ramps a scalar COG can be drawn with, as one 256x107 RGBA sprite - see
// src/lib/colormap.ts. Resolved the same way as THEME, so it holds wherever the package manager put
// it, and small enough (16.4 KB) to compile in rather than publish as a copied file the way lerc's
// wasm still is; see the note on the dist-custom-elements output target in stencil.config.ts for why
// that one is different.
const COLORMAP_SPRITE = '@developmentseed/deck.gl-raster/gpu-modules/colormaps.png';

const OUTPUT = new URL('../src/lib/assets.generated.ts', import.meta.url);

/**
 * One stylesheet's text with every @import it makes inlined in place. CSS requires @import at the
 * top of a sheet, ahead of any rule, so inlining each where it stands preserves the order the
 * cascade would have seen. A file that has already been inlined once collapses to nothing rather
 * than being repeated: layers.css arrives twice, directly and again underneath the palette.
 */
const inlineImports = (url, seen = new Set()) => {
  if (seen.has(url.href)) return '';
  seen.add(url.href);

  return readFileSync(url, 'utf8').replace(/@import\s+url\(\s*(['"]?)([^'")]+)\1\s*\)\s*;/g, (_match, _quote, specifier) => inlineImports(new URL(specifier, url), seen));
};

const css = inlineImports(new URL(import.meta.resolve(THEME)));

// Loudly rather than quietly, both of these: a relative URL that survives into the string is one
// that will resolve against the embedding page once this is adopted into a shadow root, which is the
// whole class of bug this script exists to remove. An @import form we don't recognize, or a url()
// pointing at a file beside the CSS, is Web Awesome telling us its styles moved.
if (/@import/.test(css)) throw new Error(`${THEME} makes an @import this script doesn't recognize. Check how Web Awesome writes them now, and update scripts/inline-assets.mjs.`);
if (/url\(\s*['"]?(?!data:)/.test(css))
  throw new Error(`${THEME} now points at a file beside itself, which nothing ships. Check what it wants, and update scripts/inline-assets.mjs.`);

const icons = readdirSync(ICONS)
  .filter(file => file.endsWith('.svg'))
  .sort()
  .map(file => [basename(file, '.svg'), readFileSync(new URL(file, ICONS), 'utf8').trim()]);

if (icons.length === 0) throw new Error(`No icons in ${ICONS.pathname}. Every wa-icon in the library resolves through that directory.`);

const spritePath = import.meta.resolve(COLORMAP_SPRITE).replace('file://', '');
const sprite = readFileSync(spritePath);

// A PNG's width and height are the first two 4-byte big-endian fields of its IHDR chunk, which is
// always the first chunk - right after the 8-byte signature every PNG opens with. Read rather than
// trusted, because both numbers are load-bearing for what reads this sprite at runtime:
// createColormapTexture (@developmentseed/deck.gl-raster) throws on anything but a 256-wide image,
// and src/lib/colormap.ts indexes rows by COLORMAP_INDEX, which is only correct while there is
// exactly one row per name that package exports.
const spriteWidth = sprite.readUInt32BE(16);
const spriteHeight = sprite.readUInt32BE(20);
if (spriteWidth !== 256) {
  throw new Error(
    `${COLORMAP_SPRITE} is ${spriteWidth}px wide, not the 256 createColormapTexture requires. Check what changed upstream, and update src/lib/colormap.ts and this script.`,
  );
}
if (spriteHeight !== Object.keys(COLORMAP_INDEX).length) {
  throw new Error(
    `${COLORMAP_SPRITE} has ${spriteHeight} rows, but COLORMAP_INDEX names ${Object.keys(COLORMAP_INDEX).length} ramps. The two have to agree on which row is which ramp - check what changed upstream, and update src/lib/colormap.ts and this script.`,
  );
}

// JSON rather than template literals: both of these carry backticks and backslashes of their own.
const entries = icons.map(([name, svg]) => `  ${JSON.stringify(name)}: ${JSON.stringify(svg)},`).join('\n');

writeFileSync(
  OUTPUT,
  `// Generated by scripts/inline-assets.mjs - do not edit. Read that script for what these are and
// why they are strings rather than files; run \`npm run build\` to write it again.

// ${THEME}, with its @imports inlined
export const webAwesomeThemeCss = ${JSON.stringify(css)};

// assets/icons, by the name a <wa-icon> asks for
export const iconSvgs: Record<string, string> = {
${entries}
};

// ${COLORMAP_SPRITE}, base64-encoded. See src/lib/colormap.ts for how this is decoded and read.
export const colormapSpriteBase64 = ${JSON.stringify(sprite.toString('base64'))};
`,
);

console.log(
  `inline-assets: ${Math.round(css.length / 1024)} KB of CSS, ${icons.length} icons, and a ${Math.round(sprite.length / 1024)} KB colormap sprite into src/lib/assets.generated.ts`,
);
