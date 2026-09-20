---
title: "Operations & Configuration (F6)"
description: "Zero-dependency config loading and validation, plugin execution chain, auto-tuning."
order: 9
section: "Features"
---

# Operations & Configuration

Zero-dependency config loading and validation, plugin execution chain, auto-tuning.

All 3 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Auto Tuner

Auto-Tuner mengamati pola beban gateway (RPS, latency, CPU, koneksi aktif) dalam window
observasi, lalu merekomendasikan — atau, dalam mode non-safe, menerapkan — penyesuaian
parameter performa: ukuran connection pool, jumlah worker thread, buffer size, timeout,
dan cache size. Tujuannya menjaga p99 latency dan utilisasi resource tetap sehat tanpa
intervensi operator manual untuk tuning rutin.

### Configuration

```jsonc
"performance": {
  "workerCount": 0,            // 0 = CPU count
  "contextPoolSize": 1000,
  "bufferPoolSize": 1000,
  "responsePoolSize": 1000,
  "enablePooling": true
}
```

`AutoTunerConfig` (dari kode, bukan file konfigurasi utama):

```ts
{
  enabled: true,
  observationWindow: 300000,   // ms, 5 menit
  minObservations: 10,
  safeMode: true,              // hanya rekomendasi, tidak auto-apply
  aggressiveness: 'moderate'   // conservative | moderate | aggressive
}
```

Perubahan `PERFORMANCE_CONFIG` di `config/gateway.config.json` tetap perlu restart
karena config tidak di-hot-reload (lihat Config-Loader OP-006).

### Edge cases

- **Observasi < `minObservations`** → window di-skip, tidak ada rekomendasi (mencegah
  keputusan dari sampel terlalu kecil).
- **Semua metrik nol** (gateway idle) → `calculateAverage` = 0 → hanya trigger
  scale-down pool (< 30% utilisasi) dan scale-down worker (CPU < 0.3); tidak pernah
  turun di bawah `min`.
- **Rekomendasi melebihi max / di bawah min** → di-clamp ke batas parameter
  (`Math.min(param.max, ...)`, `Math.max(param.min, ...)`).
- **`safeMode: true`** (default) → tidak ada mutasi runtime sama sekali; operator
  membaca `getRecommendations()` dan memutuskan sendiri.
- **`applyOptimizations` dipanggil manual** → memperbarui `param.current` in-memory;
  tidak menulis `gateway.config.json` dan tidak me-restart pool (lihat batasan di bawah).
- **`startTuning()` dua kali** → no-op kedua kali (guard `if (this.tuning) return`).
- **`updateParameter` dengan nilai di luar rentang** → di-clamp ke [min, max].
- **History > 100 observasi** → dipangkas ke 100 terakhir (filter index).
- **Worker count direkomendasikan naik** → hanya rekomendasi; penerapan butuh restart
  proses (worker thread tidak bisa dibuat/dihancurkan mid-flight oleh file ini).
- **aggressiveness di-set tapi belum memengaruhi ambang** → field ada di config,
  analisis saat ini memakai ambang tetap; di-dokumentasikan agar tidak dianggap aktif.


## Config Loader and Validator

Gateway konvensional memakai library validasi eksternal (AJV, schema JSON). Proyek ini
berkomitmen **zero-dependency**: file `config/gateway.config.json` adalah satu-satunya
artefak persisten di seluruh sistem, dan setiap jalur yang membacanya ditulis native —
Node.js stdlib saja. Fitur ini mencakup pembacaan, interpolasi variabel environment,
validasi native, dan migrasi versi konfigurasi.

- Membaca `config/gateway.config.json` ke dalam `ConfigFile` yang terjamin bentuknya.
- Mengganti placeholder `${VAR}` / `${VAR:default}` tanpa dependency.
- Menolak konfigurasi cacat saat boot, bukan saat request pertama gagal.
- Menjaga kompatibilitas mundur: konfigurasi versi lama dimigrasi otomatis.

`src/config/interpolation.ts`, `src/config/versioning.ts`.

### How it works

Alur boot (`ConfigLoader.load()`):

1. `fs/promises.readFile(configPath, 'utf-8')` — baca file konfigurasi.
2. `JSON.parse` — kesalahan sintaks dilempar sebagai `Invalid JSON in configuration file`.
3. `interpolateConfig(cfg, { strict: false })` bila `options.interpolate` aktif —
   rekursif: string, array, object; path JSON dilacak untuk pesan error.
4. `configValidator.validateOrThrow(cfg)` — validasi native, bila `validate !== false`.
5. Default server di-merge: `{ ...DEFAULT_SERVER, ...cfg.server }` — nilai eksplisit
   selalu menang, key yang hilang dapat default aman.
6. Hasil disimpan di `this.config`; `getConfig()` mengembalikannya.

Validasi native (`ConfigValidator.validate`) memeriksa: root harus object (bukan array);
`version` harus cocok `^\d+\.\d+\.\d+$`; `environment` harus salah satu
`development | staging | production`; `server` harus object, `server.port` integer
1–65535, `server.host` string. Hasil berupa `{ valid, errors: [{path, message, code}] }`.
`validateOrThrow` menggabungkan semua error dalam satu pesan (semua pelanggaran
dilaporkan sekaligus, bukan satu per satu).

Interpolasi memakai regex
`/\$\{([A-Z_][A-Z0-9_]*?)(?::([^}]*))?\}/g`:

- `${PORT}` → nilai `process.env.PORT`; bila tidak ada dan `strict: true`, lempar
  `InterpolationError(variable, path)`.
- `${PORT:3000}` → `3000` sebagai default literal.
- Non-strict (mode yang dipakai loader) → placeholder dibiarkan apa adanya.
- `extractEnvVars()` dan `validateEnvVars()` memindai referensi tanpa melakukan
  substitusi — untuk dokumentasi dan pre-flight check.

Versioning (`ConfigVersionManager`, current `1.2.0`): `parseVersion` X.Y.Z,
`compareVersions` per-komponen, `isCompatibleVersion` (major sama atau tepat satu major
di belakang), `migrateToCurrentVersion` berjalan menaik patch → minor → major dan
menerapkan migration terdaftar (`1.0.0 → 1.1.0` menanam `performance.contextPoolSize = 1000`;
`1.1.0 → 1.2.0` no-op kompatibel).

### Configuration

```jsonc
{
  "version": "1.0.0",            // wajib, pola ^\d+\.\d+\.\d+$
  "environment": "development",  // wajib: development | staging | production
  "server": {                    // server config, lihat OP-002
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

Loader opsional: `{ configPath, validate?: boolean, interpolate?: boolean }`.
`createConfigLoader` menerima juga `hotReload`, `reloadInterval`, `defaults` (diterima
sebagai parameter, saat ini tidak digunakan implementasi loader — lihat OP-006).

Variabel environment direferensikan dengan `${VAR}` / `${VAR:default}` di nilai string
mana pun.

### Edge cases

- **File konfigurasi hilang** → `readFile` melempar `ENOENT`; boot gagal dengan pesan
  jelas. Tidak ada config fallback implisit.
- **JSON sintaks rusak** → `Invalid JSON in configuration file: <parse message>` — bagian
  dari error parser, tidak ditelan.
- **Root adalah array / string** → `Configuration must be an object`, `code: 'type'`.
- **`${VAR}` tidak ada, strict** → `InterpolationError` membawa nama variabel dan path
  (`upstreams[0].host`) — bisa dilacak ke key mana.
- **`${VAR}` tidak ada, non-strict** → placeholder dipertahankan verbatim; validasi
  kemudian yang menolak nilai ilegal.
- **Port bukan integer / keluar rentang** → `must be <= 65535 and >= 1 integer`,
  `code: 'maximum'`.
- **Server key hilang** → `must be object`; seluruh error dikumpulkan lalu dilempar
  sekaligus.
- **Versi konfigurasi 2 minor di belakang** → `validateVersion` menolak
  (`not compatible`); migrasi hanya menerima major sama atau satu major di belakang.
- **Versi format bebas** (`v1.0`) → ditolak di `parseVersion` dan di `validate`
  (pola `^\d+\.\d+\.\d+$`).
- **Nested interpolation** (`${A_${B}}`) → tidak didukung; regex hanya satu level.
- **Default server + nilai eksplisit** → spread `{...DEFAULT_SERVER, ...cfg.server}`
  aman: eksplisit selalu menang.


## Plugin Execution Chain

Sistem plugin adalah titik ekstensi utama gateway: semua logika lintas-cutting
(rate limiting, transformasi header, logging, auth) berjalan sebagai plugin, bukan
hard-coded di pipeline request. Fitur ini mendefinisikan lifecycle hook, urutan
eksekusi, timeout per plugin, short-circuit, dan kumpulan plugin bawaan.

- Menyediakan kontrak plugin (`Plugin` interface) dengan hook lifecycle yang jelas.
- Mengeksekusi hook berurutan dengan timeout, metrik, dan error boundary per plugin.
- Menyertakan plugin bawaan siap pakai, tanpa dependency eksternal.
- Status jujur: plugin `auth-jwt` masih **in-progress / uncommitted** di working tree.

`src/plugins/context-manager.ts`, `src/plugins/metrics.ts`, `src/plugins/builtin/*`.

### Configuration

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

Opsi execution chain: `{ timeout: 5000, collectMetrics: true, enableCaching: false,
shortCircuitOnError: false }`.

### Edge cases

- **Plugin `init()` melempar** → di-log `error`, plugin tetap terdaftar; kegagalan
  nyata muncul saat eksekusi hook (fail-late, bukan gagal boot).
- **Plugin hook hang** → timeout (`default 5000 ms`) melempar
  `Plugin <name>.<hook> timed out after <N>ms`; tercatat `timedOut: true`, chain
  lanjut ke plugin berikutnya.
- **Plugin short-circuit** (`ctx.responded = true`, mis. rate-limit 429) → sisa
  chain dilewati, tercatat `shortCircuited: true`; proxy tidak pernah dipanggil.
- **Plugin tidak implement hook tsb** → skip cepat, hasil
  `success: true, duration: 0`.
- **Plugin melempar error** → ditangkap, `success: false`, chain lanjut kecuali
  `shortCircuitOnError: true`.
- **Plugin file rusak / export invalid** → loader skip file, `warn` log, plugin
  lain tetap dimuat.
- **`onError` hanya dipanggil bila ada error param** — wrapper melewatkan pemanggilan
  bila error tidak ada.
- **Duplicate plugin name** → `Map` menimpa wrapper lama (registrasi terakhir menang).
- **auth-jwt dengan JWKS invalid** → verifikasi gagal → request ditolak 401 (jalur
  plugin); status fitur tetap in-progress sampai di-commit.
- **enable/disable runtime** → `wrapper.enabled` dan metrik collector sinkron;
  plugin disabled di-skip tanpa eksekusi.
