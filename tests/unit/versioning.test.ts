/**
 * Tests for configuration versioning and migration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseVersion,
  compareVersions,
  isCompatibleVersion,
  ConfigVersionManager,
  VersionComparison,
} from '../../src/config/versioning.js';
import { ConfigFile } from '../../src/types/config.js';

describe('Configuration Versioning', () => {
  describe('parseVersion', () => {
    it('should parse valid semantic version', () => {
      const version = parseVersion('1.2.3');
      expect(version).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
      });
    });

    it('should throw error for invalid version format', () => {
      expect(() => parseVersion('1.2')).toThrow();
      expect(() => parseVersion('invalid')).toThrow();
      expect(() => parseVersion('1.2.3.4')).toThrow();
    });

    it('should handle zero versions', () => {
      const version = parseVersion('0.0.0');
      expect(version).toEqual({
        major: 0,
        minor: 0,
        patch: 0,
      });
    });
  });

  describe('compareVersions', () => {
    it('should return EQUAL for same versions', () => {
      expect(compareVersions('1.2.3', '1.2.3')).toBe(VersionComparison.EQUAL);
    });

    it('should compare major versions correctly', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(VersionComparison.NEWER);
      expect(compareVersions('1.0.0', '2.0.0')).toBe(VersionComparison.OLDER);
    });

    it('should compare minor versions correctly', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBe(VersionComparison.NEWER);
      expect(compareVersions('1.1.0', '1.2.0')).toBe(VersionComparison.OLDER);
    });

    it('should compare patch versions correctly', () => {
      expect(compareVersions('1.0.2', '1.0.1')).toBe(VersionComparison.NEWER);
      expect(compareVersions('1.0.1', '1.0.2')).toBe(VersionComparison.OLDER);
    });

    it('should prioritize major over minor and patch', () => {
      expect(compareVersions('2.0.0', '1.9.9')).toBe(VersionComparison.NEWER);
    });
  });

  describe('isCompatibleVersion', () => {
    it('should accept same major version', () => {
      expect(isCompatibleVersion('1.2.3', '1.5.0')).toBe(true);
    });

    it('should accept one major version behind', () => {
      expect(isCompatibleVersion('1.0.0', '2.0.0')).toBe(true);
    });

    it('should reject two major versions behind', () => {
      expect(isCompatibleVersion('1.0.0', '3.0.0')).toBe(false);
    });

    it('should reject future versions', () => {
      expect(isCompatibleVersion('2.0.0', '1.0.0')).toBe(false);
    });

    it('should handle invalid versions gracefully', () => {
      expect(isCompatibleVersion('invalid', '1.0.0')).toBe(false);
      expect(isCompatibleVersion('1.0.0', 'invalid')).toBe(false);
    });
  });

  describe('ConfigVersionManager', () => {
    let manager: ConfigVersionManager;

    beforeEach(() => {
      manager = new ConfigVersionManager('2.0.0');
    });

    it('should initialize with current version', () => {
      expect(manager.getCurrentVersion()).toBe('2.0.0');
    });

    it('should register migrations', () => {
      const migration = (config: Record<string, unknown>) => config;
      manager.registerMigration('1.0.0', '1.1.0', migration);
      // No error means successful registration
    });

    it('should validate compatible version', () => {
      const config: ConfigFile = {
        version: '2.0.0',
        environment: 'development',
        server: {
          port: 8080,
          host: '0.0.0.0',
          keepAlive: true,
          keepAliveTimeout: 65000,
          requestTimeout: 120000,
          maxHeaderSize: 8192,
          maxBodySize: 1048576,
        },
        routes: [],
        upstreams: [],
        plugins: [],
        performance: {
          workerCount: 0,
          contextPoolSize: 1000,
          bufferPoolSize: 100,
          responsePoolSize: 100,
          enablePooling: true,
        },
      };

      const result = manager.validateVersion(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing version', () => {
      const config = {
        environment: 'development',
      } as unknown as ConfigFile;

      const result = manager.validateVersion(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('version is missing');
    });

    it('should reject incompatible version', () => {
      const config: ConfigFile = {
        version: '0.5.0',
        environment: 'development',
        server: {
          port: 8080,
          host: '0.0.0.0',
          keepAlive: true,
          keepAliveTimeout: 65000,
          requestTimeout: 120000,
          maxHeaderSize: 8192,
          maxBodySize: 1048576,
        },
        routes: [],
        upstreams: [],
        plugins: [],
        performance: {
          workerCount: 0,
          contextPoolSize: 1000,
          bufferPoolSize: 100,
          responsePoolSize: 100,
          enablePooling: true,
        },
      };

      const result = manager.validateVersion(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not compatible');
    });

    it('should migrate configuration to current version', () => {
      const oldConfig: ConfigFile = {
        version: '1.0.0',
        environment: 'development',
        server: {
          port: 8080,
          host: '0.0.0.0',
          keepAlive: true,
          keepAliveTimeout: 65000,
          requestTimeout: 120000,
          maxHeaderSize: 8192,
          maxBodySize: 1048576,
        },
        routes: [],
        upstreams: [],
        plugins: [],
        performance: {
          workerCount: 0,
          bufferPoolSize: 100,
          responsePoolSize: 100,
          enablePooling: true,
          contextPoolSize: 1000, // May be missing in 1.0.0
        },
      };

      // Migration should succeed even with old version
      const customManager = new ConfigVersionManager('1.2.0');
      const migrated = customManager.migrateToCurrentVersion(oldConfig);

      expect(migrated.version).toBe('1.2.0');
    });

    it('should apply custom migration logic', () => {
      const customManager = new ConfigVersionManager('1.1.0');
      
      customManager.registerMigration('1.0.0', '1.1.0', (config) => {
        config['newField'] = 'added';
        return config;
      });

      const oldConfig: ConfigFile = {
        version: '1.0.0',
        environment: 'development',
        server: {
          port: 8080,
          host: '0.0.0.0',
          keepAlive: true,
          keepAliveTimeout: 65000,
          requestTimeout: 120000,
          maxHeaderSize: 8192,
          maxBodySize: 1048576,
        },
        routes: [],
        upstreams: [],
        plugins: [],
        performance: {
          workerCount: 0,
          contextPoolSize: 1000,
          bufferPoolSize: 100,
          responsePoolSize: 100,
          enablePooling: true,
        },
      };

      const migrated = customManager.migrateToCurrentVersion(oldConfig);

      expect((migrated as unknown as Record<string, unknown>)['newField']).toBe('added');
      expect(migrated.version).toBe('1.1.0');
    });

    it('should get all supported versions', () => {
      const versions = manager.getSupportedVersions();
      expect(versions.length).toBeGreaterThan(0);
      expect(versions[0]?.version).toBeDefined();
    });

    it('should throw error when migrating invalid config', () => {
      const invalidConfig = {
        version: '0.1.0', // Incompatible
      } as unknown as ConfigFile;

      expect(() => {
        manager.migrateToCurrentVersion(invalidConfig);
      }).toThrow();
    });
  });

  describe('Built-in migrations', () => {
    it('should have migration from 1.0.0 to 1.1.0', () => {
      const manager = new ConfigVersionManager('1.1.0');
      
      const oldConfig: ConfigFile = {
        version: '1.0.0',
        environment: 'development',
        server: {
          port: 8080,
          host: '0.0.0.0',
          keepAlive: true,
          keepAliveTimeout: 65000,
          requestTimeout: 120000,
          maxHeaderSize: 8192,
          maxBodySize: 1048576,
        },
        routes: [],
        upstreams: [],
        plugins: [],
        performance: {
          workerCount: 0,
          bufferPoolSize: 100,
          responsePoolSize: 100,
          enablePooling: true,
          contextPoolSize: 1000,
        },
      };

      const migrated = manager.migrateToCurrentVersion(oldConfig);

      // Should add contextPoolSize if missing
      expect(migrated.performance.contextPoolSize).toBeDefined();
      expect(migrated.version).toBe('1.1.0');
    });

    it('should have migration from 1.1.0 to 1.2.0', () => {
      const manager = new ConfigVersionManager('1.2.0');
      
      const oldConfig: ConfigFile = {
        version: '1.1.0',
        environment: 'development',
        server: {
          port: 8080,
          host: '0.0.0.0',
          keepAlive: true,
          keepAliveTimeout: 65000,
          requestTimeout: 120000,
          maxHeaderSize: 8192,
          maxBodySize: 1048576,
        },
        routes: [],
        upstreams: [],
        plugins: [],
        performance: {
          workerCount: 0,
          contextPoolSize: 1000,
          bufferPoolSize: 100,
          responsePoolSize: 100,
          enablePooling: true,
        },
      };

      const migrated = manager.migrateToCurrentVersion(oldConfig);

      expect(migrated.version).toBe('1.2.0');
    });
  });
});
