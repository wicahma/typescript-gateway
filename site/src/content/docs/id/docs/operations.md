---
title: "Operations & Configuration"
description: "Config loading dan validasi zero-dependency, plugin execution chain, auto-tuning."
order: 9
section: "Features"
track: "reference"
---

Ketiga fitur di grup ini sudah **implemented dan terverifikasi** — masing-masing punya pasangan spek FSD + ERD lengkap dan coverage unit/integration di test suite repo.

## Auto Tuner

Auto-Tuner mengamati pola beban gateway (RPS, latensi, CPU, koneksi aktif) selama
window observasi, lalu merekomendasikan — atau, di mode non-safe, menerapkan — penyesuaian
parameter performa: ukuran connection pool, jumlah worker thread, ukuran buffer, timeout,
dan ukuran cache. Tujuannya menjaga latensi p99 dan utilisasi resource tetap sehat tanpa
intervensi operator manual untuk tuning rutin.

### Konfigurasi

```jsonc
"performance": {
  "workerCount": 0,            // 0 = CPU count
  "contextPoolSize": 1000,
  "bufferPoolSize": 1000,
  "responsePoolSize": 1000,
  "enablePooling": true
}
```

`AutoTunerConfig` (dari kode, bukan file config utama):

```ts
{
  enabled: true,
  observationWindow: 300000,   // ms, 5 minutes
  minObservations: 10,
  safeMode: true,              // recommendations only, no auto-apply
  aggressiveness: 'moderate'   // conservative | moderate | aggressive
}
```

Mengubah `PERFORMANCE_CONFIG` di `config/gateway.config.json` tetap butuh restart
karena config tidak di-hot-reload (lihat Config-Loader OP-006).

### Edge case

- **Observasi lebih sedikit dari `minObservations`** → window dilewati, tidak ada rekomendasi (mencegah
  keputusan dari sampel terlalu kecil).
- **Semua metrik nol** (gateway idle) → `calculateAverage` = 0 → hanya scale-down pool
  (utilisasi < 30%) dan scale-down worker (CPU < 0.3) yang terpicu; tidak pernah di bawah `min`.
- **Rekomendasi di atas max / di bawah min** → di-clamp ke batas parameter
  (`Math.min(param.max, ...)`, `Math.max(param.min, ...)`).
- **`safeMode: true`** (default) → tidak ada mutasi runtime sama sekali; operator
  membaca `getRecommendations()` dan memutuskan.
- **`applyOptimizations` dipanggil manual** → meng-update `param.current` in-memory;
  tidak menulis `gateway.config.json` dan tidak me-restart pool (lihat keterbatasan di bawah).
- **`startTuning()` dipanggil dua kali** → panggilan kedua no-op (guard `if (this.tuning) return`).
- **`updateParameter` dengan nilai di luar rentang** → di-clamp ke [min, max].
- **History > 100 observasi** → dipangkas ke 100 terakhir (filter index).
- **Rekomendasi menaikkan jumlah worker** → rekomendasi saja; menerapkannya butuh restart
  proses (worker thread tidak bisa dibuat/dihancurkan mid-flight oleh file ini).
- **aggressiveness di-set tapi belum memengaruhi ambang** → field-nya ada di config;
  analisis saat ini memakai ambang tetap; didokumentasikan supaya tidak disangka aktif.


## Config Loader and Validator

Gateway konvensional memakai library validasi eksternal (AJV, JSON schema). Proyek ini
berkomitmen pada **zero-dependency**: `config/gateway.config.json` adalah satu-satunya
artefak persisten di seluruh sistem, dan setiap jalur yang membacanya ditulis secara native —
hanya stdlib Node.js. Fitur ini mencakup pembacaan, interpolasi environment-variable,
validasi native, dan migrasi versi konfigurasi.

- Membaca `config/gateway.config.json` ke dalam `ConfigFile` dengan bentuk terjamin.
- Mensubstitusi placeholder `${VAR}` / `${VAR:default}` tanpa dependency.
- Menolak konfigurasi rusak saat boot, bukan saat request pertama yang gagal.
- Menjaga kompatibilitas mundur: konfigurasi versi lama dimigrasi otomatis.

`src/config/interpolation.ts`, `src/config/versioning.ts`.

### Cara kerja

Alur boot (`ConfigLoader.load()`):

1. `fs/promises.readFile(configPath, 'utf-8')` — baca file konfigurasi.
2. `JSON.parse` — error sintaks dilempar sebagai `Invalid JSON in configuration file`.
3. `interpolateConfig(cfg, { strict: false })` saat `options.interpolate` aktif —
   rekursif: string, array, objek; path JSON dilacak untuk pesan error.
4. `configValidator.validateOrThrow(cfg)` — validasi native, saat `validate !== false`.
5. Default server digabung: `{ ...DEFAULT_SERVER, ...cfg.server }` — nilai eksplisit
   selalu menang, key yang hilang dapat default aman.
6. Hasil disimpan di `this.config`; `getConfig()` mengembalikannya.

Validasi native (`ConfigValidator.validate`) mengecek: root harus objek (bukan array);
`version` harus cocok dengan `^\d+\.\d+\.\d+$`; `environment` harus salah satu dari
`development | staging | production`; `server` harus objek, `server.port` integer
1–65535, `server.host` string. Hasilnya `{ valid, errors: [{path, message, code}] }`.
`validateOrThrow` menggabungkan semua error ke satu pesan (setiap pelanggaran
dilaporkan sekaligus, bukan satu-satu).

Interpolasi memakai regex
`/\$\{([A-Z_][A-Z0-9_]*?)(?::([^}]*))?\\}/g`:

- `${PORT}` → nilai `process.env.PORT`; kalau hilang dan `strict: true`, lempar
  `InterpolationError(variable, path)`.
- `${PORT:3000}` → `3000` sebagai default literal.
- Non-strict (mode loader) → placeholder dibiarkan apa adanya.
- `extractEnvVars()` dan `validateEnvVars()` memindai referensi tanpa melakukan
  substitusi — untuk dokumentasi dan pre-flight check.

Versioning (`ConfigVersionManager`, saat ini `1.2.0`): `parseVersion` X.Y.Z,
`compareVersions` per komponen, `isCompatibleVersion` (major sama, atau tepat satu major
di belakang), `migrateToCurrentVersion` berjalan naik patch → minor → major dan
menerapkan migrasi terdaftar (`1.0.0 → 1.1.0` menanam `performance.contextPoolSize = 1000`;
`1.1.0 → 1.2.0` adalah no-op yang kompatibel).

### Konfigurasi

```jsonc
{
  "version": "1.0.0",            // required, pattern ^\d+\.\d+\.\d+$
  "environment": "development",  // required: development | staging | production
  "server": {                    // server config, see OP-002
    "port": 3000, "host": "0.0.0.0",
    "keepAlive": true, "keepAliveTimeout": 65000,
    "requestTimeout": 30000, "maxHeaderSize": 16384, "maxBodySize": 10485760
  },
  "routes": [ { "method": "GET", "path": "/api/:id", "priority": 0 } ],
  "upstreams": [ /* id, protocol, host, port, basePath, poolSize, timeout, healthCheck */ ],
  "plugins": [ { "name": "request-id", "enabled": true, "settings": {} } ],
  "performance": { "workerCount": 0, "contextPoolSize": 1000, "bufferPoolSize": 1000,
                   "responsePoolSize": 1000, "enablePooling": true }
}
```

Opsi loader: `{ configPath, validate?: boolean, interpolate?: boolean }`.
`createConfigLoader` juga menerima `hotReload`, `reloadInterval`, `defaults` (diterima
sebagai parameter, saat ini belum dipakai implementasi loader — lihat OP-006).

Environment variable direferensikan dengan `${VAR}` / `${VAR:default}` di nilai
string mana pun.

### Edge case

- **File konfigurasi hilang** → `readFile` melempar `ENOENT`; boot gagal dengan pesan
  yang jelas. Tidak ada fallback config implisit.
- **Sintaks JSON rusak** → `Invalid JSON in configuration file: <parse message>` — bagian
  dari error parser, tidak pernah ditelan.
- **Root berupa array / string** → `Configuration must be an object`, `code: 'type'`.
- **`${VAR}` hilang, strict** → `InterpolationError` membawa nama variabel dan path
  (`upstreams[0].host`) — bisa dilacak ke key persisnya.
- **`${VAR}` hilang, non-strict** → placeholder dipertahankan verbatim; validasi
  setelahnya menolak nilai ilegal.
- **Port bukan integer / di luar rentang** → `must be <= 65535 and >= 1 integer`,
  `code: 'maximum'`.
- **Key server hilang** → `must be object`; semua error dikumpulkan lalu dilempar
  sekaligus.
- **Versi config dua minor di belakang** → `validateVersion` menolaknya
  (`not compatible`); migrasi hanya menerima major sama atau satu major di belakang.
- **Versi bentuk bebas** (`v1.0`) → ditolak di `parseVersion` dan di `validate`
  (pattern `^\d+\.\d+\.\d+$`).
- **Interpolasi bersarang** (`${A_${B}}`) → tidak didukung; regex hanya menangani satu level.
- **Default server + nilai eksplisit** → spread `{...DEFAULT_SERVER, ...cfg.server}`
  aman: eksplisit selalu menang.


## Plugin Execution Chain

Sistem plugin adalah titik ekstensi utama gateway: semua logika cross-cutting
(rate limiting, transformasi header, logging, auth) jalan sebagai plugin, bukan
hard-coded di request pipeline. Fitur ini mendefinisikan lifecycle hook, urutan
eksekusi, timeout per-plugin, short-circuiting, dan kumpulan plugin bawaan.

- Menyediakan kontrak plugin (interface `Plugin`) dengan lifecycle hook yang jelas.
- Mengeksekusi hook secara berurutan dengan timeout, metrics, dan error boundary per plugin.
- Dikirim dengan plugin bawaan siap pakai, tanpa dependency eksternal.
- Status jujur: plugin `auth-jwt` masih **in-progress / uncommitted** di working tree.

`src/plugins/context-manager.ts`, `src/plugins/metrics.ts`, `src/plugins/builtin/*`.

### Konfigurasi

```jsonc
"plugins": [
  { "name": "request-id", "enabled": true,
    "settings": { "headerName": "x-request-id", "prefix": "req-", "overwrite": false } },
  { "name": "rate-limit", "enabled": true,
    "settings": { "capacity": 100, "refillRate": 50 } },
  { "name": "header-transformer", "enabled": true,
    "settings": { "request": { "set": { "x-gateway": "tsg" } } } },
  { "name": "auth-jwt", "enabled": true,          // IN-PROGRESS, uncommitted
    "settings": { "issuer": "https://auth.example", "audience": "api",
                  "jwks": { "keys": [ /* JWK RSA */ ] },
                  "publicRoutes": ["/", "/health"], "leewaySeconds": 30 } }
]
```

Opsi execution-chain: `{ timeout: 5000, collectMetrics: true, enableCaching: false,
shortCircuitOnError: false }`.

### Edge case

- **`init()` plugin melempar error** → di-log di `error`, plugin tetap terdaftar; kegagalan
  asli muncul saat hook dieksekusi (fail-late, bukan boot gagal).
- **Hook plugin hang** → timeout (default 5000 ms) melempar
  `Plugin <name>.<hook> timed out after <N>ms`; dicatat dengan `timedOut: true`, chain
  lanjut ke plugin berikutnya.
- **Plugin short-circuit** (`ctx.responded = true`, mis. rate-limit 429) → sisa
  chain dilewati, dicatat dengan `shortCircuited: true`; proxy tidak pernah dipanggil.
- **Plugin tidak mengimplementasikan hook itu** → skip cepat, hasil
  `success: true, duration: 0`.
- **Plugin melempar error** → ditangkap, `success: false`, chain lanjut kecuali
  `shortCircuitOnError: true`.
- **File plugin rusak / export tidak valid** → loader melewati file, log `warn`, plugin
  lain tetap dimuat.
- **`onError` hanya dipanggil saat ada param error** — wrapper melewati panggilan
  saat tidak ada error.
- **Nama plugin duplikat** → `Map` menimpa wrapper lama (registrasi terakhir menang).
- **auth-jwt dengan JWKS tidak valid** → verifikasi gagal → request ditolak 401 (jalur
  plugin); status fitur tetap in-progress sampai di-commit.
- **Enable/disable runtime** → `wrapper.enabled` dan kolektor metrics tetap sinkron;
  plugin yang disabled dilewati tanpa eksekusi.
