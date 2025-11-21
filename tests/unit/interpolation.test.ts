/**
 * Tests for configuration environment variable interpolation
 */

import { describe, it, expect } from 'vitest';
import {
  interpolateString,
  interpolateConfig,
  extractEnvVars,
  validateEnvVars,
  InterpolationError,
} from '../../src/config/interpolation.js';

describe('Configuration Interpolation', () => {
  describe('interpolateString', () => {
    it('should interpolate single environment variable', () => {
      const result = interpolateString('${TEST_VAR}', {
        strict: true,
        env: { TEST_VAR: 'value' },
      });
      expect(result).toBe('value');
    });

    it('should interpolate multiple environment variables', () => {
      const result = interpolateString('${VAR1}-${VAR2}', {
        strict: true,
        env: { VAR1: 'hello', VAR2: 'world' },
      });
      expect(result).toBe('hello-world');
    });

    it('should use default value when variable is not set', () => {
      const result = interpolateString('${MISSING_VAR:default}', {
        strict: true,
        env: {},
      });
      expect(result).toBe('default');
    });

    it('should throw error in strict mode when required variable is missing', () => {
      expect(() => {
        interpolateString('${MISSING_VAR}', {
          strict: true,
          env: {},
        });
      }).toThrow(InterpolationError);
    });

    it('should keep placeholder in non-strict mode when variable is missing', () => {
      const result = interpolateString('${MISSING_VAR}', {
        strict: false,
        env: {},
      });
      expect(result).toBe('${MISSING_VAR}');
    });

    it('should handle strings without variables', () => {
      const result = interpolateString('no variables here', {
        strict: true,
        env: {},
      });
      expect(result).toBe('no variables here');
    });

    it('should handle empty default value', () => {
      const result = interpolateString('${VAR:}', {
        strict: true,
        env: {},
      });
      expect(result).toBe('');
    });

    it('should interpolate in complex strings', () => {
      const result = interpolateString('http://${HOST}:${PORT}/api', {
        strict: true,
        env: { HOST: 'localhost', PORT: '8080' },
      });
      expect(result).toBe('http://localhost:8080/api');
    });
  });

  describe('interpolateConfig', () => {
    it('should interpolate string values in object', () => {
      const config = {
        host: '${HOST}',
        port: 8080,
      };

      const result = interpolateConfig(config, {
        strict: true,
        env: { HOST: 'localhost' },
      });

      expect(result).toEqual({
        host: 'localhost',
        port: 8080,
      });
    });

    it('should recursively interpolate nested objects', () => {
      const config = {
        server: {
          host: '${HOST}',
          port: 8080,
        },
        database: {
          url: '${DB_URL}',
        },
      };

      const result = interpolateConfig(config, {
        strict: true,
        env: {
          HOST: 'localhost',
          DB_URL: 'postgres://localhost/db',
        },
      });

      expect(result.server.host).toBe('localhost');
      expect(result.database.url).toBe('postgres://localhost/db');
    });

    it('should interpolate values in arrays', () => {
      const config = {
        hosts: ['${HOST1}', '${HOST2}', 'static'],
      };

      const result = interpolateConfig(config, {
        strict: true,
        env: {
          HOST1: 'server1',
          HOST2: 'server2',
        },
      });

      expect(result.hosts).toEqual(['server1', 'server2', 'static']);
    });

    it('should handle mixed types correctly', () => {
      const config = {
        string: '${VAR}',
        number: 123,
        boolean: true,
        null: null,
        undefined: undefined,
      };

      const result = interpolateConfig(config, {
        strict: true,
        env: { VAR: 'value' },
      });

      expect(result.string).toBe('value');
      expect(result.number).toBe(123);
      expect(result.boolean).toBe(true);
      expect(result.null).toBe(null);
      expect(result.undefined).toBe(undefined);
    });
  });

  describe('extractEnvVars', () => {
    it('should extract all environment variable references', () => {
      const config = {
        host: '${HOST}',
        port: '${PORT}',
        url: '${HOST}:${PORT}',
      };

      const vars = extractEnvVars(config);

      expect(vars.size).toBe(2);
      expect(vars.has('HOST')).toBe(true);
      expect(vars.has('PORT')).toBe(true);
    });

    it('should extract variables from nested structures', () => {
      const config = {
        server: {
          host: '${SERVER_HOST}',
        },
        database: {
          url: '${DB_URL}',
          credentials: {
            user: '${DB_USER}',
            password: '${DB_PASSWORD}',
          },
        },
      };

      const vars = extractEnvVars(config);

      expect(vars.size).toBe(4);
      expect(vars.has('SERVER_HOST')).toBe(true);
      expect(vars.has('DB_URL')).toBe(true);
      expect(vars.has('DB_USER')).toBe(true);
      expect(vars.has('DB_PASSWORD')).toBe(true);
    });

    it('should extract variables with default values', () => {
      const config = {
        host: '${HOST:localhost}',
      };

      const vars = extractEnvVars(config);

      expect(vars.size).toBe(1);
      expect(vars.has('HOST')).toBe(true);
    });

    it('should handle empty config', () => {
      const vars = extractEnvVars({});
      expect(vars.size).toBe(0);
    });
  });

  describe('validateEnvVars', () => {
    it('should return empty array when all variables are set', () => {
      const config = {
        host: '${HOST}',
        port: '${PORT}',
      };

      const missing = validateEnvVars(config, {
        HOST: 'localhost',
        PORT: '8080',
      });

      expect(missing).toEqual([]);
    });

    it('should return missing required variables', () => {
      const config = {
        host: '${HOST}',
        port: '${PORT}',
      };

      const missing = validateEnvVars(config, {
        HOST: 'localhost',
      });

      expect(missing).toEqual(['PORT']);
    });

    it('should not include variables with defaults as missing', () => {
      const config = {
        host: '${HOST:localhost}',
        port: '${PORT}',
      };

      const missing = validateEnvVars(config, {});

      expect(missing).toEqual(['PORT']);
    });

    it('should remove duplicates from missing list', () => {
      const config = {
        host: '${HOST}',
        url: 'http://${HOST}',
      };

      const missing = validateEnvVars(config, {});

      expect(missing).toEqual(['HOST']);
    });
  });

  describe('Performance', () => {
    it('should handle large configurations efficiently', () => {
      const config: Record<string, unknown> = {};
      
      // Generate config with 1000 fields
      for (let i = 0; i < 1000; i++) {
        config[`field${i}`] = `\${VAR${i}}`;
      }

      const env: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        env[`VAR${i}`] = `value${i}`;
      }

      const startTime = Date.now();
      interpolateConfig(config, { strict: true, env });
      const duration = Date.now() - startTime;

      // Should complete in less than 100ms
      expect(duration).toBeLessThan(100);
    });
  });
});
