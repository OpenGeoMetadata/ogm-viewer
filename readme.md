[![CI](https://github.com/OpenGeoMetadata/ogm-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenGeoMetadata/ogm-viewer/actions/workflows/ci.yml)
[![Built With Stencil](https://img.shields.io/badge/-Built%20With%20Stencil-16161d.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjIuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPgo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4IgoJIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI%2BCjxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI%2BCgkuc3Qwe2ZpbGw6I0ZGRkZGRjt9Cjwvc3R5bGU%2BCjxwYXRoIGNsYXNzPSJzdDAiIGQ9Ik00MjQuNywzNzMuOWMwLDM3LjYtNTUuMSw2OC42LTkyLjcsNjguNkgxODAuNGMtMzcuOSwwLTkyLjctMzAuNy05Mi43LTY4LjZ2LTMuNmgzMzYuOVYzNzMuOXoiLz4KPHBhdGggY2xhc3M9InN0MCIgZD0iTTQyNC43LDI5Mi4xSDE4MC40Yy0zNy42LDAtOTIuNy0zMS05Mi43LTY4LjZ2LTMuNkgzMzJjMzcuNiwwLDkyLjcsMzEsOTIuNyw2OC42VjI5Mi4xeiIvPgo8cGF0aCBjbGFzcz0ic3QwIiBkPSJNNDI0LjcsMTQxLjdIODcuN3YtMy42YzAtMzcuNiw1NC44LTY4LjYsOTIuNy02OC42SDMzMmMzNy45LDAsOTIuNywzMC43LDkyLjcsNjguNlYxNDEuN3oiLz4KPC9zdmc%2BCg%3D%3D&colorA=16161d&style=flat-square)](https://stenciljs.com)

# OpenGeoMetadata Viewer

A web-based viewer for previewing [OpenGeoMetadata](https://opengeometadata.org/) records.

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

### Tests

To run tests, use:

```bash
npm test
```

Component unit tests use [Stencil's testing framework](https://stenciljs.com/docs/unit-testing).

### Releasing

To publish a new version, update the version in `package.json` and commit your changes. Then create a release tag:

```bash
git tag vX.Y.Z # replace with your new version number
git push --tags
```

After tagging, build the project and publish it to npm:

```bash
npm run build
npm publish
```

You can create a new release on GitHub by going to the "Releases" section and clicking "Draft a new release". The "Generate release notes" option will automatically include the changes since the last tag.
