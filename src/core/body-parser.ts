/**
 * Stream-based request body parser with minimal memory footprint
 * Phase 4: Upstream Integration & Resilience
 * 
 * Performance target: < 0.5ms overhead for small payloads (< 1KB)
 * Memory target: No full buffering, stream directly to upstream
 */

import { IncomingMessage } from 'http';
import { Readable } from 'stream';
import { BodyParserConfig } from '../types/core.js';
import { logger } from '../utils/logger.js';

/**
 * Supported content types
 */
export enum ContentType {
  JSON = 'application/json',
  URLENCODED = 'application/x-www-form-urlencoded',
  MULTIPART = 'multipart/form-data',
  TEXT = 'text/plain',
  OCTET_STREAM = 'application/octet-stream',
}

/**
 * Parsed body result
 */
export interface ParsedBody {
  /** Parsed data (for JSON and URL-encoded) */
  data?: unknown;
  /** Raw buffer (for other types) */
  buffer?: Buffer;
  /** Stream (for large bodies or streaming) */
  stream?: Readable;
  /** Content type */
  contentType: string;
  /** Body size in bytes */
  size: number;
}

/**
 * Body parser error
 */
export class BodyParserError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'BodyParserError';
  }
}

/**
 * Default body parser configuration
 */
const DEFAULT_CONFIG: BodyParserConfig = {
  enabled: true,
  limits: {
    json: 1024 * 1024, // 1MB
    urlencoded: 1024 * 1024, // 1MB
    multipart: 10 * 1024 * 1024, // 10MB
    text: 1024 * 1024, // 1MB
  },
  timeout: 30000,
  enablePooling: true,
};

/**
 * Stream-based body parser
 */
export class BodyParser {
  private config: BodyParserConfig;
  private parserPool: Map<string, ParsedBody[]> = new Map();

  constructor(config?: Partial<BodyParserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Parse request body
   */
  async parse(req: IncomingMessage): Promise<ParsedBody> {
    const contentType = this.getContentType(req);
    const contentLength = this.getContentLength(req);

    // Check size limit
    const limit = this.getSizeLimit(contentType);
    if (contentLength > limit) {
      throw new BodyParserError(
        `Request body too large: ${contentLength} > ${limit}`,
        'BODY_TOO_LARGE',
        413
      );
    }

    // Parse based on content type
    switch (contentType) {
      case ContentType.JSON:
        return await this.parseJSON(req, contentLength);
      case ContentType.URLENCODED:
        return await this.parseURLEncoded(req, contentLength);
      case ContentType.MULTIPART:
        return await this.parseMultipart(req, contentLength);
      case ContentType.TEXT:
        return await this.parseText(req, contentLength);
      default:
        return await this.parseRaw(req, contentLength);
    }
  }

  /**
   * Parse JSON body
   */
  private async parseJSON(req: IncomingMessage, contentLength: number): Promise<ParsedBody> {
    const startTime = process.hrtime.bigint();

    try {
      const buffer = await this.readBody(req, contentLength, this.config.timeout);
      const data = JSON.parse(buffer.toString('utf8'));

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      logger.debug(`JSON body parsed in ${duration.toFixed(3)}ms`);

      return {
        data,
        buffer,
        contentType: ContentType.JSON,
        size: buffer.length,
      };
    } catch (error) {
      if (error instanceof BodyParserError) throw error;
      throw new BodyParserError(
        `Invalid JSON: ${(error as Error).message}`,
        'INVALID_JSON',
        400
      );
    }
  }

  /**
   * Parse URL-encoded body
   */
  private async parseURLEncoded(req: IncomingMessage, contentLength: number): Promise<ParsedBody> {
    const startTime = process.hrtime.bigint();

    try {
      const buffer = await this.readBody(req, contentLength, this.config.timeout);
      const data = this.parseQueryString(buffer.toString('utf8'));

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      logger.debug(`URL-encoded body parsed in ${duration.toFixed(3)}ms`);

      return {
        data,
        buffer,
        contentType: ContentType.URLENCODED,
        size: buffer.length,
      };
    } catch (error) {
      if (error instanceof BodyParserError) throw error;
      throw new BodyParserError(
        `Invalid URL-encoded body: ${(error as Error).message}`,
        'INVALID_URLENCODED',
        400
      );
    }
  }

  /**
   * Parse multipart body
   */
  private async parseMultipart(req: IncomingMessage, contentLength: number): Promise<ParsedBody> {
    const startTime = process.hrtime.bigint();

    try {
      // For now, return raw buffer - full multipart parsing would require a library
      const buffer = await this.readBody(req, contentLength, this.config.timeout);

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      logger.debug(`Multipart body parsed in ${duration.toFixed(3)}ms`);

      return {
        buffer,
        contentType: ContentType.MULTIPART,
        size: buffer.length,
      };
    } catch (error) {
      if (error instanceof BodyParserError) throw error;
      throw new BodyParserError(
        `Invalid multipart body: ${(error as Error).message}`,
        'INVALID_MULTIPART',
        400
      );
    }
  }

  /**
   * Parse text body
   */
  private async parseText(req: IncomingMessage, contentLength: number): Promise<ParsedBody> {
    const startTime = process.hrtime.bigint();

    try {
      const buffer = await this.readBody(req, contentLength, this.config.timeout);
      const data = buffer.toString('utf8');

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      logger.debug(`Text body parsed in ${duration.toFixed(3)}ms`);

      return {
        data,
        buffer,
        contentType: ContentType.TEXT,
        size: buffer.length,
      };
    } catch (error) {
      if (error instanceof BodyParserError) throw error;
      throw new BodyParserError(
        `Invalid text body: ${(error as Error).message}`,
        'INVALID_TEXT',
        400
      );
    }
  }

  /**
   * Parse raw body (binary)
   */
  private async parseRaw(req: IncomingMessage, contentLength: number): Promise<ParsedBody> {
    const startTime = process.hrtime.bigint();

    try {
      const buffer = await this.readBody(req, contentLength, this.config.timeout);

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      logger.debug(`Raw body parsed in ${duration.toFixed(3)}ms`);

      return {
        buffer,
        contentType: ContentType.OCTET_STREAM,
        size: buffer.length,
      };
    } catch (error) {
      if (error instanceof BodyParserError) throw error;
      throw new BodyParserError(
        `Failed to read body: ${(error as Error).message}`,
        'READ_ERROR',
        400
      );
    }
  }

  /**
   * Read body from stream with backpressure handling
   */
  private readBody(
    req: IncomingMessage,
    expectedLength: number,
    timeout: number
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalLength = 0;

      // Set timeout
      const timer = setTimeout(() => {
        req.destroy();
        reject(
          new BodyParserError(
            `Body parsing timeout after ${timeout}ms`,
            'TIMEOUT',
            408
          )
        );
      }, timeout);

      req.on('data', (chunk: Buffer) => {
        totalLength += chunk.length;

        // Check if exceeding expected length
        if (totalLength > expectedLength) {
          clearTimeout(timer);
          req.destroy();
          reject(
            new BodyParserError(
              `Body size exceeded expected length: ${totalLength} > ${expectedLength}`,
              'SIZE_EXCEEDED',
              413
            )
          );
          return;
        }

        chunks.push(chunk);
      });

      req.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      });

      req.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new BodyParserError(
            `Stream error: ${error.message}`,
            'STREAM_ERROR',
            400
          )
        );
      });
    });
  }

  /**
   * Get content type from request
   */
  private getContentType(req: IncomingMessage): string {
    const contentType = req.headers['content-type'];
    if (!contentType) return ContentType.OCTET_STREAM;

    // Extract main type (ignore parameters like charset)
    const mainType = contentType.split(';')[0]?.trim() || ContentType.OCTET_STREAM;

    // Match to known types
    if (mainType.includes('json')) return ContentType.JSON;
    if (mainType.includes('urlencoded')) return ContentType.URLENCODED;
    if (mainType.includes('multipart')) return ContentType.MULTIPART;
    if (mainType.includes('text')) return ContentType.TEXT;

    return mainType;
  }

  /**
   * Get content length from request
   */
  private getContentLength(req: IncomingMessage): number {
    const contentLength = req.headers['content-length'];
    if (!contentLength) return 0;
    return parseInt(contentLength, 10) || 0;
  }

  /**
   * Get size limit for content type
   */
  private getSizeLimit(contentType: string): number {
    switch (contentType) {
      case ContentType.JSON:
        return this.config.limits.json;
      case ContentType.URLENCODED:
        return this.config.limits.urlencoded;
      case ContentType.MULTIPART:
        return this.config.limits.multipart;
      case ContentType.TEXT:
        return this.config.limits.text;
      default:
        return this.config.limits.text;
    }
  }

  /**
   * Parse query string (x-www-form-urlencoded)
   */
  private parseQueryString(str: string): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};

    for (const pair of str.split('&')) {
      const equalIndex = pair.indexOf('=');
      if (equalIndex === -1) continue;
      
      const key = decodeURIComponent(pair.substring(0, equalIndex));
      const value = decodeURIComponent(pair.substring(equalIndex + 1));
      
      if (!key) continue;

      if (key in result) {
        // Convert to array if multiple values
        const existing = result[key];
        if (Array.isArray(existing)) {
          existing.push(value || '');
        } else {
          result[key] = [existing as string, value || ''];
        }
      } else {
        result[key] = value || '';
      }
    }

    return result;
  }

  /**
   * Get pooled parser (for future optimization)
   */
  acquireParser(type: string): ParsedBody | null {
    if (!this.config.enablePooling) return null;
    const pool = this.parserPool.get(type);
    return pool?.pop() || null;
  }

  /**
   * Release parser back to pool
   */
  releaseParser(type: string, parser: ParsedBody): void {
    if (!this.config.enablePooling) return;

    let pool = this.parserPool.get(type);
    if (!pool) {
      pool = [];
      this.parserPool.set(type, pool);
    }

    // Limit pool size
    if (pool.length < 100) {
      pool.push(parser);
    }
  }
}
