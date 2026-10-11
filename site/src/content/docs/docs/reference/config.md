---
title: "Configuration Engine"
description: "Configuration loading, environment variable interpolation, validation, and auto-tuning."
---

The config module parses, validates, and manages gateway runtime options. It resolves file paths, performs schema validation with detailed diagnostics, substitutes environment variables via string interpolation, and auto-tunes worker threads and concurrency thresholds according to host CPU specifications. This layer guarantees configuration soundness prior to server socket binding.

## Exports

| Symbol | Kind | Signature | Purpose |
| --- | --- | --- | --- |
| `ConfigOptimization` | interface | `interface ConfigOptimization` | Configuration optimization recommendation |
| `LoadPattern` | interface | `interface LoadPattern` | Load pattern analysis |
| `AutoTunerConfig` | interface | `interface AutoTunerConfig` | Auto-tuner configuration |
| `AutoTuner` | class | `class AutoTuner` | Auto-Tuner class |
| `InterpolationError` | class | `class InterpolationError extends Error` | Interpolation error for tracking issues during variable replacement |
| `InterpolationOptions` | interface | `interface InterpolationOptions` | Interpolation options |
| `interpolateString` | function | `function interpolateString(` | Interpolate environment variables in a string value  @param value - String value that may contain ${ENV_VAR} or ${ENV_VA |
| `interpolateConfig` | function | `function interpolateConfig<T>(` | Recursively interpolate environment variables in a configuration object  @param config - Configuration object @param opt |
| `extractEnvVars` | function | `function extractEnvVars(config: unknown): Set<string>` | Extract all environment variable references from a configuration object Useful for documentation and validation  @param  |
| `validateEnvVars` | function | `function validateEnvVars(` | Validate that all required environment variables are set  @param config - Configuration object @param env - Environment  |
| `ConfigLoader` | class | `class ConfigLoader` | Class export for ConfigLoader. |
| `createConfigLoader` | function | `function createConfigLoader(options:` | Function export for createConfigLoader. |
| `OpenApiRoute` | interface | `interface OpenApiRoute` | Interface export for OpenApiRoute. |
| `OpenApiRouteOptions` | interface | `interface OpenApiRouteOptions` | Interface export for OpenApiRouteOptions. |
| `routesFromOpenApi` | function | `function routesFromOpenApi(` | Function export for routesFromOpenApi. |
| `ConfigValidator` | class | `class ConfigValidator` | Class export for ConfigValidator. |
| `configValidator` | const | `const configValidator: ConfigValidator = new ConfigValidator()` | Const export for configValidator. |
| `VersionComparison` | enum | `enum VersionComparison` | Version comparison result |
| `ConfigMigration` | type | `type ConfigMigration = (config: Record<string, unknown>) => Record<string, unknown>` | Configuration migration function |
| `VersionInfo` | interface | `interface VersionInfo` | Configuration version info |
| `parseVersion` | function | `function parseVersion(version: string): { major: number; minor: number; patch: number }` | Parse semantic version string into components |
| `compareVersions` | function | `function compareVersions(v1: string, v2: string): VersionComparison` | Compare two semantic versions |
| `isCompatibleVersion` | function | `function isCompatibleVersion(configVersion: string, currentVersion: string): boolean` | Check if version is compatible (within 1 major version) |
| `ConfigVersionManager` | class | `class ConfigVersionManager` | Configuration version manager |
| `configVersionManager` | const | `const configVersionManager = new ConfigVersionManager('1.2.0')` | Default configuration version manager instance |

## Notes

### ConfigLoader
Reads JSON or JS configuration files and recursively validates required route schemas.

### Interpolation
Substitutes `${ENV_VAR:-fallback}` patterns securely without leaking environment contents.

### AutoTuner
Inspects available memory and hardware concurrency to calculate optimal Keep-Alive pool sizes.

## Source

- `src/config/auto-tuner.ts`
- `src/config/interpolation.ts`
- `src/config/loader.ts`
- `src/config/openapi-routes.ts`
- `src/config/validator.ts`
- `src/config/versioning.ts`

## See also

- [Guides: Configuration](/docs/guides/configuration/)
