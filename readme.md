[![CI](https://github.com/OpenGeoMetadata/ogm-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenGeoMetadata/ogm-viewer/actions/workflows/ci.yml)
[![Built With Stencil](https://img.shields.io/badge/-Built%20With%20Stencil-16161d.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjIuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPgo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4IgoJIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI%2BCjxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI%2BCgkuc3Qwe2ZpbGw6I0ZGRkZGRjt9Cjwvc3R5bGU%2BCjxwYXRoIGNsYXNzPSJzdDAiIGQ9Ik00MjQuNywzNzMuOWMwLDM3LjYtNTUuMSw2OC42LTkyLjcsNjguNkgxODAuNGMtMzcuOSwwLTkyLjctMzAuNy05Mi43LTY4LjZ2LTMuNmgzMzYuOVYzNzMuOXoiLz4KPHBhdGggY2xhc3M9InN0MCIgZD0iTTQyNC43LDI5Mi4xSDE4MC40Yy0zNy42LDAtOTIuNy0zMS05Mi43LTY4LjZ2LTMuNkgzMzJjMzcuNiwwLDkyLjcsMzEsOTIuNyw2OC42VjI5Mi4xeiIvPgo8cGF0aCBjbGFzcz0ic3QwIiBkPSJNNDI0LjcsMTQxLjdIODcuN3YtMy42YzAtMzcuNiw1NC44LTY4LjYsOTIuNy02OC42SDMzMmMzNy45LDAsOTIuNywzMC43LDkyLjcsNjguNlYxNDEuN3oiLz4KPC9zdmc%2BCg%3D%3D&colorA=16161d&style=flat-square)](https://stenciljs.com)

# OpenGeoMetadata Viewer

A web-based viewer for previewing [OpenGeoMetadata](https://opengeometadata.org/) records. Try the [online demo](http://opengeometadata.org/ogm-viewer/)!

## Installation

You can add the viewer to your project by including the following script tag in your HTML:

```html
<script type="module" src="https://unpkg.com/ogm-viewer"></script>
```

That URL will point to the latest released version automatically. To point to a stable version, you can supply it in the URL:

```html
<script type="module" src="https://unpkg.com/ogm-viewer@1.6.0"></script>
```

### Using a bundler

If using a bundler, you can install it via npm:

```bash
npm install ogm-viewer
```

Then add it to your entrypoint file:

```javascript
import 'ogm-viewer';
```

### Content Security Policy

The viewer delegates tile-decoding work to a web worker, so pages that set a Content Security Policy need `blob:` in their `worker-src` (or `child-src`, `script-src`, or `default-src` as appropriate). The actual decoding is a WebAssembly module, so `script-src` also needs `'wasm-unsafe-eval'`. The WebAssembly module and the viewer's icons are drawn using data URLs, so `connect-src` needs `data:` as well.

## Usage

Once installed, the viewer can be used in your HTML as a web component:

```html
<ogm-viewer record-url="https://example.com/record.json"></ogm-viewer>
```

The `record-url` attribute should point to an [OpenGeoMetadata Aardvark](https://opengeometadata.org/ogm-aardvark/) record in JSON format.

You can also programmatically set the record URL using JavaScript:

```javascript
const viewer = document.querySelector('ogm-viewer');
viewer.recordUrl = 'https://example.com/record.json';
```

When the record URL changes, the viewer will automatically fetch and display the record data. Setting it to `undefined` or removing the attribute clears the viewer.

The viewer components provided by this library don't have an intrinsic size, so you'll need to set one in CSS:

```css
ogm-viewer {
  width: 600px;
  height: 400px;
}
```

### Dark mode support

The viewer supports dark mode. If your system preference is set to prefer dark mode, the viewer will automatically apply dark styles.

To programmatically control dark mode, you can use the `theme` attribute with a value of `dark` or `light`:

```html
<ogm-viewer record-url="https://example.com/record.json" theme="dark"></ogm-viewer>
```

### Basemaps

By default, the viewer draws on one of [CARTO](https://carto.com/basemaps)'s basemaps: Dark Matter in dark mode, Positron in light mode. To use a different one for either mode, set `dark-basemap` and/or `light-basemap` to a URL for a [MapLibre style document](https://maplibre.org/maplibre-style-spec/):

```html
<ogm-viewer record-url="https://example.com/record.json" light-basemap="https://api.maptiler.com/maps/basic-v2/style.json></ogm-viewer>
```

Both attributes are also DOM properties, so they can be set from JavaScript the same way `theme` can.

CARTO watermarks a basemap requested without an API key. If you have [your own CARTO API key](https://carto.com/basemaps/apikey/), build the full style URL yourself and pass that:

```html
<ogm-viewer
  record-url="https://example.com/record.json"
  dark-basemap="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json?key=your-key"
  light-basemap="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=your-key"
></ogm-viewer>
```

You can find basemaps that don't require an API key to use offered by [OpenFreeMap](https://openfreemap.org/quick_start/).

#### Layer order

By default, previews are drawn underneath the basemap's labels, so place names stay readable over the data. You can choose which layer the preview is inserted before using `before-id`; it defaults to `watername_ocean`, which in CARTO's basemaps is underneath most text labels but above everything else.

You can set `before-id` to the layer you want previews drawn under, either in the default basemap or in one you provide:

```html
<ogm-viewer record-url="https://example.com/record.json" before-id="boundaries"></ogm-viewer>
```

If `before-id` is empty or there is no layer in the basemap with that ID, the preview is drawn on top of everything.

### Colors

You can style the viewer's colors by setting CSS custom properties on its element.

```css
ogm-viewer {
  --ogm-data-color: #8f1414;
}
```

Here are the supported properties and what they apply to:

| Property                       | Applies to                                              |
| ------------------------------ | ------------------------------------------------------- |
| `--ogm-data-color`             | Polygon fill, line geometry, and circle fill            |
| `--ogm-highlight-color`        | The same, for a hovered feature                         |
| `--ogm-selected-color`         | The same, for the feature whose attributes are shown    |
| `--ogm-invalid-color`          | The same, for a feature marked unavailable              |
| `--ogm-marker-color`           | Disc a numbered result's marker is drawn on             |
| `--ogm-marker-highlight-color` | The same, for the highlighted result                    |
| `--ogm-stroke-color`           | Polygon outlines and circle borders                     |
| `--ogm-stroke-highlight-color` | Outline of a hovered feature                            |
| `--ogm-stroke-selected-color`  | Outline of the selected feature                         |
| `--ogm-stroke-invalid-color`   | Outline of a feature marked unavailable                 |
| `--ogm-text-color`             | Feature label text color                                |
| `--ogm-text-halo-color`        | Feature label text outline color                        |
| `--ogm-text-size`              | Feature label font size, in pixels                      |
| `--ogm-font-family`            | Feature label font name (e.g. `"Noto Sans Regular"`)    |
| `--ogm-marker-font`            | CSS font stack for a numbered marker's numeral          |
| `--ogm-data-opacity`           | Initial opacity of drawn data                           |
| `--ogm-highlight-opacity`      | Opacity of a highlighted feature                        |
| `--ogm-bounds-opacity`         | Initial opacity of a bounding box or index map geometry |
| `--ogm-padding`                | Gap kept between the data and the view edge (pixels)    |
| `--ogm-overview-padding`       | Gap for locator and overview maps (pixels)              |

By default, the viewer uses styles from [Web Awesome](https://webawesome.com/) that match the current mode (dark or light). Some properties are derived from others by darkening or lightening them, if not provided explicitly.

### Restricted content

For previews of data that need authentication to access, you can set a custom `requestTransform` function to add headers or cookies to the request. It's a DOM property on `<ogm-viewer>` that you can set in JavaScript, like the `recordUrl` property:

```javascript
viewer.requestTransform = (url, resourceType) => {
  // If we aren't requesting something from the restricted server, skip this
  if (!url.startsWith('https://geo.my-domain.edu/restricted/')) return undefined;

  // Otherwise, add an Authorization header with a bearer token
  return { headers: { Authorization: `Bearer ${token}` } };
};
```

The `requestTransform` will be applied to all requests made by the viewer, including metadata and tiles, as well as the requests for the MapLibre basemap. You may want to delegate to additional functions that can handle these different cases based on what is being requested.

### Cooperative gestures

`<ogm-preview>`, `<ogm-locator>`, and `<ogm-overview>` all require a reader to hold Ctrl (⌘ on a Mac) to zoom the map with the scroll wheel, and a second finger to pan it on a touchscreen, so that a map sitting inside a page doesn't steal the scroll a reader meant for the page around it. Set `cooperative-gestures` to `false` on any of them to turn this off and answer to the wheel and a single touch right away:

```html
<ogm-locator record-url="https://example.com/record.json" cooperative-gestures="false"></ogm-locator>
```

### Georeferenced maps

A scanned map with a [IIIF Georeference Annotation](https://iiif.io/api/extension/georef/) is previewable two ways: as an image and as a layer warped onto the map. Both come from one `IIIFManifestResource`, but `<ogm-viewer>` shows them as two separate preview tabs.

The viewer looks for the annotation in this order:

1. Inside the manifest, following the annotation pages a canvas links until it finds one.
2. A `dct_references_s` key of `https://iiif.io/api/extension/georef/1/context.json` pointing at a standalone annotation.

When a record has both, the copy in the manifest wins. Only the first canvas is inspected, so a paged object with an annotation per page is left alone as of now.

The map tab doesn't support the globe view or pan/tilt. These are constraints based on Allmaps' rendering engine, which is used to warp the image. There's also no way to hook into Allmaps' tile requests, so if the annotation points at a restricted image, it won't be able to fetch it. The viewer will still show the image tab, but the map tab will be blank.

### Locator maps

To show where a single record is on earth, you can use the `<ogm-locator>` component. Give it a `record-url` and it uses the record's geometry or bounding box to draw an outline on a map:

```html
<ogm-locator record-url="https://example.com/record.json"></ogm-locator>
```

### Overviews

For showing where several records are, you can use the `<ogm-overview>` component. Pass it a list of `OgmRecord` objects and it will draw a numbered marker on the globe representing each record.

```js
await customElements.whenDefined('ogm-overview');

document.querySelector('ogm-overview').records = [record1, record2];
```

When the markers are hovered, the record's outline is drawn on the map, like in a locator map. The `highlightChange` event says which record it is, so you can use this information to take other actions too.

```js
overview.addEventListener('highlightChange', event => console.log(event.detail));
```

To highlight a record explicitly, set `highlighted` to either its number in the list (counted from one), or the id of the record it came from. Anything else will clear the current highlight. Setting `highlighted` to explicitly highlight a record doesn't fire `highlightChange`, so you won't get an infinite loop.

```js
overview.highlighted = 3;
```

#### Geosearch

If you add the `geosearch` attribute to an overview, a reader can search using the map by holding shift and dragging a box over it.

```html
<ogm-overview geosearch></ogm-overview>
```

The area drawn is reported via the `boundsChange` event.

```javascript
document.querySelector('ogm-overview').addEventListener('boundsChange', event => {
  // west, south, east, north - with east numerically west of west for a box crossing the antimeridian
  console.log('New bounds:', event.detail);
});
```

If a search is executed externally, you can set the `search-bounds` attribute to reflect it on the map. It's drawn as a box and framed by the camera. It will accept an `ENVELOPE` string, or anything else MapLibre reads as bounds.

```html
<ogm-overview search-bounds="ENVELOPE(-124.41,-114.13,42.01,32.53)"></ogm-overview>
```

If you want to move the camera to a specific area, you can set the `view-bounds` attribute the same way. This won't draw a box and will try to fit the exact bounds provided, without applying any padding.

```html
<ogm-overview view-bounds="ENVELOPE(-124.41,-114.13,42.01,32.53)"></ogm-overview>
```

### Advanced usage

If you're building your own viewer, you can adopt `<ogm-viewer>`'s components individually. The viewer is populated with `Previewer`s, each of which wraps a single `Resource` containing data and renders it to a provided map or image canvas.

The easiest way to render a single preview without the full viewer is to use the `<ogm-preview>` component with a `Previewer` and corresponding `Resource`. For example, to preview a GeoJSON resource:

```javascript
import 'ogm-viewer';
import { GeoJsonPreviewer, GeoJsonResource } from 'ogm-viewer/lib';

await customElements.whenDefined('ogm-preview');

const resource = new GeoJsonResource('my-layer', 'https://example.com/data.json');
document.querySelector('ogm-preview').previewer = new GeoJsonPreviewer(resource);
```

Note that `previewer` is a DOM property, not an attribute — you have to await for the element to be defined and then set it in JavaScript.

For more than one preview, `<ogm-previews>` renders the same tab strip `<ogm-viewer>` uses. Pass it a `record` and it works out what that record offers; pass it `previewers` and it uses those directly instead:

```javascript
document.querySelector('ogm-previews').previewers = [new GeoJsonPreviewer(geoJsonResource), new OpenIndexMapPreviewer(indexMapResource)];
```

## Development

After cloning the repository, install dependencies:

```bash
npm install
```

You can start a local development web server with:

```bash
npm start
```

### Formatting

Code is formatted using Prettier. To format your code for a pull request, run:

```bash
npx prettier --write .
```

To type-check and lint your code, run:

```bash
npm run lint
```

### Tests

You can run all tests together or specify a test type:

```bash
npm test                  # runs all tests
npm run test:unit         # runs only unit tests
npm run test:component    # runs only component tests
```

Unit tests use the `*.test.ts` extension, while component tests use `*.test.tsx`.

For more information on testing, see the [Stencil documentation](https://stenciljs.com/docs/testing-overview).

### Releasing

Pushing a version tag publishes it. Update the version in `package.json`, run `npm install` so the lockfile agrees, and commit that on `main`. Then tag it:

```bash
git tag vX.Y.Z # replace with your new version number
git push origin vX.Y.Z
```

The `Release` workflow checks that the tag and `package.json` agree, lints, tests, publishes to npm, and drafts the GitHub release with generated notes. It authenticates with npm over OIDC using [trusted publishing](https://docs.npmjs.com/trusted-publishers).
