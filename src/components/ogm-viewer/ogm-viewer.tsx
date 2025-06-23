import { Component, Element, h } from "@stencil/core";
import { Map } from "maplibre-gl";

@Component({
  tag: "ogm-viewer",
  styleUrl: "ogm-viewer.css",
  shadow: true,
})
export class OgmViewer {
  @Element() el: HTMLElement;

  private map: Map;

  componentDidLoad() {
    this.map = new Map({
      container: this.el.shadowRoot.getElementById("map"),
      style: "https://demotiles.maplibre.org/style.json",
      center: [0, 0],
      zoom: 2,
    });
  }

  render() {
    return (
      <div>
        <h1>OGM Viewer</h1>
        <p>Welcome to the OGM Viewer component!</p>
        <div id="map" style={{ width: "100%", height: "400px" }}></div>
      </div>
    );
  }
}
