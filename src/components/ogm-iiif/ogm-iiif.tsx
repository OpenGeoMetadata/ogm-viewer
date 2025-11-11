import { Component, Prop, State, Watch, h, Host } from '@stencil/core';

@Component({
  tag: 'ogm-iiif',
  styleUrl: 'ogm-iiif.css',
  shadow: false,
})
export class OgmIiif {
  @Prop() manifestUrl: string;
  @Prop() theme: 'light' | 'dark';

  @State() cloverReady: boolean = false;
  @State() loadError: boolean = false;
  @State() frameLoaded: boolean = false;
  private frameEl?: HTMLIFrameElement;

  async componentWillLoad() {
    // When rendering via iframe, no external script load is needed here.
    this.cloverReady = true;
  }

  // Minimal HTML document to sandbox Clover IIIF inside an iframe.
  private buildIframeSrcdoc(url: string): string {
    const escapedUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://www.unpkg.com/@samvera/clover-iiif@latest/dist/web-components/index.umd.js"></script>
    <style>
      html, body { height: 100%; margin: 0; }
      clover-viewer { display: block; height: 100%; width: 100%; }
      /* Hide Clover header entirely */
      .clover-viewer-header { display: none !important; }
    </style>
  </head>
  <body class="${this.theme ? `sl-theme-${this.theme}` : ''}">
    <clover-viewer iiif-content="${escapedUrl}"></clover-viewer>
    <script>
      // Turn off information panel as soon as toggle is available
      (function() {
        function tryCloseInfo() {
          var t = document.getElementById('information-toggle');
          if (!t) return false;
          var state = t.getAttribute('aria-checked') || t.getAttribute('data-state');
          if (state === 'true' || state === 'checked') {
            t.click();
          }
          return true;
        }
        if (!tryCloseInfo()) {
          var mo = new MutationObserver(function() {
            if (tryCloseInfo()) mo.disconnect();
          });
          mo.observe(document.body, { childList: true, subtree: true });
          setTimeout(function(){ mo.disconnect(); }, 5000);
        }
      })();
    </script>
  </body>
</html>
`.trim();
  }

  private updateIframeThemeClass() {
    if (!this.frameEl?.contentWindow?.document?.body) return;
    const body = this.frameEl.contentWindow.document.body;
    body.classList.remove('sl-theme-light', 'sl-theme-dark');
    if (this.theme) body.classList.add(`sl-theme-${this.theme}`);
  }

  componentDidLoad() {
    this.updateIframeThemeClass();
  }

  // React to external theme prop changes
  @Watch('theme')
  onThemeChanged() {
    this.updateIframeThemeClass();
  }

  render() {
    if (this.loadError || !this.manifestUrl) return;
    const srcdoc = this.buildIframeSrcdoc(this.manifestUrl);
    return (
      <Host class={this.theme && `sl-theme-${this.theme}`}>
        <div class="wrapper">
          {!this.frameLoaded && (
            <div class="loading">
              <sl-spinner></sl-spinner>
            </div>
          )}
          {this.cloverReady && (
            <iframe
              class="clover-frame"
              part="clover-frame"
              srcdoc={srcdoc}
              loading="lazy"
              ref={el => (this.frameEl = el as HTMLIFrameElement)}
              onLoad={() => {
                this.frameLoaded = true;
                this.updateIframeThemeClass();
              }}
              title="Clover IIIF Viewer"
            ></iframe>
          )}
        </div>
      </Host>
    );
  }
}


