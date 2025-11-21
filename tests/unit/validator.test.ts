import { describe, it, expect } from 'vitest';
import { configValidator } from '../../src/config/validator';

describe('ConfigValidator', () => {
  it('should validate correct configuration', () => {
    const config = {
      version: '1.0.0',
      environment: 'development',
      server: {
        port: 3000,
        host: '0.0.0.0',
        keepAlive: true,
        keepAliveTimeout: 65000,
        requestTimeout: 30000,
        maxHeaderSize: 16384,
        maxBodySize: 10485760
      },
      routes: [],
      upstreams: [],
      plugins: [],
      performance: {
        workerCount: 0,
        contextPoolSize: 1000,
        bufferPoolSize: 1000,
        responsePoolSize: 1000,
        enablePooling: true
      }
    };

    const result = configValidator.validate(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid port number', () => {
    const config = {
      version: '1.0.0',
      environment: 'development',
      server: {
        port: 99999, // Invalid
        host: '0.0.0.0'
      }
    };

    const result = configValidator.validate(config);
    expect(result.valid).toBe(false);
  });

  it('should reject invalid environment', () => {
    const config = {
      version: '1.0.0',
      environment: 'invalid',
      server: {
        port: 3000,
        host: '0.0.0.0'
      }
    };

    const result = configValidator.validate(config);
    expect(result.valid).toBe(false);
  });

  it('should apply default values', () => {
    const config = {
      version: '1.0.0',
      environment: 'production',
      server: {
        port: 3000,
        host: '0.0.0.0'
      }
    };

    const isValid = configValidator.isValid(config);
    expect(isValid).toBe(true);
  });
});
