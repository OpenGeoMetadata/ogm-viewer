[![CI](https://github.com/OpenGeoMetadata/ogm-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenGeoMetadata/ogm-viewer/actions/workflows/ci.yml)
[![Built With Stencil](https://img.shields.io/badge/-Built%20With%20Stencil-16161d.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjIuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPgo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4IgoJIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI%2BCjxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI%2BCgkuc3Qwe2ZpbGw6I0ZGRkZGRjt9Cjwvc3R5bGU%2BCjxwYXRoIGNsYXNzPSJzdDAiIGQ9Ik00MjQuNywzNzMuOWMwLDM3LjYtNTUuMSw2OC42LTkyLjcsNjguNkgxODAuNGMtMzcuOSwwLTkyLjctMzAuNy05Mi43LTY4LjZ2LTMuNmgzMzYuOVYzNzMuOXoiLz4KPHBhdGggY2xhc3M9InN0MCIgZD0iTTQyNC43LDI5Mi4xSDE4MC40Yy0zNy42LDAtOTIuNy0zMS05Mi43LTY4LjZ2LTMuNkgzMzJjMzcuNiwwLDkyLjcsMzEsOTIuNyw2OC42VjI5Mi4xeiIvPgo8cGF0aCBjbGFzcz0ic3QwIiBkPSJNNDI0LjcsMTQxLjdIODcuN3YtMy42YzAtMzcuNiw1NC44LTY4LjYsOTIuNy02OC42SDMzMmMzNy45LDAsOTIuNywzMC43LDkyLjcsNjguNlYxNDEuN3oiLz4KPC9zdmc%2BCg%3D%3D&colorA=16161d&style=flat-square)](https://stenciljs.com)

# OpenGeoMetadata Viewer

A web-based viewer for previewing [OpenGeoMetadata](https://opengeometadata.org/) records. Try the [online demo](http://opengeometadata.org/ogm-viewer/)!

## Installation

You can add the viewer to your project by including the following script tag in your HTML:

```html
<script type="module" src="https://unpkg.com/ogm-viewer"></script>
```

If using a bundler, you can install it via npm:

```bash
npm install ogm-viewer
```

Then add it to your entrypoint file:

```javascript
import 'ogm-viewer';
```

## Usage

Once installed, the viewer can be used in your HTML as a web component:

```html
<ogm-viewer record-url="https://example.com/record.json"></ogm-viewer>
```

The `record-url` attribute should point to a valid [OpenGeoMetadata Aardvark](https://opengeometadata.org/ogm-aardvark/) record in JSON format.

You can also programmatically set the record URL using JavaScript:

```javascript
const viewer = document.querySelector('ogm-viewer');
viewer.recordUrl = 'https://example.com/record.json';
```

When the record URL changes, the viewer will automatically fetch and display the record data.

### Dark mode support

The viewer supports dark mode. If your system preference is set to prefer dark mode, the viewer will automatically apply dark styles.

To programmatically control dark mode, you can use the `theme` attribute with a value of `dark` or `light`:

```html
<ogm-viewer record-url="https://example.com/record.json" theme="dark"></ogm-viewer>
```

### Colors

You can style the viewer's colors by setting CSS custom properties on its element.

```css
ogm-viewer {
  --ogm-fill-color: #8f1414;
  --ogm-stroke-color: #4a0a0a;
}
```

Here are the supported properties and what they apply to:

| Property                       | Applies to                                           |
| ------------------------------ | ---------------------------------------------------- |
| `--ogm-fill-color`             | Polygon and circle fill                              |
| `--ogm-fill-highlight-color`   | Fill of a hovered feature                            |
| `--ogm-fill-selected-color`    | Fill of the feature whose attributes are shown       |
| `--ogm-fill-invalid-color`     | Fill of a feature marked unavailable                 |
| `--ogm-stroke-color`           | Lines, and polygon and circle borders                |
| `--ogm-stroke-highlight-color` | Stroke of a hovered feature                          |
| `--ogm-stroke-selected-color`  | Stroke of the selected feature                       |
| `--ogm-stroke-invalid-color`   | Stroke of a feature marked unavailable               |
| `--ogm-text-color`             | Feature label text color                             |
| `--ogm-text-halo-color`        | Feature label text outline color                     |
| `--ogm-text-size`              | Feature label font size, in pixels                   |
| `--ogm-font-family`            | Feature label font name (e.g. `"Noto Sans Regular"`) |
| `--ogm-fill-opacity`           | Initial opacity of drawn data                        |
| `--ogm-fill-highlight-opacity` | Opacity of a highlighted feature                     |
| `--ogm-padding`                | Gap kept between the data and the map edge (pixels)  |

By default, the viewer uses styles from [Web Awesome](https://webawesome.com/) that match the current mode (dark or light). Anything you override will be used in both modes.

### Restricted content

For previews of data that need authentication to access, you can set a custom `requestTransform` function to add headers or cookies to the request. It's a DOM property on `<ogm-viewer>` that you can set in JavaScript, like the `recordUrl` property:

```javascript
viewer.requestTransform = (url, resourceType) => {
  // If we aren't requesting something from the restricted area, don't do anything
  if (!url.startsWith('https://geo.my-domain.edu/restricted/')) return undefined;

  // Otherwise, add an Authorization header with a bearer token
  return { headers: { Authorization: `Bearer ${token}` } };
};
```

If you're building a `Resource` by hand instead, pass the same kind of function as its last constructor argument (or to `resourcesFor`, if you're building several from a record):

```javascript
import { GeoJsonResource } from 'ogm-viewer/lib';

const resource = new GeoJsonResource('my-layer', 'https://example.com/restricted/data.json', undefined, requestTransform);
```

The `requestTransform` will be applied to all requests made by the viewer for that resource, including metadata and tiles, as well as the requests for the MapLibre basemap.

There are two exceptions, both because the library drawing them fetches its own tiles and offers no way in: a Cloud Optimized GeoTIFF drawn by `DeckCogPreviewer`, and the IIIF image tiles behind a georeferenced map. For a restricted COG, build a `CogPreviewer` by hand instead — it can carry headers, though only for one COG per page.

### Georeferenced maps

A scanned map with a [IIIF Georeference Annotation](https://iiif.io/api/extension/georef/) is previewable two ways: as an image to page through, and as a layer warped onto the earth. Both come from one `IIIFManifestResource`, so `<ogm-viewer>` shows them as two tabs, image first.

Nothing needs configuring. The viewer finds the annotation itself, looking in this order:

1. Inside the manifest, following the annotation pages a canvas links until it finds one.
2. Failing that, a `dct_references_s` key of `https://iiif.io/api/extension/georef/1/context.json` pointing at a standalone annotation.

When a record has both, the copy in the manifest wins — a manifest generated at request time is the more current of the two. Only the first canvas is inspected, so a paged object with an annotation per page is left alone for now.

The map tab is drawn flat, has no globe button, and can't be tilted. Allmaps paints the warped scan with its own WebGL rather than MapLibre's, and works out where to put it from the map's centre, its bearing, and a single units-per-pixel scale — a description of a flat, north-up map, and not of a sphere or a tilted one. On a globe the scan drifts as you zoom out: imperceptibly at the zoom you'd actually read a sheet at, and out by half again by zoom 3. Pitch is wrong the same way, by a quarter at 30° and more than double at 60°. Every other preview keeps the globe and the pitch.

To build one by hand, the manifest resource takes the standalone annotation URL as its last argument, and works out the rest:

```javascript
import { GeoreferencePreviewer, IIIFManifestResource } from 'ogm-viewer/lib';

const resource = new IIIFManifestResource('my-map', manifestUrl, undefined, undefined, annotationUrl);
if (await resource.isGeoreferenced()) {
  document.querySelector('ogm-preview').previewer = new GeoreferencePreviewer(resource);
}
```

### Components

If you're building your own viewer, you can adopt `<ogm-viewer>`'s components individually.

The easiest way to render a single preview without the full viewer is to use the `<ogm-preview>` component with a `Previewer` and corresponding `Resource`. For example, to preview a GeoJSON resource:

```javascript
import 'ogm-viewer';
import { GeoJsonPreviewer, GeoJsonResource } from 'ogm-viewer/lib';

await customElements.whenDefined('ogm-preview');

const resource = new GeoJsonResource('my-layer', 'https://example.com/data.json');
document.querySelector('ogm-preview').previewer = new GeoJsonPreviewer(resource);
```

Note that `previewer` is a DOM property, not an attribute — await for the element to be defined and then set it in JavaScript.

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

To publish a new version, update the version in `package.json`, run `npm install`, and commit your changes. Then create a release tag:

```bash
git tag vX.Y.Z # replace with your new version number
git push --tags
```

After tagging, build the project and publish it to npm:

```bash
npm run build
npm login
npm publish
```

You can create a new release on GitHub by going to the "Releases" section and clicking "Draft a new release". The "Generate release notes" option will automatically include the changes since the last tag.
