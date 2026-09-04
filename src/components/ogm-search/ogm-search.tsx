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

type SearchResultGroup = {
  key: string;
  label: string;
  entity?: ContentSearchEntityMatch;
  result: ContentSearchAnnotation;
};

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
    const groupedByEntity = this.results.some(result => primaryEntity(result));
    return (
      <p class="status" aria-live="polite">
        {this.total.toLocaleString()} {this.total === 1 ? 'result' : 'results'} for “{this.submittedQuery}”{groupedByEntity ? ' · gazetteer matches' : ''}
      </p>
    );
  }

  private renderResult(annotation: ContentSearchAnnotation, index: number, entityLabel: string) {
    const thumbnail = annotationThumbnail(annotation);
    const ocrText = annotationOcrText(annotation);
    const showOcrText = ocrText && normalized(ocrText) !== normalized(entityLabel);

    return (
      <li key={annotation.id ?? `${this.page}-${index}`} class="occurrence">
        <button
          type="button"
          class="crop-result"
          aria-label={`View search result ${this.startIndex + index + 1} for ${entityLabel}`}
          onClick={() => this.contentSearchResultSelected.emit(annotation)}
        >
          <span class="result-number">{this.startIndex + index + 1}</span>
          {thumbnail ? <img class="crop-thumbnail" src={thumbnail} alt="" loading="lazy" /> : <span class="crop-placeholder">No crop</span>}
          {showOcrText && <span class="ocr-text">OCR: “{ocrText}”</span>}
        </button>
      </li>
    );
  }

  private renderGroup(group: SearchResultGroup, index: number) {
    const source = entitySource(group.entity);
    const featureType = entityFeatureType(group.entity);
    const metadata = [source, featureType].filter(Boolean).join(' · ');

    return (
      <li key={group.key} class="entity-result">
        <header class="entity-heading">
          <h3 class="entity-label">{group.label}</h3>
          {metadata && <p class="entity-metadata">{metadata}</p>}
        </header>
        <ol class="occurrences">{this.renderResult(group.result, index, group.label)}</ol>
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
        {this.results.length > 0 && <ol class="results">{groupSearchResults(this.results).map((group, index) => this.renderGroup(group, index))}</ol>}
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

function groupSearchResults(results: ContentSearchAnnotation[]): SearchResultGroup[] {
  const groups = new Map<string, SearchResultGroup>();
  results.forEach((annotation, index) => {
    const entity = primaryEntity(annotation);
    const label = entity?.label ?? annotationText(annotation);
    const key = entity ? entityGroupKey(entity) : (annotation.id ?? `ocr-result:${index}`);
    const existing = groups.get(key);
    if (!existing || resultRank(annotation, label) > resultRank(existing.result, existing.label)) {
      groups.set(key, { key, label, entity, result: annotation });
    }
  });
  return [...groups.values()];
}

function resultRank(annotation: ContentSearchAnnotation, entityLabel: string): number {
  const ocrText = annotationOcrText(annotation) ?? annotationText(annotation);
  const entity = primaryEntity(annotation);
  const exactText = normalized(ocrText) === normalized(entityLabel) ? 1 : 0;
  const confirmed = entity?.outcome === 'confirmed' ? 1 : 0;
  const entityConfidence = typeof entity?.confidence === 'number' ? entity.confidence : 0;
  const observationConfidence = annotationEvidence(annotation)?.confidence;
  return exactText * 1_000_000 + confirmed * 100_000 + entityConfidence * 1_000 + (typeof observationConfidence === 'number' ? observationConfidence * 100 : 0) + ocrText.length;
}

function entityGroupKey(entity: ContentSearchEntityMatch): string {
  const canonicalId = entity.properties?.canonical_entity_id;
  if (typeof canonicalId === 'string' && canonicalId) return `canonical:${canonicalId}`;
  return entity.id ? `entity:${entity.id}` : `label:${normalized(entity.label ?? '')}`;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll(/\s+/g, ' ');
}
