/**
 * Configuration versioning and migration system
 * Handles backward compatibility and configuration upgrades
 */

import { ConfigFile } from '../types/config.js';

/**
 * Version comparison result
 */
export enum VersionComparison {
  OLDER = -1,
  EQUAL = 0,
  NEWER = 1,
}

/**
 * Configuration migration function
 */
export type ConfigMigration = (config: Record<string, unknown>) => Record<string, unknown>;

/**
 * Configuration version info
 */
export interface VersionInfo {
  version: string;
  description: string;
  date: string;
}

/**
 * Parse semantic version string into components
 */
export function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  
  if (!match) {
    throw new Error(`Invalid version format: ${version}. Expected format: X.Y.Z`);
  }
  
  return {
    major: parseInt(match[1] as string, 10),
    minor: parseInt(match[2] as string, 10),
    patch: parseInt(match[3] as string, 10),
  };
}

/**
 * Compare two semantic versions
 */
export function compareVersions(v1: string, v2: string): VersionComparison {
  const ver1 = parseVersion(v1);
  const ver2 = parseVersion(v2);
  
  if (ver1.major !== ver2.major) {
    return ver1.major > ver2.major ? VersionComparison.NEWER : VersionComparison.OLDER;
  }
  
  if (ver1.minor !== ver2.minor) {
    return ver1.minor > ver2.minor ? VersionComparison.NEWER : VersionComparison.OLDER;
  }
  
  if (ver1.patch !== ver2.patch) {
    return ver1.patch > ver2.patch ? VersionComparison.NEWER : VersionComparison.OLDER;
  }
  
  return VersionComparison.EQUAL;
}

/**
 * Check if version is compatible (within 1 major version)
 */
export function isCompatibleVersion(configVersion: string, currentVersion: string): boolean {
  try {
    const config = parseVersion(configVersion);
    const current = parseVersion(currentVersion);
    
    // Same major version or 1 major version behind
    return config.major === current.major || config.major === current.major - 1;
  } catch {
    return false;
  }
}

/**
 * Configuration version manager
 */
export class ConfigVersionManager {
  private readonly currentVersion: string;
  private readonly migrations: Map<string, ConfigMigration> = new Map();
  private readonly versions: VersionInfo[] = [];
  
  constructor(currentVersion: string) {
    this.currentVersion = currentVersion;
    this.registerBuiltInMigrations();
  }
  
  /**
   * Register a migration from one version to the next
   */
  registerMigration(fromVersion: string, toVersion: string, migration: ConfigMigration): void {
    const key = `${fromVersion}->${toVersion}`;
    this.migrations.set(key, migration);
  }
  
  /**
   * Register version information
   */
  registerVersion(info: VersionInfo): void {
    this.versions.push(info);
    this.versions.sort((a, b) => compareVersions(a.version, b.version));
  }
  
  /**
   * Validate configuration version
   */
  validateVersion(config: ConfigFile): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!config.version) {
      errors.push('Configuration version is missing');
      return { valid: false, errors };
    }
    
    try {
      parseVersion(config.version);
    } catch (error) {
      errors.push(`Invalid version format: ${config.version}`);
      return { valid: false, errors };
    }
    
    if (!isCompatibleVersion(config.version, this.currentVersion)) {
      errors.push(
        `Configuration version ${config.version} is not compatible with current version ${this.currentVersion}`
      );
      return { valid: false, errors };
    }
    
    return { valid: true, errors };
  }
  
  /**
   * Migrate configuration to current version
   */
  migrateToCurrentVersion(config: ConfigFile): ConfigFile {
    const validation = this.validateVersion(config);
    
    if (!validation.valid) {
      throw new Error(`Cannot migrate invalid configuration: ${validation.errors.join(', ')}`);
    }
    
    let current = { ...config } as Record<string, unknown>;
    let currentVersion = config.version;
    
    // Apply migrations in sequence
    while (compareVersions(currentVersion, this.currentVersion) === VersionComparison.OLDER) {
      const nextVersion = this.getNextVersion(currentVersion);
      
      if (!nextVersion) {
        break; // No more migrations available
      }
      
      const migrationKey = `${currentVersion}->${nextVersion}`;
      const migration = this.migrations.get(migrationKey);
      
      if (migration) {
        current = migration(current);
        current['version'] = nextVersion;
        currentVersion = nextVersion;
      } else {
        // No migration defined, just update version
        current['version'] = nextVersion;
        currentVersion = nextVersion;
      }
    }
    
    return current as unknown as ConfigFile;
  }
  
  /**
   * Get the next version in the migration chain
   */
  private getNextVersion(currentVersion: string): string | null {
    const current = parseVersion(currentVersion);
    const target = parseVersion(this.currentVersion);
    
    // Try patch increment first
    if (current.major === target.major && current.minor === target.minor && current.patch < target.patch) {
      return `${current.major}.${current.minor}.${current.patch + 1}`;
    }
    
    // Try minor increment
    if (current.major === target.major && current.minor < target.minor) {
      return `${current.major}.${current.minor + 1}.0`;
    }
    
    // Try major increment
    if (current.major < target.major) {
      return `${current.major + 1}.0.0`;
    }
    
    return null;
  }
  
  /**
   * Get all supported versions
   */
  getSupportedVersions(): VersionInfo[] {
    return [...this.versions];
  }
  
  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }
  
  /**
   * Register built-in migrations
   */
  private registerBuiltInMigrations(): void {
    // Register version 1.0.0
    this.registerVersion({
      version: '1.0.0',
      description: 'Initial configuration schema',
      date: '2025-11-21',
    });
    
    // Register version 1.1.0 (Phase 2)
    this.registerVersion({
      version: '1.1.0',
      description: 'Phase 2: Enhanced routing and context pooling',
      date: '2025-11-21',
    });
    
    // Migration from 1.0.0 to 1.1.0
    this.registerMigration('1.0.0', '1.1.0', (config) => {
      // Phase 2 added performance.contextPoolSize
      if (!config['performance'] || typeof config['performance'] !== 'object') {
        config['performance'] = {};
      }
      
      const perf = config['performance'] as Record<string, unknown>;
      if (perf['contextPoolSize'] === undefined) {
        perf['contextPoolSize'] = 1000; // Default value
      }
      
      return config;
    });
    
    // Register version 1.2.0 (Phase 3)
    this.registerVersion({
      version: '1.2.0',
      description: 'Phase 3: Configuration hot reload and enhanced plugin system',
      date: '2025-11-21',
    });
    
    // Migration from 1.1.0 to 1.2.0
    this.registerMigration('1.1.0', '1.2.0', (config) => {
      // Phase 3 enhancements - no breaking changes needed
      // Configuration hot reload and plugin enhancements are backward compatible
      return config;
    });
  }
}

/**
 * Default configuration version manager instance
 */
export const configVersionManager = new ConfigVersionManager('1.2.0');
