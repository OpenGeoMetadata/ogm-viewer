import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { HttpError, PreviewError, fetchOrThrow, recordError, referenceError } from './errors';

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
  });

  describe('recordError', () => {
    it('always returns a PreviewError (and therefore an Error), carrying a usable message', () => {
      const error = recordError(new Error('boom'), 'http://example.com/r');
      expect(error).toBeInstanceOf(PreviewError);
      expect(error).toBeInstanceOf(Error);
      // Guards the class-field pitfall where redeclaring `message` blanks the value super() sets.
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
  });
});
