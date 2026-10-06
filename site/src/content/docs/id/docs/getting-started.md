---
title: "Memulai"
description: "Dari nol sampai gateway jalan dalam sekitar dua menit. Nggak perlu paham framework apa pun."
order: 1
section: "Guide"
track: "guide"
---

TypeScript Gateway adalah reverse proxy dan API gateway yang ditulis murni pakai
TypeScript di atas `node:http` bawaan Node. Nggak ada framework di baliknya —
install, tulis satu file JSON, dan kamu sudah punya gateway.

## Yang kamu butuhkan

- **Node.js 20 atau lebih baru** — cek dengan `node -v`
- Backend buat di-proxy (HTTP service apa pun; buat coba-coba,
  `python3 -m http.server 3000` juga oke)

Cuma itu.

## Install

```bash
npm install -g typescript-gateway
```

Atau langsung dari GitHub selagi nama npm-nya belum fix:

```bash
npm install -g github:wicahma/typescript-gateway
```

## Bikin gateway pertamamu

```bash
mkdir my-gateway && cd my-gateway
tsgate init
```

`init` akan membuat tiga hal:

```
my-gateway/
├── package.json
├── gateway.config.json   ← routes, upstreams, plugins
└── plugins/
    └── hello.ts          ← an example plugin
```

Buka `gateway.config.json` — bagian pentingnya kecil banget:

```json
{
  "server": { "port": 8088 },
  "routes": [{ "method": "GET", "path": "/api/*" }],
  "upstreams": [{ "id": "backend", "host": "localhost", "port": 3000 }]
}
```

Bacanya gini: *"request ke `GET /api/**` diteruskan ke service di
`localhost:3000`"*. Sisanya sudah pakai default yang masuk akal.

## Jalankan

Jalankan backend sekali pakai dulu biar kelihatan traffic-nya mengalir:

```bash
python3 -m http.server 3000 &
```

Terus nyalakan gateway-nya:

```bash
tsgate start
```

Kamu bakal lihat `Gateway started` di port 8088. Coba:

```bash
curl http://localhost:8088/health
curl http://localhost:8088/api/test
```

Request kedua di-proxy ke backend kamu — dan response-nya membawa header
`x-hello: from tsgate plugin`. Header itu datang dari
`plugins/hello.ts`, plugin contoh yang dibuat oleh `init`. Kamu baru saja
menjalankan gateway dengan plugin yang berfungsi tanpa nulis kode sama sekali.

## Plugin pertamamu

Buka `plugins/hello.ts`:

```ts
import type { Plugin } from 'typescript-gateway';

const plugin: Plugin = {
  name: 'hello',
  version: '1.0.0',
  description: 'Adds a response header',

  async postHandler(ctx) {
    ctx.state['pluginHeaders'] = { 'x-hello': 'from tsgate plugin' };
  },
};

export default plugin;
```

Setiap file `.ts` di `plugins/` dimuat saat startup. Hooks yang tersedia:
`preRoute`, `preHandler` (sebelum panggilan upstream), `postHandler`,
`postResponse` (sesudahnya), `onError`, plus `init` dan `destroy` buat setup dan
teardown. Buat mengubah response header, taruh di `ctx.state.pluginHeaders` —
nanti digabungkan ke response akhir.

> **Catatan:** set header langsung di `ctx.res` dalam `postHandler` nggak akan
> bertahan — proxy menulis header upstream setelah hook kamu jalan. Pakai
> `ctx.state.pluginHeaders` saja.

## Cek konfigurasi tanpa menyalakan

```bash
tsgate validate
```

Mencetak `OK: ... (N routes, M upstreams)` atau memberi tahu persis apa yang salah.

## Lanjut ke mana

- **Resep** — setup dunia nyata: auth, rate limiting, caching, load
  balancing. Lihat [Usage Guide](/docs/usage).
- **Konfigurasi** — semua opsi di `gateway.config.json`, dijelaskan. Lihat
  [Configuration](/docs/configuration).
- **Cara kerjanya** — siklus hidup request, dari socket ke upstream dan balik
  lagi. Lihat [Architecture](/docs/architecture).
- **Bahasan mendalam** — bagian Reference di sidebar mendokumentasikan tiap
  subsistem secara lengkap.

## Embed di aplikasimu sendiri

CLI-nya opsional. Gateway ini juga bisa dipakai sebagai library:

```ts
import { Gateway } from 'typescript-gateway';

const gateway = new Gateway('./gateway.config.json');
await gateway.start();
```
