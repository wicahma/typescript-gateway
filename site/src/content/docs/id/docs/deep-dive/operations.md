---
title: "Operasional & Konfigurasi"
description: "Pemuatan dan validasi konfigurasi tanpa dependensi, rantai eksekusi plugin, auto-tuning."
---

Setiap fitur di grup ini sudah **terimplementasi dan terverifikasi**, masing-masing dengan cakupan unit dan integration test di test suite repo.

## Apa yang Dilakukannya (What it does)

Operasional dan konfigurasi mencakup inisialisasi awal saat start, interpolasi variabel lingkungan, validasi skema konfigurasi, eksekusi siklus hidup plugin, dan auto-tuning performa runtime.

### Auto Tuner

Auto-Tuner memantau pola beban kerja gateway (RPS, latensi, utilisasi CPU, jumlah koneksi aktif) sepanjang jendela observasi untuk merekomendasikan atau menerapkan penyesuaian parameter:
- **Parameter yang Disesuaikan**: Ukuran pool koneksi, jumlah thread worker, alokasi buffer memori, dan batas waktu (timeout).
- **Mode Operasi**: Secara bawaan menggunakan `safeMode: true` (hanya rekomendasi penasehat). Saat safe mode dimatikan, parameter disesuaikan langsung di memori.

### Config Loader and Validator

Menyediakan pemuatan dan validasi file konfigurasi tanpa dependensi pihak ketiga, hanya menggunakan library standar Node.js:
- **Jaminan Struktur**: Menegakkan struktur objek root, format versi semantik (`^\d+\.\d+\.\d+$`), dan nama lingkungan yang valid (`development`, `staging`, `production`).
- **Interpolasi Variabel Lingkungan**: Menggantikan sintaks `${ENV_VAR}` dan nilai cadangan `${ENV_VAR:defaultValue}` secara rekursif pada semua nilai string sebelum validasi skema.
- **Migrasi Versi**: Menerapkan migrasi skema yang kompatibel ke belakang secara otomatis antar versi konfigurasi.

### Plugin Execution Chain

Mekanisme ekstensi gateway yang menyediakan pencegat modular tanpa memodifikasi kode inti pipeline:
- **Tahapan Siklus Hidup**: `preRoute` (rate limiting, auth awal), `preHandler` (pengayaan header), `postHandler` (audit respons), dan `onError` (penanganan eror khusus).
- **Jaminan Eksekusi**: Plugin berjalan dalam urutan deterministik berdasarkan prioritas. Plugin yang mengembalikan respons akan langsung memotong rantai eksekusi (short-circuit).
- **Isolasi Batas Waktu**: Eksekusi plugin dibatasi oleh timer batas waktu untuk mencegah plugin pihak ketiga menggantung request klien.

## Konfigurasi (Configuration)

Perilaku operasional dikendalikan melalui `gateway.config.json` dan opsi loader:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `version` | string | `"1.0.0"` | Pola versi skema konfigurasi `^\d+\.\d+\.\d+$`. |
| `environment` | string | `"production"` | Nama lingkungan runtime (`development`, `staging`, `production`). |
| `server.port` | number | `3000` | Port tempat gateway menerima request (1 hingga 65535). |
| `server.host` | string | `"0.0.0.0"` | Alamat antarmuka jaringan yang diikat server. |
| `plugins[].name` | string | — | Pengenal unik dari plugin yang terdaftar. |
| `plugins[].enabled` | boolean | `true` | Mengaktifkan eksekusi plugin ini di dalam pipeline. |
| `plugins[].priority` | number | `0` | Urutan prioritas eksekusi (nilai lebih tinggi berjalan duluan). |
| `performance.autoTuning.enabled` | boolean | `false` | Mengaktifkan observasi dan penyesuaian performa berkala. |
| `performance.autoTuning.safeMode` | boolean | `true` | Membatasi auto-tuner hanya memberikan rekomendasi teks. |
| `performance.autoTuning.windowMs` | number | `300000` | Durasi jendela observasi dalam milidetik (5 menit). |

## Interaksi Pipeline (Interactions)

Operasional dan plugin berkoordinasi saat booting dan pemrosesan request:

1. **Bootstrapping**: `ConfigLoader.load()` membaca file konfigurasi, menginterpolasi variabel lingkungan, memvalidasi tipe data dan rentang nilai, lalu menginisialisasi server.
2. **Pendaftaran Plugin**: Plugin yang aktif didaftarkan ke `PluginManager`, diverifikasi keunikan namanya, dan diurutkan berdasarkan prioritas.
3. **Dispatch Inbound**: `Server` menjalankan rantai plugin `preRoute`. Jika sebuah plugin memancarkan `Response`, alur memotong jalur dan melewati handler berikutnya.
4. **Dispatch Outbound**: Setelah pemrosesan upstream selesai, plugin `postHandler` memeriksa atau memodifikasi respons keluar.
5. **Telemetri Berkala**: Auto-Tuner mengambil sampel dari `MetricsCollector` setiap jendela observasi untuk mengevaluasi saturasi koneksi dan pergeseran latensi.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

- **Rekomendasi vs Penyesuaian Otomatis**: Menjalankan `safeMode: true` mencegah perubahan otomatis yang berpotensi mendestabilkan produksi, mengharuskan operator meninjau saran terlebih dahulu. Mode otonom menyesuaikan parameter di memori tetapi tidak menulis ulang file `gateway.config.json` di disk.
- **Validasi Fail-Fast Saat Boot**: Jika ada properti konfigurasi yang salah, hilang, atau merujuk ke variabel lingkungan wajib yang kosong, loader melempar kumpulan eror dan langsung menghentikan proses booting. Ini mencegah gateway berjalan dengan konfigurasi parsial yang tidak aman.
- **Batas Waktu Eksekusi Plugin**: Jika plugin kustom mengalami kebuntuan atau lambat, manajer batas waktu membatalkan eksekusi plugin tersebut dengan eror, mencegah pemborosan anggaran waktu request klien.
- **Batasan Hot-Reload**: Meskipun tabel rute dan upstream mendukung pendaftaran runtime dinamis, atribut soket dasar server (seperti port atau worker thread) membutuhkan restart proses penuh untuk diterapkan.
