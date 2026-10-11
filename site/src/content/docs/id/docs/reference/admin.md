---
title: "Control Plane Admin (Admin Control Plane)"
description: "Endpoint manajemen administratif, inspeksi status, dan penghapusan cache runtime."
---

Modul admin menampung endpoint manajemen operasional yang dipasang pada jalur administratif khusus. Modul ini menyediakan endpoint untuk memeriksa status pemutus sirkuit (circuit breaker), menanyakan rute aktif, melaporkan penggunaan memori, dan mengeksekusi pembersihan cache. Control plane administratif diisolasi dari trafik publik dan dilindungi oleh aturan autentikasi khusus.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `AdminDeps` | interface | `interface AdminDeps` | Interface export for AdminDeps. |
| `AdminConfig` | interface | `interface AdminConfig` | Interface export for AdminConfig. |
| `AdminControlPlane` | class | `class AdminControlPlane` | Class export for AdminControlPlane. |

## Catatan (Notes)

### AdminControlPlane
Memasang endpoint internal (`/__admin/state`, `POST /__admin/cache/purge`) dengan perlindungan autentikasi.

## Sumber (Source)

- `src/admin/control-plane.ts`

## Lihat juga (See also)

- [Pendalaman: Operasional](/id/docs/deep-dive/operations/)
