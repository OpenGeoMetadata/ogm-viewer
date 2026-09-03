import { Component, Element, Event, EventEmitter, Host, Prop, State, Watch, h } from '@stencil/core';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import {
  annotationEvidence,
  annotationOcrText,
  annotationText,
  annotationThumbnail,
  fetchContentSearch,
  fetchContentSearchPage,
  primaryEntity,
  type ContentSearchAnnotation,
  type ContentSearchEntityMatch,
} from '../../lib/content-search';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import type { RequestTransform } from '../../lib/request';

@Component({
  tag: 'ogm-search',
  styleUrl: 'ogm-search.css',
  shadow: true,
})
export class OgmSearch {
  @Element() el!: HTMLElement;
  @Prop() searchUrl!: string;
  @Prop() requestTransform?: RequestTransform;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @State() private query = '';
  @State() private submittedQuery = '';
  @State() private results: ContentSearchAnnotation[] = [];
  @State() private total = 0;
  @State() private page = 1;
  @State() private startIndex = 0;
  @State() private previousPageUrl?: string;
  @State() private nextPageUrl?: string;
  @State() private loading = false;
  @State() private error?: string;
  @Event({ bubbles: true, composed: true }) contentSearchResultSelected!: EventEmitter<ContentSearchAnnotation>;

  private pending = 0;

  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  @Watch('searchUrl')
  resetSearch() {
    this.pending++;
    this.query = '';
    this.submittedQuery = '';
    this.results = [];
    this.total = 0;
    this.page = 1;
    this.startIndex = 0;
    this.previousPageUrl = undefined;
    this.nextPageUrl = undefined;
    this.loading = false;
    this.error = undefined;
  }

  private onInput(event: Event) {
    this.query = (event.target as HTMLInputElement).value;
  }

  private onSubmit(event: Event) {
    event.preventDefault();
    void this.search(this.query, 1);
  }

  private async search(query: string, page: number, pageUrl?: string) {
    const normalized = query.trim();
    if (!normalized || !this.searchUrl) return;

    const request = ++this.pending;
    this.loading = true;
    this.error = undefined;
    try {
      const response = pageUrl ? await fetchContentSearchPage(pageUrl, this.requestTransform) : await fetchContentSearch(this.searchUrl, normalized, this.requestTransform, page);
      if (request !== this.pending) return;
      this.submittedQuery = normalized;
      this.results = response.items ?? [];
      this.total = response.partOf?.total ?? this.results.length;
      this.page = page;
      this.startIndex = response.startIndex ?? 0;
      this.previousPageUrl = linkId(response.prev);
      this.nextPageUrl = linkId(response.next);
    } catch (error) {
      if (request !== this.pending) return;
      console.error(`Error searching ${this.searchUrl}:`, error);
      this.results = [];
      this.total = 0;
      this.previousPageUrl = undefined;
      this.nextPageUrl = undefined;
      this.error = error instanceof Error ? error.message : 'The search service could not be read.';
    } finally {
      if (request === this.pending) this.loading = false;
    }
  }

  private renderStatus() {
    if (this.loading) return <p class="status">Searching this map…</p>;
    if (this.error)
      return (
        <p class="status error" role="alert">
          Search failed. {this.error}
        </p>
      );
    if (!this.submittedQuery) return <p class="status">Find printed words and matched places inside this map.</p>;
    if (!this.results.length) return <p class="status">No matches for “{this.submittedQuery}”.</p>;
    const gazetteerResults = this.results.filter(result => annotationEvidence(result)?.matched_by === 'gazetteer_entity').length;
    return (
      <p class="status" aria-live="polite">
        {this.total.toLocaleString()} {gazetteerResults > 0 ? 'gazetteer-linked ' : ''}
        {this.total === 1 ? 'occurrence' : 'occurrences'} for “{this.submittedQuery}”
      </p>
    );
  }

  private renderResult(annotation: ContentSearchAnnotation, index: number) {
    const evidence = annotationEvidence(annotation);
    const entity = primaryEntity(annotation);
    const thumbnail = annotationThumbnail(annotation);
    const ocrText = annotationOcrText(annotation);
    const confidence = typeof evidence?.confidence === 'number' ? `${Math.round(evidence.confidence * 100)}% OCR confidence` : undefined;
    const resultLabel = entity?.label ?? annotationText(annotation);
    const source = entitySource(entity);
    const featureType = entityFeatureType(entity);

    return (
      <li key={annotation.id ?? `${this.page}-${index}`}>
        <button type="button" class="result" onClick={() => this.contentSearchResultSelected.emit(annotation)}>
          <span class="result-number">{this.startIndex + index + 1}</span>
          {thumbnail && <img class="crop-thumbnail" src={thumbnail} alt={`Map crop containing ${resultLabel}`} loading="lazy" />}
          <span class="result-detail">
            <span class="entity-label">{resultLabel}</span>
            <span class="provenance">{entity ? ['Gazetteer entity', source, featureType].filter(Boolean).join(' · ') : 'OCR text match'}</span>
            {ocrText && <span class="ocr-text">Map reads “{ocrText}”</span>}
            {confidence && <span class="confidence">{confidence}</span>}
          </span>
        </button>
      </li>
    );
  }

  render() {
    return (
      <Host class={waScope(this.theme)}>
        <form role="search" onSubmit={event => this.onSubmit(event)}>
          <label htmlFor="content-search">Search within this map</label>
          <div class="query-row">
            <input id="content-search" type="search" value={this.query} onInput={event => this.onInput(event)} placeholder="Words, streets, or places" autocomplete="off" />
            <button type="submit" class="submit" disabled={this.loading || !this.query.trim()} aria-label="Search">
              <wa-icon name="search" label="Search" canvas="auto"></wa-icon>
            </button>
          </div>
        </form>
        {this.renderStatus()}
        {this.results.length > 0 && <ol class="results">{this.results.map((result, index) => this.renderResult(result, index))}</ol>}
        {(this.previousPageUrl || this.nextPageUrl) && (
          <nav class="pagination" aria-label="Search result pages">
            <button type="button" disabled={this.loading || !this.previousPageUrl} onClick={() => void this.search(this.submittedQuery, this.page - 1, this.previousPageUrl)}>
              Previous
            </button>
            <span>Page {this.page}</span>
            <button type="button" disabled={this.loading || !this.nextPageUrl} onClick={() => void this.search(this.submittedQuery, this.page + 1, this.nextPageUrl)}>
              Next
            </button>
          </nav>
        )}
      </Host>
    );
  }
}

function linkId(link?: string | { id?: string }): string | undefined {
  return typeof link === 'string' ? link : link?.id;
}

function entitySource(entity?: ContentSearchEntityMatch): string | undefined {
  const source = entity?.properties?.source;
  if (typeof source !== 'string' || !source) return undefined;
  const knownSources: Record<string, string> = { geonames: 'GeoNames', gnis: 'GNIS', overture: 'Overture', wof: "Who's On First" };
  return knownSources[source.toLowerCase()] ?? source.replaceAll('_', ' ');
}

function entityFeatureType(entity?: ContentSearchEntityMatch): string | undefined {
  const feature = entity?.properties?.canonical_feature_group ?? entity?.properties?.feature_code;
  if (typeof feature !== 'string' || !feature) return undefined;
  return feature.replaceAll('_', ' ');
}
