---
title: "Menulis Plugin Gateway"
description: "Panduan lengkap menulis plugin TypeScript Gateway kustom untuk transformasi request/response, pemeriksaan keamanan, dan penegakan kebijakan."
---

Menulis plugin kustom untuk **TypeScript Gateway (`tsgate`)** memungkinkan Anda mencegat, memodifikasi, memeriksa, atau memutus HTTP request dan response saat runtime — tanpa satu pun dependensi runtime pihak ketiga.

Plugin adalah modul TypeScript biasa yang dimuat dari disk saat startup. Plugin menerima `RequestContext` hidup untuk setiap request dan mengaitkan diri ke pipeline gateway pada enam titik siklus hidup yang terdefinisi.

## Siklus Hidup & Arsitektur Plugin

Plugin mengimplementasikan antarmuka `Plugin` dari `src/types/plugin.ts`. Semua hook opsional; implementasikan hanya yang Anda butuhkan.

| Hook | Kapan berjalan | Kegunaan umum |
| --- | --- | --- |
| `init(config)` | Sekali saat plugin dimuat | Baca setelan, bangun tabel lookup |
| `preRoute(ctx)` | Sebelum route matching | Set correlation ID, tolak lebih awal |
| `preHandler(ctx)` | Setelah route match, sebelum upstream | Injeksi header, auth, rate limit |
| `postHandler(ctx)` | Setelah response upstream, sebelum klien | Ubah header response |
| `postResponse(ctx)` | Setelah response terkirim | Metrik, logging, cleanup |
| `onError(ctx, error)` | Saat error tak tertangani | Pelaporan error, header fallback |
| `destroy()` | Saat gateway shutdown | Flush buffer, tutup handle |

Setiap hook mengembalikan `void` atau `Promise<void>`. Hook async ditunggu secara berurutan kecuali plugin mendeklarasikannya di `asyncHooks`.

---

## 1. Objek `RequestContext`

Setiap hook menerima `RequestContext` yang sama dan mutable. Inilah objek yang Anda pakai — tidak ada pembungkus `ctx.request` atau `ctx.response` terpisah.

| Field | Tipe | Catatan |
| --- | --- | --- |
| `requestId` | `string` | Correlation ID; isi di `preRoute` |
| `method` | `HttpMethod` | Verb huruf besar |
| `path` | `string` | Hanya path, query sudah dipisah |
| `query` | `Record<string, string> \| null` | Diparse lazy |
| `params` | `Record<string, string>` | Terisi setelah route match |
| `headers` | `Record<string, string \| string[] \| undefined>` | Referensi langsung ke `req.headers` — memutasinya memutasi request |
| `body` | `Buffer \| null` | Body request mentah |
| `req` | `IncomingMessage` | Request Node mentah |
| `res` | `ServerResponse` | Response Node mentah |
| `upstream` | `UpstreamTarget \| null` | Target upstream hasil resolusi |
| `state` | `Record<string, unknown>` | Objek biasa untuk data plugin per-request |
| `responded` | `boolean` | Set `true` untuk short-circuit |
| `route` | `RouteMatch \| null` | Info route yang cocok |
| `timestamps` | `object` | Timestamp fase pipeline dalam nanodetik |

Dua perbedaan penting dari banyak API gateway lain:

- **`ctx.headers` adalah map header request secara langsung.** Tidak ada `ctx.request.headers`.
- **`ctx.state` adalah objek biasa**, bukan Map dengan method `set`/`get`. Pakai `ctx.state['myKey'] = value`.

Untuk header response gunakan API Node pada `ctx.res`: `ctx.res.setHeader(name, value)`.

---

## 2. Menulis Plugin Pertama Anda

Buat file di direktori `plugins/` **di sebelah file config gateway Anda** (lihat §3 untuk cara direktori diresolusi):

```typescript
import { PluginHook } from 'typescript-gateway';
import type { Plugin, RequestContext } from 'typescript-gateway';

export interface MyPluginConfig {
  headerName?: string;
  prefix?: string;
}

export class MyPlugin implements Plugin {
  name = 'my-plugin';
  version = '1.0.0';
  description = 'Injects a tracing header and reports handler duration';

  asyncHooks: PluginHook[] = [PluginHook.POST_RESPONSE];

  private headerName = 'X-Gateway-Custom';
  private prefix = 'processed';

  init(config: Record<string, unknown>): void {
    if (typeof config['headerName'] === 'string') this.headerName = config['headerName'];
    if (typeof config['prefix'] === 'string') this.prefix = config['prefix'];
  }

  preRoute(ctx: RequestContext): void {
    const incoming = ctx.headers['x-request-id'];
    const requestId = Array.isArray(incoming) ? incoming[0] : (incoming ?? 'unknown');
    ctx.res.setHeader(this.headerName, `${this.prefix}-${requestId}`);
    ctx.state['customStartTime'] = Date.now();
  }

  postHandler(ctx: RequestContext): void {
    const start = ctx.state['customStartTime'] as number | undefined;
    if (start !== undefined) {
      ctx.res.setHeader('x-plugin-duration-ms', String(Date.now() - start));
    }
  }

  postResponse(ctx: RequestContext): void {
    // berjalan di luar jalur request: aman untuk logging dan metrik
  }
}

export default new MyPlugin();
```

Loader menerima **default export** atau **modul itu sendiri** sebagai objek plugin (`module.default || module`). Objek harus mengekspos properti string `name`, `version`, dan `description`, atau loader menolaknya dengan `Invalid plugin: missing required properties`.

### Berbagi data antar plugin

`ctx.state` bersifat bersama, jadi beri namespace pada key Anda dan baca kembali dengan cast:

```typescript
ctx.state['my-plugin:requestId'] = requestId;
const mine = ctx.state['my-plugin:requestId'] as string;

ctx.state['shared:responseTime'] = durationMs;
const shared = ctx.state['shared:responseTime'] as number;
```

`pluginContextManager` internal (`src/plugins/context-manager.ts`) menawarkan namespacing yang sama dengan `set`/`get`/`setShared`/`getShared`, tetapi ia bukan bagian dari export map publik paket — impor hanya jika Anda bekerja di dalam repositori.

---

## 3. Mendaftarkan Plugin

Plugin kustom **dimuat dari direktori**, bukan dari array `plugins` di config Anda. Saat startup, CLI meresolusi direktori plugin sebagai `plugins/` relatif terhadap direktori file config itu sendiri:

```
my-gateway/
├── gateway.config.json      <- config yang dilewatkan ke `tsgate start -c`
└── plugins/
    ├── my-plugin.ts         <- dimuat otomatis
    └── audit-log.js
```

Setiap file `.ts` dan `.js` di direktori itu di-import dan diregistrasi. Plugin yang gagal dimuat akan dicatat dan dilewati — sisanya tetap jalan.

Plugin TypeScript memerlukan `tsx` terpasang, karena CLI meregistrasi ESM loader `tsx` sebelum mengimpornya:

```bash
npm install tsx
```

Jika ada file `.ts` tetapi `tsx` tidak ada, gateway keluar dengan:

```
TypeScript plugins found in <dir> but tsx is not installed. Run: npm install tsx
```

Lalu jalankan gateway:

```bash
tsgate start -c gateway.config.json
```

### Array `plugins` di config hanya untuk built-in

Array `plugins` di file config Anda hanya menerima **registry built-in**:

```json
{
  "plugins": [
    { "name": "request-id", "enabled": true, "settings": { "prefix": "req-" } }
  ]
}
```

Nama yang valid: `auth-jwt`, `header-transformer`, `rate-limit`, `request-id`, `request-logger`, dan `response-time`. Nama lain akan mencatat `Unknown builtin plugin in config.plugins[] — ignoring`. Untuk mengonfigurasi plugin kustom, baca setelannya dari argumen `init(config)`, atau simpan nilainya di modul Anda sendiri.

---

## 4. Praktik Terbaik Plugin Berperforma Tinggi

- **Deklarasikan `asyncHooks` untuk hook yang tidak memutasi.** Hook yang terdaftar di `asyncHooks` dikirim sebagai microtask dan *tidak* ditunggu sebelum gateway melanjutkan. Hanya daftarkan hook yang tidak pernah memutasi alur request atau response — logging, metrik, cleanup. Hook yang memutasi harus tetap sinkron.
- **Jangan alokasi apa pun di `preRoute` dan `preHandler`.** Keduanya berjalan pada setiap request, sebelum socket hop ke upstream. Pakai ulang objek, hindari spread pada `ctx.state`, dan lewati pembuatan string yang tidak perlu.
- **Short-circuit daripada melempar error.** Set `ctx.responded = true` setelah menulis response Anda untuk menghentikan pipeline dengan bersih; melempar error akan melewati `onError` dan jalur error generik.
- **Jaga penulisan response.** Setelah response terkirim, `ctx.res.setHeader()` akan melempar. Periksa `ctx.responded` atau pakai `postResponse`, yang berjalan setelah response di-flush.
- **Isolasi error otomatis.** Execution chain membungkus setiap pemanggilan plugin dalam batas try/catch, sehingga plugin yang melempar error tidak bisa membuat worker crash. Ini tidak membuat plugin gratis — wrapper tetap memakan waktu di jalur panas.
- **Jaga `init` murah dan sinkron.** Ia berjalan sekali, sebelum server mulai mendengarkan.

---

## 5. Checklist Verifikasi

Sebelum merilis plugin:

1. `npm run typecheck` lulus — plugin adalah bagian dari pohon terkompilasi.
2. Gateway start dan mencatat `Plugin loaded` dengan nama dan versi plugin Anda.
3. Request melalui gateway memperlihatkan mutasi Anda (header, body, atau short-circuit).
4. Dengan `LOG_LEVEL=warn` plugin tidak menghasilkan noise log per-request.
5. Di bawah beban, key `ctx.state` tidak tumbuh tanpa batas per request.
