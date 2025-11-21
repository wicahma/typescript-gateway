/**
 * Compression Handler - Handle compression and decompression
 * Phase 6: Proxy Logic & Request Forwarding
 * 
 * Features:
 * - Gzip, Brotli, Deflate support
 * - Compress responses to clients
 * - Decompress upstream responses
 * - Content negotiation (Accept-Encoding)
 * - Selective compression by content-type and size
 * - Streaming compression
 */

import { createGzip, createGunzip, createDeflate, createInflate, createBrotliCompress, createBrotliDecompress } from 'zlib';
import { Readable, Transform } from 'stream';
import { OutgoingHttpHeaders } from 'http';
import { logger } from '../utils/logger.js';

/**
 * Supported compression algorithms
 */
export type CompressionAlgorithm = 'gzip' | 'br' | 'deflate';

/**
 * Compression configuration
 */
export interface CompressionConfig {
  /** Enable compression */
  enabled: boolean;
  /** Supported algorithms in priority order */
  algorithms: CompressionAlgorithm[];
  /** Compression level (0-9 for gzip/deflate, 0-11 for brotli) */
  level: number;
  /** Minimum size in bytes to compress */
  threshold: number;
  /** Content types to compress (supports wildcards) */
  contentTypes: string[];
}

/**
 * Compression result
 */
export interface CompressionResult {
  /** Compressed data */
  data: Buffer;
  /** Compression algorithm used */
  algorithm: CompressionAlgorithm;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio (compressed / original) */
  ratio: number;
  /** Compression duration in ms */
  duration: number;
}

/**
 * Decompression result
 */
export interface DecompressionResult {
  /** Decompressed data */
  data: Buffer;
  /** Algorithm that was used */
  algorithm: CompressionAlgorithm;
  /** Decompression duration in ms */
  duration: number;
}

/**
 * Default compression configuration
 */
const DEFAULT_CONFIG: CompressionConfig = {
  enabled: true,
  algorithms: ['br', 'gzip', 'deflate'],
  level: 6,
  threshold: 1024, // 1KB
  contentTypes: ['application/json', 'text/*', 'application/javascript', 'application/xml'],
};

/**
 * Compression Handler
 */
export class CompressionHandler {
  private config: CompressionConfig;

  constructor(config?: Partial<CompressionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Negotiate compression algorithm based on Accept-Encoding header
   */
  negotiateAlgorithm(acceptEncoding?: string): CompressionAlgorithm | null {
    if (!this.config.enabled || !acceptEncoding) {
      return null;
    }

    // Parse Accept-Encoding header
    const encodings = acceptEncoding
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .map((e) => {
        const [encoding, q] = e.split(';q=');
        return {
          encoding: encoding?.trim() || '',
          quality: q ? parseFloat(q) : 1.0,
        };
      })
      .filter((e) => e.quality > 0)
      .sort((a, b) => b.quality - a.quality);

    // Find best match from configured algorithms
    for (const configured of this.config.algorithms) {
      for (const accepted of encodings) {
        if (accepted.encoding === configured || accepted.encoding === '*') {
          return configured;
        }
      }
    }

    return null;
  }

  /**
   * Check if content should be compressed
   */
  shouldCompress(
    contentType: string | undefined,
    contentLength: number,
    acceptEncoding?: string
  ): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Check if client accepts compression
    if (!acceptEncoding) {
      return false;
    }

    // Check size threshold
    if (contentLength < this.config.threshold) {
      return false;
    }

    // Check content type
    if (!contentType) {
      return false;
    }

    return this.matchesContentType(contentType);
  }

  /**
   * Compress data
   */
  async compress(
    data: Buffer,
    algorithm: CompressionAlgorithm
  ): Promise<CompressionResult> {
    const startTime = process.hrtime.bigint();
    const originalSize = data.length;

    try {
      const compressed = await this.compressBuffer(data, algorithm);
      const compressedSize = compressed.length;
      const ratio = compressedSize / originalSize;
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      return {
        data: compressed,
        algorithm,
        originalSize,
        compressedSize,
        ratio,
        duration,
      };
    } catch (error) {
      logger.error(`Compression failed: ${error}`);
      throw error;
    }
  }

  /**
   * Decompress data
   */
  async decompress(
    data: Buffer,
    algorithm: CompressionAlgorithm
  ): Promise<DecompressionResult> {
    const startTime = process.hrtime.bigint();

    try {
      const decompressed = await this.decompressBuffer(data, algorithm);
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      return {
        data: decompressed,
        algorithm,
        duration,
      };
    } catch (error) {
      logger.error(`Decompression failed: ${error}`);
      throw error;
    }
  }

  /**
   * Create compression stream
   */
  createCompressionStream(algorithm: CompressionAlgorithm): Transform {
    switch (algorithm) {
      case 'gzip':
        return createGzip({ level: this.config.level });
      case 'br':
        return createBrotliCompress({
          params: {
            [/* BROTLI_PARAM_QUALITY */ 0]: this.config.level,
          },
        });
      case 'deflate':
        return createDeflate({ level: this.config.level });
      default:
        throw new Error(`Unsupported compression algorithm: ${algorithm}`);
    }
  }

  /**
   * Create decompression stream
   */
  createDecompressionStream(algorithm: CompressionAlgorithm): Transform {
    switch (algorithm) {
      case 'gzip':
        return createGunzip();
      case 'br':
        return createBrotliDecompress();
      case 'deflate':
        return createInflate();
      default:
        throw new Error(`Unsupported decompression algorithm: ${algorithm}`);
    }
  }

  /**
   * Add compression headers to response
   */
  addCompressionHeaders(
    headers: OutgoingHttpHeaders,
    algorithm: CompressionAlgorithm,
    compressedSize: number
  ): OutgoingHttpHeaders {
    const result = { ...headers };
    
    result['content-encoding'] = algorithm;
    result['content-length'] = compressedSize;
    
    // Remove any existing vary header and add our own
    delete result['vary'];
    result['vary'] = 'Accept-Encoding';

    return result;
  }

  /**
   * Detect compression algorithm from Content-Encoding header
   */
  detectAlgorithm(contentEncoding?: string): CompressionAlgorithm | null {
    if (!contentEncoding) {
      return null;
    }

    const encoding = contentEncoding.toLowerCase().trim();
    
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      return 'gzip';
    } else if (encoding === 'br') {
      return 'br';
    } else if (encoding === 'deflate') {
      return 'deflate';
    }

    return null;
  }

  /**
   * Compress buffer using specified algorithm
   */
  private compressBuffer(data: Buffer, algorithm: CompressionAlgorithm): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const compressor = this.createCompressionStream(algorithm);

      compressor.on('data', (chunk: Buffer) => chunks.push(chunk));
      compressor.on('end', () => resolve(Buffer.concat(chunks)));
      compressor.on('error', reject);

      // Create a readable stream from buffer
      const readable = Readable.from([data]);
      readable.pipe(compressor);
    });
  }

  /**
   * Decompress buffer using specified algorithm
   */
  private decompressBuffer(data: Buffer, algorithm: CompressionAlgorithm): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const decompressor = this.createDecompressionStream(algorithm);

      decompressor.on('data', (chunk: Buffer) => chunks.push(chunk));
      decompressor.on('end', () => resolve(Buffer.concat(chunks)));
      decompressor.on('error', reject);

      // Create a readable stream from buffer
      const readable = Readable.from([data]);
      readable.pipe(decompressor);
    });
  }

  /**
   * Check if content type matches configured patterns
   */
  private matchesContentType(contentType: string): boolean {
    const normalized = contentType.toLowerCase().split(';')[0]?.trim() || '';

    for (const pattern of this.config.contentTypes) {
      if (pattern.includes('*')) {
        // Wildcard pattern
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
        if (regex.test(normalized)) {
          return true;
        }
      } else {
        // Exact match
        if (normalized === pattern.toLowerCase()) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get configuration
   */
  getConfig(): CompressionConfig {
    return { ...this.config };
  }

  /**
   * Get statistics
   */
  getStats(): {
    enabled: boolean;
    algorithms: CompressionAlgorithm[];
    threshold: number;
  } {
    return {
      enabled: this.config.enabled,
      algorithms: [...this.config.algorithms],
      threshold: this.config.threshold,
    };
  }
}
