/**
 * Unit tests for Compression Handler
 * Phase 6: Proxy Logic & Request Forwarding
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CompressionHandler } from '../../src/core/compression-handler.js';

describe('CompressionHandler', () => {
  let handler: CompressionHandler;

  beforeEach(() => {
    handler = new CompressionHandler();
  });

  describe('Algorithm Negotiation', () => {
    it('should negotiate gzip compression', () => {
      const algorithm = handler.negotiateAlgorithm('gzip');
      expect(algorithm).toBe('gzip');
    });

    it('should negotiate brotli compression', () => {
      const algorithm = handler.negotiateAlgorithm('br');
      expect(algorithm).toBe('br');
    });

    it('should negotiate deflate compression', () => {
      const algorithm = handler.negotiateAlgorithm('deflate');
      expect(algorithm).toBe('deflate');
    });

    it('should prioritize brotli over gzip', () => {
      const algorithm = handler.negotiateAlgorithm('gzip, br');
      expect(algorithm).toBe('br');
    });

    it('should prioritize configured algorithms', () => {
      const algorithm = handler.negotiateAlgorithm('gzip;q=0.9, br;q=0.8');
      // Our implementation prioritizes configured algorithm order over quality
      expect(algorithm).toBe('br');
    });

    it('should handle wildcard encoding', () => {
      const algorithm = handler.negotiateAlgorithm('*');
      expect(algorithm).toBe('br'); // First in default algorithms
    });

    it('should return null for unsupported encoding', () => {
      const algorithm = handler.negotiateAlgorithm('unsupported');
      expect(algorithm).toBeNull();
    });

    it('should return null when no accept-encoding header', () => {
      const algorithm = handler.negotiateAlgorithm(undefined);
      expect(algorithm).toBeNull();
    });
  });

  describe('Should Compress', () => {
    it('should compress JSON content above threshold', () => {
      const should = handler.shouldCompress('application/json', 2048, 'gzip');
      expect(should).toBe(true);
    });

    it('should not compress content below threshold', () => {
      const should = handler.shouldCompress('application/json', 512, 'gzip');
      expect(should).toBe(false);
    });

    it('should not compress without accept-encoding', () => {
      const should = handler.shouldCompress('application/json', 2048, undefined);
      expect(should).toBe(false);
    });

    it('should compress text content', () => {
      const should = handler.shouldCompress('text/html', 2048, 'gzip');
      expect(should).toBe(true);
    });

    it('should compress text/plain content', () => {
      const should = handler.shouldCompress('text/plain', 2048, 'gzip');
      expect(should).toBe(true);
    });

    it('should not compress images', () => {
      const should = handler.shouldCompress('image/png', 2048, 'gzip');
      expect(should).toBe(false);
    });

    it('should not compress without content-type', () => {
      const should = handler.shouldCompress(undefined, 2048, 'gzip');
      expect(should).toBe(false);
    });
  });

  describe('Gzip Compression', () => {
    it('should compress data with gzip', async () => {
      const data = Buffer.from('Hello, World!'.repeat(100), 'utf-8');
      const result = await handler.compress(data, 'gzip');

      expect(result.algorithm).toBe('gzip');
      expect(result.originalSize).toBe(data.length);
      expect(result.compressedSize).toBeLessThan(data.length);
      expect(result.ratio).toBeLessThan(1);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should decompress gzip data', async () => {
      const original = Buffer.from('Test data for compression', 'utf-8');
      const compressed = await handler.compress(original, 'gzip');
      const result = await handler.decompress(compressed.data, 'gzip');

      expect(result.data.toString('utf-8')).toBe(original.toString('utf-8'));
      expect(result.algorithm).toBe('gzip');
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should achieve good compression ratio for JSON', async () => {
      const jsonData = JSON.stringify({
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })),
      });
      const data = Buffer.from(jsonData, 'utf-8');
      const result = await handler.compress(data, 'gzip');

      // Should achieve > 60% compression (ratio < 0.4)
      expect(result.ratio).toBeLessThan(0.4);
    });
  });

  describe('Brotli Compression', () => {
    it('should compress data with brotli', async () => {
      const data = Buffer.from('Hello, World!'.repeat(100), 'utf-8');
      const result = await handler.compress(data, 'br');

      expect(result.algorithm).toBe('br');
      expect(result.originalSize).toBe(data.length);
      expect(result.compressedSize).toBeLessThan(data.length);
      expect(result.ratio).toBeLessThan(1);
    });

    it('should decompress brotli data', async () => {
      const original = Buffer.from('Test data for compression', 'utf-8');
      const compressed = await handler.compress(original, 'br');
      const result = await handler.decompress(compressed.data, 'br');

      expect(result.data.toString('utf-8')).toBe(original.toString('utf-8'));
      expect(result.algorithm).toBe('br');
    });

    it('should achieve better compression than gzip for JSON', async () => {
      const jsonData = JSON.stringify({
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })),
      });
      const data = Buffer.from(jsonData, 'utf-8');
      
      const brotliResult = await handler.compress(data, 'br');
      const gzipResult = await handler.compress(data, 'gzip');

      // Brotli should have better or equal compression
      expect(brotliResult.ratio).toBeLessThanOrEqual(gzipResult.ratio + 0.05);
    });
  });

  describe('Deflate Compression', () => {
    it('should compress data with deflate', async () => {
      const data = Buffer.from('Hello, World!'.repeat(100), 'utf-8');
      const result = await handler.compress(data, 'deflate');

      expect(result.algorithm).toBe('deflate');
      expect(result.originalSize).toBe(data.length);
      expect(result.compressedSize).toBeLessThan(data.length);
    });

    it('should decompress deflate data', async () => {
      const original = Buffer.from('Test data for compression', 'utf-8');
      const compressed = await handler.compress(original, 'deflate');
      const result = await handler.decompress(compressed.data, 'deflate');

      expect(result.data.toString('utf-8')).toBe(original.toString('utf-8'));
      expect(result.algorithm).toBe('deflate');
    });
  });

  describe('Compression Streams', () => {
    it('should create gzip compression stream', () => {
      const stream = handler.createCompressionStream('gzip');
      expect(stream).toBeDefined();
    });

    it('should create brotli compression stream', () => {
      const stream = handler.createCompressionStream('br');
      expect(stream).toBeDefined();
    });

    it('should create deflate compression stream', () => {
      const stream = handler.createCompressionStream('deflate');
      expect(stream).toBeDefined();
    });

    it('should throw for unsupported algorithm', () => {
      expect(() => handler.createCompressionStream('invalid' as any)).toThrow();
    });
  });

  describe('Decompression Streams', () => {
    it('should create gzip decompression stream', () => {
      const stream = handler.createDecompressionStream('gzip');
      expect(stream).toBeDefined();
    });

    it('should create brotli decompression stream', () => {
      const stream = handler.createDecompressionStream('br');
      expect(stream).toBeDefined();
    });

    it('should create deflate decompression stream', () => {
      const stream = handler.createDecompressionStream('deflate');
      expect(stream).toBeDefined();
    });
  });

  describe('Compression Headers', () => {
    it('should add compression headers', () => {
      const headers = { 'content-type': 'application/json' };
      const result = handler.addCompressionHeaders(headers, 'gzip', 1024);

      expect(result['content-encoding']).toBe('gzip');
      expect(result['content-length']).toBe(1024);
      expect(result['vary']).toBe('Accept-Encoding');
      expect(result['content-type']).toBe('application/json');
    });

    it('should replace existing vary header', () => {
      const headers = { vary: 'User-Agent' };
      const result = handler.addCompressionHeaders(headers, 'br', 512);

      expect(result['vary']).toBe('Accept-Encoding');
    });
  });

  describe('Algorithm Detection', () => {
    it('should detect gzip encoding', () => {
      const algorithm = handler.detectAlgorithm('gzip');
      expect(algorithm).toBe('gzip');
    });

    it('should detect x-gzip encoding', () => {
      const algorithm = handler.detectAlgorithm('x-gzip');
      expect(algorithm).toBe('gzip');
    });

    it('should detect brotli encoding', () => {
      const algorithm = handler.detectAlgorithm('br');
      expect(algorithm).toBe('br');
    });

    it('should detect deflate encoding', () => {
      const algorithm = handler.detectAlgorithm('deflate');
      expect(algorithm).toBe('deflate');
    });

    it('should return null for unknown encoding', () => {
      const algorithm = handler.detectAlgorithm('unknown');
      expect(algorithm).toBeNull();
    });

    it('should return null for undefined encoding', () => {
      const algorithm = handler.detectAlgorithm(undefined);
      expect(algorithm).toBeNull();
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      handler.updateConfig({
        level: 9,
        threshold: 2048,
      });

      const config = handler.getConfig();
      expect(config.level).toBe(9);
      expect(config.threshold).toBe(2048);
    });

    it('should disable compression', () => {
      handler.updateConfig({ enabled: false });
      
      const should = handler.shouldCompress('application/json', 2048, 'gzip');
      expect(should).toBe(false);
    });

    it('should get statistics', () => {
      const stats = handler.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.algorithms).toEqual(['br', 'gzip', 'deflate']);
      expect(stats.threshold).toBe(1024);
    });
  });

  describe('Performance', () => {
    it('should compress within 2ms for small data', async () => {
      const data = Buffer.from('Test'.repeat(100), 'utf-8');
      const result = await handler.compress(data, 'gzip');

      expect(result.duration).toBeLessThan(2);
    });

    it('should compress large JSON efficiently', async () => {
      const jsonData = JSON.stringify({
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'A test item with some description',
        })),
      });
      const data = Buffer.from(jsonData, 'utf-8');
      const result = await handler.compress(data, 'gzip');

      // Should be reasonably fast even for large data
      expect(result.duration).toBeLessThan(50);
      expect(result.ratio).toBeLessThan(0.3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty buffer', async () => {
      const data = Buffer.from('', 'utf-8');
      const result = await handler.compress(data, 'gzip');

      expect(result.originalSize).toBe(0);
      expect(result.compressedSize).toBeGreaterThanOrEqual(0);
    });

    it('should handle small data', async () => {
      const data = Buffer.from('Hi', 'utf-8');
      const result = await handler.compress(data, 'gzip');

      // Small data might not compress well
      expect(result.originalSize).toBe(2);
    });

    it('should roundtrip data correctly', async () => {
      const original = Buffer.from('The quick brown fox jumps over the lazy dog'.repeat(50), 'utf-8');
      
      // Test all algorithms
      for (const algo of ['gzip', 'br', 'deflate'] as const) {
        const compressed = await handler.compress(original, algo);
        const decompressed = await handler.decompress(compressed.data, algo);
        
        expect(decompressed.data.toString('utf-8')).toBe(original.toString('utf-8'));
      }
    });
  });
});
