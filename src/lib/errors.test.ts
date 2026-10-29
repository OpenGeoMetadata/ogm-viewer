import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { ChallengeError, HttpError, PreviewError, SignInError, TimeoutError, assertData, fetchOrThrow, recordError, referenceError } from './errors';

// What hgl.harvard.edu sends a request that lacks the cookie its own pages earn.
const wafChallenge = () => new Response(null, { status: 202, headers: { 'x-amzn-waf-action': 'challenge', 'content-type': 'text/html; charset=UTF-8', 'content-length': '0' } });

describe('errors', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('HttpError', () => {
    it('captures the status, statusText, and url', () => {
      const error = new HttpError('http://example.com/x', 404, 'Not Found');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('HttpError');
      expect(error.status).toBe(404);
      expect(error.statusText).toBe('Not Found');
      expect(error.url).toBe('http://example.com/x');
      expect(error.message).toContain('404');
    });
  });

  describe('TimeoutError', () => {
    it('records what was waited for and how long, for the console rather than the alert', () => {
      const error = new TimeoutError('a tile of http://example.com/wms', 20_000);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('TimeoutError');
      expect(error.message).toContain('http://example.com/wms');
      expect(error.message).toContain('20000');
    });
  });

  describe('fetchOrThrow', () => {
    it('returns the response when the status is ok', async () => {
      const response = new Response('{}', { status: 200 });
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(response);
      await expect(fetchOrThrow('http://example.com/ok')).resolves.toBe(response);
    });

    it('throws an HttpError when the status is not ok', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('nope', { status: 500, statusText: 'Server Error' }));
      await expect(fetchOrThrow('http://example.com/bad')).rejects.toMatchObject({ name: 'HttpError', status: 500, url: 'http://example.com/bad' });
    });

    it('propagates a network error (TypeError) unchanged', async () => {
      const networkError = new TypeError('Failed to fetch');
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(networkError);
      await expect(fetchOrThrow('http://example.com/cors')).rejects.toBe(networkError);
    });

    it('refuses an AWS WAF challenge, an empty 202 that would otherwise pass for ok', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(wafChallenge());
      await expect(fetchOrThrow('https://hgl.harvard.edu/data/public/x.geojson')).rejects.toMatchObject({ name: 'ChallengeError', host: 'hgl.harvard.edu' });
    });

    it('calls a Cloudflare challenge a challenge rather than an HTTP 403', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }));
      await expect(fetchOrThrow('http://example.com/x.json')).rejects.toBeInstanceOf(ChallengeError);
    });
  });

  describe('assertData', () => {
    it('lets data through', () => {
      expect(() => assertData(new Response('{}', { headers: { 'content-type': 'application/json' } }), 'http://example.com/x')).not.toThrow();
    });

    it('takes a successful HTML response for a login page', () => {
      expect(() => assertData(new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html;charset=utf-8' } }), 'http://example.com/x')).toThrow(SignInError);
    });

    it("refuses an AWS WAF challenge, an empty 202 that would otherwise pass for ok, and says it's no login page", () => {
      expect(() => assertData(wafChallenge(), 'https://hgl.harvard.edu/data/public/x.tif')).toThrow(ChallengeError);
    });

    it('calls a Cloudflare challenge a challenge, whatever its status', () => {
      expect(() => assertData(new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }), 'http://example.com/x')).toThrow(ChallengeError);
    });

    it('leaves an HTML error page to the status check', () => {
      expect(() => assertData(new Response('<html>', { status: 404, headers: { 'content-type': 'text/html' } }), 'http://example.com/x')).not.toThrow();
    });
  });

  describe('recordError', () => {
    it('always returns a PreviewError (and therefore an Error), carrying a usable message', () => {
      const error = recordError(new Error('boom'), 'http://example.com/r');
      expect(error).toBeInstanceOf(PreviewError);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBeTruthy();
    });

    it('classifies an HttpError as an HTTP load error and includes the status', () => {
      const error = recordError(new HttpError('http://example.com/r', 403, 'Forbidden'), 'http://example.com/r');
      expect(error.title).toBe("This record couldn't be loaded");
      expect(error.message).toContain('403');
      expect(error.url).toBe('http://example.com/r');
    });

    it('classifies a SyntaxError as a parse error', () => {
      const error = recordError(new SyntaxError('Unexpected token < in JSON'), 'http://example.com/r');
      expect(error.title).toBe("This record couldn't be parsed");
      expect(error.message).toMatch(/JSON/);
    });

    it('classifies a fetch TypeError as a network/CORS error', () => {
      const error = recordError(new TypeError('Failed to fetch'), 'http://example.com/r');
      expect(error.title).toBe("This record couldn't be reached");
      expect(error.message).toMatch(/CORS/);
    });

    it('falls back to a read error for other failures (e.g. an unsupported metadata version)', () => {
      const error = recordError(new Error('Unsupported metadata version: GeoBlacklight'), 'http://example.com/r');
      expect(error.title).toBe("This record couldn't be read");
      expect(error.message).toContain('Unsupported metadata version');
    });

    it('says a bot check blocked the record, and which server sent it', () => {
      const url = 'https://hgl.harvard.edu/catalog/harvard-tg00miplc00/raw';
      const error = recordError(new ChallengeError(url), url);
      expect(error.title).toBe('This record was blocked');
      expect(error.message).toContain('bot check');
      expect(error.message).toContain('hgl.harvard.edu');
      expect(error.url).toBe(url);
    });
  });

  describe('referenceError', () => {
    it('names the source in the title and keeps the url', () => {
      const error = referenceError(new TypeError('Failed to fetch'), 'GeoJSON', 'http://example.com/data.json');
      expect(error).toBeInstanceOf(PreviewError);
      expect(error.title).toContain('GeoJSON');
      expect(error.url).toBe('http://example.com/data.json');
    });

    it('classifies an HttpError as an HTTP load error', () => {
      const error = referenceError(new HttpError('http://example.com/wms', 502, 'Bad Gateway'), 'WMS');
      expect(error.title).toBe("The WMS preview couldn't be loaded");
      expect(error.message).toContain('502');
    });

    it('reads a numeric status off a library error object (e.g. MapLibre AjaxError)', () => {
      const error = referenceError({ status: 404, message: 'not found' }, 'XYZ tiles');
      expect(error.title).toBe("The XYZ tiles preview couldn't be loaded");
      expect(error.message).toContain('404');
    });

    it('classifies a fetch TypeError as a network/CORS error', () => {
      const error = referenceError(new TypeError('Failed to fetch'), 'IIIF Image');
      expect(error.title).toBe("The IIIF Image preview couldn't be reached");
      expect(error.message).toMatch(/CORS/);
    });

    it('falls back to a read error for a non-HTTP, non-network failure', () => {
      const error = referenceError(new Error('open-failed'), 'IIIF Image');
      expect(error.title).toBe("The IIIF Image preview couldn't be read");
      expect(error.message).toContain('open-failed');
    });

    it('treats a status-0 error (MapLibre CORS/network block) as a network error, not "HTTP 0"', () => {
      const error = referenceError({ status: 0, message: 'Failed to fetch' }, 'Web Map Service (WMS)');
      expect(error.title).toBe("The Web Map Service (WMS) preview couldn't be reached");
      expect(error.message).toMatch(/CORS/);
      expect(error.message).not.toContain('HTTP 0');
    });

    it('classifies a TimeoutError as a timeout, not as a read error', () => {
      const error = referenceError(new TimeoutError('a tile of http://example.com/wms', 20_000), 'Web Map Service (WMS)', 'http://example.com/wms');
      expect(error.title).toBe('The Web Map Service (WMS) preview timed out');
      expect(error.url).toBe('http://example.com/wms');
    });

    it('describes what a timeout means rather than repeating the internal message', () => {
      const error = referenceError(new TimeoutError('a tile of http://example.com/wms', 20_000), 'WMS');
      expect(error.message).not.toContain('20000');
      expect(error.message).not.toMatch(/tile/i);
      expect(error.message).toMatch(/in time/);
    });

    it('says a bot check blocked the preview, and which server sent it', () => {
      const url = 'https://hgl.harvard.edu/data/public/TG00MIPLC00.pmtiles';
      const error = referenceError(new ChallengeError(url), 'PMTiles', url);
      expect(error.title).toBe('The PMTiles preview was blocked');
      expect(error.message).toContain('bot check');
      expect(error.message).toContain('hgl.harvard.edu');
      expect(error.url).toBe(url);
    });

    it('finds a challenge that a data source wrapped in its own error', () => {
      const wrapped = new Error('Failed to fetch x.tif', { cause: new ChallengeError('https://hgl.harvard.edu/data/public/x.tif') });
      expect(referenceError(wrapped, 'Cloud Optimized GeoTIFF').title).toBe('The Cloud Optimized GeoTIFF preview was blocked');
    });
  });
});
