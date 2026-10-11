---
title: "Mesin Konfigurasi (Configuration Engine)"
description: "Pemuatan konfigurasi, interpolasi variabel lingkungan, validasi, dan penyesuaian otomatis."
---

Modul konfigurasi mengurai, memvalidasi, dan mengelola opsi runtime gateway. Modul ini menyelesaikan path file, melakukan validasi skema dengan diagnostik terperinci, mengganti variabel lingkungan melalui interpolasi string, dan menyesuaikan worker thread serta batas konkurensi secara otomatis sesuai spesifikasi CPU host. Lapisan ini menjamin keabsahan konfigurasi sebelum server melakukan binding ke soket.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
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

## Catatan (Notes)

### ConfigLoader
Membaca file konfigurasi JSON atau JS dan memvalidasi skema rute yang diperlukan secara rekursif.

### Interpolation
Menggantikan pola `${ENV_VAR:-fallback}` secara aman tanpa membocorkan konten lingkungan.

### AutoTuner
Memeriksa memori yang tersedia dan konkurensi perangkat keras untuk menghitung ukuran Keep-Alive pool yang optimal.

## Sumber (Source)

- `src/config/auto-tuner.ts`
- `src/config/interpolation.ts`
- `src/config/loader.ts`
- `src/config/openapi-routes.ts`
- `src/config/validator.ts`
- `src/config/versioning.ts`

## Lihat juga (See also)

- [Panduan: Konfigurasi](/id/docs/guides/configuration/)
