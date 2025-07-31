import { LngLat } from "maplibre-gl"
import { References } from "./references";
import maplibregl from 'maplibre-gl';

export const addLayerInspection = (layer_id: string, infoUrl: string, references: References, map: maplibregl.Map) => {
  map.on('click', (e) => {
    if (references.wms) recordWMSInspection(layer_id, infoUrl, map, e.lngLat)
  })
}

const recordWMSInspection = (layer_id: string, infoUrl: String, map: maplibregl.Map, lngLat: LngLat) => {
  const bbox = map.getBounds();
  const width = map.getCanvas().width;
  const height = map.getCanvas().height;

  const point = map.project(lngLat);
  const params = new URLSearchParams([
    ['SERVICE', 'WMS'],
    ['REQUEST', 'GetFeatureInfo'],
    ['VERSION', '1.1.1'],
    ['LAYERS', layer_id.split('-').slice(-1)[0]],
    ['QUERY_LAYERS', layer_id.split('-').slice(-1)[0]],
    ['STYLES', ''],
    ['SRS', 'EPSG:4326'],
    ['BBOX', `${bbox.getWest()},${bbox.getSouth()},${bbox.getEast()},${bbox.getNorth()}`],
    ['WIDTH', width.toString()],
    ['HEIGHT', height.toString()],
    ['FORMAT', 'image/png'],
    ['INFO_FORMAT', 'application/json'],
    ['X', Math.round(point.x).toString()],
    ['Y', Math.round(point.y).toString()],
  ]);

  const url = `${infoUrl}?${params.toString()}`;

  fetch(url)
    .then(r => r.json()) // adjust if you use text/html
    .then(data => {
      new maplibregl.Popup({className: 'my-class'})
        .setLngLat(lngLat)
        .setHTML(`<div>${mapFeatureContent(data.features)}</div>`)
        .setMaxWidth("300px")
        .addTo(map);
    })
}

const mapFeatureContent = (features: any[]) => {
  let html = ''
  features.forEach((feature) => {
    for (const [key, value] of Object.entries(feature.properties)) {
    html += `<div class="line-container"><div class="label">${key}</div><div class="value">${value}</div></div>`
    }
  });
  return html
}