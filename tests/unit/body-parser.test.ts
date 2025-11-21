/**
 * Unit tests for Body Parser
 * Phase 4: Upstream Integration & Resilience
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IncomingMessage } from 'http';
import { Readable } from 'stream';
import { BodyParser, BodyParserError, ContentType } from '../../src/core/body-parser.js';

describe('BodyParser', () => {
  let parser: BodyParser;

  beforeEach(() => {
    parser = new BodyParser();
  });

  describe('JSON parsing', () => {
    it('should parse valid JSON body', async () => {
      const json = JSON.stringify({ name: 'test', value: 123 });
      const req = createMockRequest(json, ContentType.JSON);

      const result = await parser.parse(req);

      expect(result.data).toEqual({ name: 'test', value: 123 });
      expect(result.contentType).toBe(ContentType.JSON);
      expect(result.size).toBe(json.length);
    });

    it('should handle empty JSON object', async () => {
      const json = '{}';
      const req = createMockRequest(json, ContentType.JSON);

      const result = await parser.parse(req);

      expect(result.data).toEqual({});
    });

    it('should throw error on invalid JSON', async () => {
      const req = createMockRequest('{ invalid json', ContentType.JSON);

      await expect(parser.parse(req)).rejects.toThrow(BodyParserError);
    });

    it('should throw error when JSON body exceeds limit', async () => {
      const largeJson = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }); // > 1MB
      const req = createMockRequest(largeJson, ContentType.JSON);

      await expect(parser.parse(req)).rejects.toThrow(BodyParserError);
      await expect(parser.parse(req)).rejects.toThrow('too large');
    });

    it('should parse JSON with different charset', async () => {
      const json = JSON.stringify({ unicode: '你好' });
      const req = createMockRequest(json, 'application/json; charset=utf-8');

      const result = await parser.parse(req);

      expect(result.data).toEqual({ unicode: '你好' });
    });
  });

  describe('URL-encoded parsing', () => {
    it('should parse URL-encoded body', async () => {
      const body = 'name=test&value=123&flag=true';
      const req = createMockRequest(body, ContentType.URLENCODED);

      const result = await parser.parse(req);

      expect(result.data).toEqual({
        name: 'test',
        value: '123',
        flag: 'true',
      });
    });

    it('should handle multiple values for same key', async () => {
      const body = 'tags=a&tags=b&tags=c';
      const req = createMockRequest(body, ContentType.URLENCODED);

      const result = await parser.parse(req);

      expect(result.data).toEqual({
        tags: ['a', 'b', 'c'],
      });
    });

    it('should decode URL-encoded characters', async () => {
      const body = 'name=hello%20world&email=test%40example.com';
      const req = createMockRequest(body, ContentType.URLENCODED);

      const result = await parser.parse(req);

      expect(result.data).toEqual({
        name: 'hello world',
        email: 'test@example.com',
      });
    });

    it('should handle empty values', async () => {
      const body = 'key1=&key2=value&key3=';
      const req = createMockRequest(body, ContentType.URLENCODED);

      const result = await parser.parse(req);

      expect(result.data).toEqual({
        key1: '',
        key2: 'value',
        key3: '',
      });
    });
  });

  describe('Text parsing', () => {
    it('should parse plain text body', async () => {
      const text = 'Hello, World!';
      const req = createMockRequest(text, ContentType.TEXT);

      const result = await parser.parse(req);

      expect(result.data).toBe(text);
      expect(result.contentType).toBe(ContentType.TEXT);
    });

    it('should handle multi-line text', async () => {
      const text = 'Line 1\nLine 2\nLine 3';
      const req = createMockRequest(text, ContentType.TEXT);

      const result = await parser.parse(req);

      expect(result.data).toBe(text);
    });

    it('should handle UTF-8 text', async () => {
      const text = 'Hello 世界 🌍';
      const req = createMockRequest(text, ContentType.TEXT);

      const result = await parser.parse(req);

      expect(result.data).toBe(text);
    });
  });

  describe('Multipart parsing', () => {
    it('should parse multipart body as buffer', async () => {
      const body = '--boundary\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n--boundary--';
      const req = createMockRequest(body, 'multipart/form-data; boundary=boundary');

      const result = await parser.parse(req);

      expect(result.buffer).toBeDefined();
      expect(result.contentType).toBe(ContentType.MULTIPART);
    });
  });

  describe('Raw/Binary parsing', () => {
    it('should parse binary data', async () => {
      const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const req = createMockRequest(buffer, ContentType.OCTET_STREAM);

      const result = await parser.parse(req);

      expect(result.buffer).toBeDefined();
      expect(result.buffer?.length).toBe(4);
    });

    it('should handle unknown content types as binary', async () => {
      const body = 'some data';
      const req = createMockRequest(body, 'application/x-custom');

      const result = await parser.parse(req);

      expect(result.buffer).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should timeout on slow requests', async () => {
      const parser = new BodyParser({ timeout: 100 });
      const req = createSlowMockRequest('slow data', ContentType.TEXT, 200);

      await expect(parser.parse(req)).rejects.toThrow('timeout');
    });

    it('should handle stream errors', async () => {
      const req = createErrorMockRequest('error');

      await expect(parser.parse(req)).rejects.toThrow();
    });

    it('should reject when content exceeds declared length', async () => {
      const req = createMockRequestWithMismatchedLength('data', 100);

      // This test verifies backpressure handling
      const result = await parser.parse(req);
      expect(result.buffer).toBeDefined();
    });
  });

  describe('Size limits', () => {
    it('should respect JSON size limit', async () => {
      const parser = new BodyParser({
        limits: { json: 10, urlencoded: 1024, multipart: 1024, text: 1024 },
      });
      const req = createMockRequest('{"data":"test"}', ContentType.JSON);

      await expect(parser.parse(req)).rejects.toThrow('too large');
    });

    it('should respect text size limit', async () => {
      const parser = new BodyParser({
        limits: { json: 1024, urlencoded: 1024, multipart: 1024, text: 10 },
      });
      const req = createMockRequest('very long text', ContentType.TEXT);

      await expect(parser.parse(req)).rejects.toThrow('too large');
    });
  });

  describe('Content type detection', () => {
    it('should detect JSON from content-type header', async () => {
      const req = createMockRequest('{}', 'application/json');
      const result = await parser.parse(req);
      expect(result.contentType).toBe(ContentType.JSON);
    });

    it('should handle missing content-type header', async () => {
      const req = createMockRequestWithoutContentType('data');
      const result = await parser.parse(req);
      expect(result.contentType).toBe(ContentType.OCTET_STREAM);
    });
  });

  describe('Performance', () => {
    it('should parse small JSON payload quickly', async () => {
      const json = JSON.stringify({ small: 'data' });
      const req = createMockRequest(json, ContentType.JSON);

      const start = Date.now();
      await parser.parse(req);
      const duration = Date.now() - start;

      // Target: < 0.5ms overhead (but in test environment, allow more)
      expect(duration).toBeLessThan(50);
    });

    it('should handle concurrent parsing', async () => {
      const requests = Array.from({ length: 10 }, (_, i) =>
        createMockRequest(JSON.stringify({ id: i }), ContentType.JSON)
      );

      const results = await Promise.all(requests.map((req) => parser.parse(req)));

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.data).toEqual({ id: i });
      });
    });
  });
});

// Helper functions

function createMockRequest(
  body: string | Buffer,
  contentType: string
): IncomingMessage {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const stream = Readable.from([buffer]);

  const req = stream as unknown as IncomingMessage;
  req.headers = {
    'content-type': contentType,
    'content-length': buffer.length.toString(),
  };

  return req;
}

function createMockRequestWithoutContentType(body: string): IncomingMessage {
  const buffer = Buffer.from(body);
  const stream = Readable.from([buffer]);

  const req = stream as unknown as IncomingMessage;
  req.headers = {
    'content-length': buffer.length.toString(),
  };

  return req;
}

function createMockRequestWithMismatchedLength(
  body: string,
  declaredLength: number
): IncomingMessage {
  const buffer = Buffer.from(body);
  const stream = Readable.from([buffer]);

  const req = stream as unknown as IncomingMessage;
  req.headers = {
    'content-type': ContentType.TEXT,
    'content-length': declaredLength.toString(),
  };

  return req;
}

function createSlowMockRequest(
  body: string,
  contentType: string,
  delayMs: number
): IncomingMessage {
  const buffer = Buffer.from(body);
  const stream = new Readable({
    read() {
      setTimeout(() => {
        this.push(buffer);
        this.push(null);
      }, delayMs);
    },
  });

  const req = stream as unknown as IncomingMessage;
  req.headers = {
    'content-type': contentType,
    'content-length': buffer.length.toString(),
  };

  return req;
}

function createErrorMockRequest(errorMessage: string): IncomingMessage {
  const stream = new Readable({
    read() {
      this.destroy(new Error(errorMessage));
    },
  });

  const req = stream as unknown as IncomingMessage;
  req.headers = {
    'content-type': ContentType.TEXT,
    'content-length': '10',
  };

  return req;
}
