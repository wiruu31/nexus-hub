# Nexus Hub v1.0.0

Backend API pribadi yang dipakai semua project Geris. Satu server, satu API key per project, banyak modul fitur. Project lain (web, bot, aplikasi) cukup memanggil URL Nexus dengan key-nya.

Nexus punya tiga bagian kerja:

- **Gudang**: database SQLite untuk key, status modul, dan log.
- **Satpam**: setiap panggilan ke `/v1` dicek key-nya, akses modulnya, dan batas request per menit.
- **Modul**: satu fitur per folder, bisa dinyalakan atau dimatikan dari dashboard.

## Isi versi 1.0.0

- Core: autentikasi API key (disimpan sebagai hash), rate limit per key, logger ke database, dokumentasi Swagger otomatis di `/docs`.
- Modul Notifier: kirim pesan ke Telegram lewat `POST /v1/notify`.
- Dashboard admin: Beranda, API Keys, Modul, Log. Tampil di alamat server yang sama.

## Struktur folder

```
nexus/
├── src/
│   ├── core/
│   │   ├── auth.js         Pembuatan, hash, dan verifikasi API key
│   │   ├── config.js       Membaca .env dan memeriksa isinya
│   │   ├── database.js     Membuka SQLite dan membuat tabel
│   │   ├── errors.js       Bentuk error yang seragam
│   │   ├── gate.js         Satpam: cek key, akses modul, rate limit
│   │   ├── logger.js       Menulis dan membaca log
│   │   ├── modules.js      Memuat folder modul dan status nyala/mati
│   │   └── ratelimit.js    Penghitung request per menit
│   ├── modules/
│   │   └── notifier/
│   │       └── index.js    Modul Telegram
│   ├── app.js              Merakit server, rute admin, dan rute modul
│   └── server.js           Pintu masuk: npm start menjalankan file ini
├── dashboard/              Panel admin (HTML, CSS, JS biasa tanpa build)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── favicon.svg
├── test/                   Tes otomatis
├── .env.example            Contoh pengaturan
├── .gitignore
├── package.json
└── README.md
```

## Syarat

- Node.js 22.13 atau lebih baru. Nexus memakai `node:sqlite` bawaan Node, jadi tidak ada paket native yang perlu dikompilasi.
- Cek versimu dengan `node --version`.

## Pasang dan jalankan

1. Masuk ke folder project lalu pasang paket:

   ```
   npm install
   ```

2. Salin contoh pengaturan:

   ```
   cp .env.example .env
   ```

3. Buat token admin acak, lalu tempel sebagai nilai `ADMIN_TOKEN` di `.env`:

   ```
   npm run token
   ```

4. Jalankan:

   ```
   npm start
   ```

5. Buka `http://localhost:3000`, masuk dengan token admin tadi.

Nexus menolak start dan menjelaskan alasannya kalau `ADMIN_TOKEN` kosong atau kurang dari 16 karakter.

## Memakai dashboard

- **Beranda**: ringkasan key aktif, modul menyala, jumlah request dan error 24 jam terakhir, plus contoh perintah `curl`.
- **API Keys**: buat key untuk satu project. Key lengkap hanya tampil sekali sesudah dibuat. Server hanya menyimpan hash-nya, jadi key yang hilang tidak bisa dilihat lagi, hanya diganti. Di sini kamu juga bisa menonaktifkan sementara atau menghapus key.
- **Modul**: nyalakan atau matikan modul. Panggilan ke modul yang mati ditolak dengan kode 503.
- **Log**: panggilan ke `/v1` dan percobaan masuk admin yang ditolak, bisa disaring per level.

Token admin disimpan di tab browser saja dan hilang saat tab ditutup.

## Memanggil API dari project lain

Kirim key di header `x-api-key`. Header `Authorization: Bearer <key>` juga diterima.

```
curl -X POST http://localhost:3000/v1/notify \
  -H "x-api-key: nxs_KEY_KAMU" \
  -H "content-type: application/json" \
  -d '{"title":"Deploy","message":"Versi baru sudah naik"}'
```

JavaScript:

```js
await fetch('https://hub.contoh.com/v1/notify', {
  method: 'POST',
  headers: { 'x-api-key': process.env.NEXUS_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Deploy', message: 'Versi baru sudah naik' }),
});
```

Python:

```python
import os, requests

requests.post(
    "https://hub.contoh.com/v1/notify",
    headers={"x-api-key": os.environ["NEXUS_KEY"]},
    json={"title": "Deploy", "message": "Versi baru sudah naik"},
    timeout=10,
)
```

Simpan key di environment variable server atau bot, jangan di kode yang dikirim ke browser pengunjung.

### Bentuk error

Semua error berbentuk sama. `hint` berisi langkah berikutnya.

```json
{ "error": "rate_limited", "message": "Batas 60 request per menit untuk key ini sudah tercapai.", "hint": "Coba lagi dalam 23 detik." }
```

| Status | `error` | Artinya |
|---|---|---|
| 400 | `invalid_request` | Isi permintaan tidak sesuai aturan |
| 401 | `api_key_missing`, `api_key_invalid` | Key tidak dikirim atau tidak dikenal |
| 403 | `api_key_disabled`, `scope_denied` | Key dinonaktifkan, atau tidak boleh memakai modul itu |
| 429 | `rate_limited` | Batas request per menit tercapai. Lihat header `retry-after` |
| 502 | `telegram_rejected`, `telegram_unreachable` | Telegram menolak pesan atau tidak terjangkau |
| 503 | `module_disabled`, `notifier_not_configured` | Modul dimatikan, atau belum diatur di `.env` |

Setiap jawaban dari `/v1` yang lolos membawa header `x-ratelimit-limit`, `x-ratelimit-remaining`, dan `x-ratelimit-reset`.

## Daftar rute

Dokumentasi lengkap dengan contoh ada di `/docs` (Swagger).

| Rute | Header | Fungsi |
|---|---|---|
| `GET /health` | tanpa | Cek server hidup |
| `POST /v1/notify` | `x-api-key` | Kirim pesan ke Telegram. Isi: `message` (wajib, maks 3800 karakter), `title` (opsional) |
| `GET /v1/notify/status` | `x-api-key` | Cek Telegram sudah tersambung |
| `GET /admin/summary` | `x-admin-token` | Ringkasan hub |
| `GET /admin/keys` | `x-admin-token` | Daftar key |
| `POST /admin/keys` | `x-admin-token` | Buat key. Isi: `name`, `scopes` (daftar id modul atau `["*"]`), `rate_limit` |
| `PATCH /admin/keys/:id` | `x-admin-token` | Ubah `name`, `scopes`, `rate_limit`, atau `active` |
| `DELETE /admin/keys/:id` | `x-admin-token` | Hapus key permanen |
| `GET /admin/modules` | `x-admin-token` | Daftar modul dan statusnya |
| `PATCH /admin/modules/:id` | `x-admin-token` | Nyalakan atau matikan modul. Isi: `enabled` |
| `GET /admin/logs` | `x-admin-token` | Log. Parameter: `level`, `limit`, `before` |

## Pengaturan `.env`

| Variabel | Bawaan | Fungsi |
|---|---|---|
| `ADMIN_TOKEN` | wajib | Token masuk dashboard dan rute `/admin`. Minimal 16 karakter |
| `HOST` | `0.0.0.0` | Alamat yang didengarkan server |
| `PORT` | `3000` | Port server |
| `DB_PATH` | `data/nexus.db` | Lokasi file database |
| `DEFAULT_RATE_LIMIT` | `60` | Batas request per menit untuk key yang tidak menentukan sendiri |
| `LOG_KEEP_DAYS` | `30` | Log lebih tua dari ini dihapus otomatis |
| `TRUST_PROXY` | `false` | Isi `true` kalau Nexus di belakang Nginx, Caddy, atau Cloudflare |
| `CORS_ORIGINS` | kosong | Asal web yang boleh memanggil `/v1` dari browser, pisahkan dengan koma |
| `TELEGRAM_BOT_TOKEN` | kosong | Token bot dari @BotFather |
| `TELEGRAM_CHAT_ID` | kosong | Chat tujuan notifikasi |

Variabel yang sudah diset di hosting menang atas isi `.env`.

## Menyambungkan Telegram

1. Buka @BotFather di Telegram, kirim `/newbot`, ikuti langkahnya, lalu salin token bot ke `TELEGRAM_BOT_TOKEN`.
2. Kirim satu pesan apa saja ke bot barumu.
3. Buka `https://api.telegram.org/bot<TOKEN_BOT>/getUpdates` di browser. Cari `"chat":{"id":...}` dan salin angkanya ke `TELEGRAM_CHAT_ID`.
4. Restart Nexus. Halaman Modul akan menandai Notifier sebagai siap dipakai.

Halaman Modul menyebut variabel mana yang masih kosong kalau Telegram belum tersambung.

## Menambah modul baru

Satu modul adalah satu folder di `src/modules/` dengan file `index.js`. Nexus memuat semua folder di sana saat start, kecuali yang namanya berawalan `_` atau `.` (pakai itu untuk modul yang belum jadi).

```js
// src/modules/catatan/index.js
export default {
  id: 'catatan',                 // dipakai di scopes key dan di tabel status
  path: 'notes',                 // alamatnya jadi /v1/notes
  name: 'Catatan',
  description: 'Simpan dan baca catatan singkat.',
  version: '1.0.0',

  // Opsional. Dashboard menampilkan catatan ini di halaman Modul.
  status(ctx) {
    return { ready: true, note: '' };
  },

  // app adalah Fastify yang sudah memakai prefix /v1/notes.
  // ctx berisi config dan fetch.
  async routes(app, ctx) {
    app.get('/', async () => ({ notes: [] }));
  },
};
```

Cek key, akses modul, status nyala, dan rate limit sudah ditangani Nexus sebelum rute modulmu dipanggil. Lempar `HttpError` dari `src/core/errors.js` untuk error dengan bentuk yang seragam. Restart Nexus, lalu modul muncul di halaman Modul. Key lama dengan akses "Semua modul" langsung boleh memakainya; key yang dibatasi perlu dibuat ulang atau diubah lewat `PATCH /admin/keys/:id`.

## Keamanan

- Pasang HTTPS di depan Nexus (Caddy atau Nginx) sebelum dipakai dari internet. Tanpa itu key dan token lewat jaringan sebagai teks biasa.
- Jangan commit `.env`. File `.gitignore` sudah mengecualikannya, juga folder `data/`.
- Token admin yang salah dibatasi 10 kali per menit per alamat IP. Isi `TRUST_PROXY=true` kalau di belakang proxy supaya IP-nya terbaca benar.
- `CORS_ORIGINS` hanya mengizinkan metode GET dan POST dari asal yang kamu daftarkan, dan rute `/admin` tetap butuh token. Kosongkan kalau tidak ada web yang perlu memanggil dari browser.
- Halaman `/docs` terbuka untuk siapa pun yang bisa menjangkau servermu. Isinya daftar rute, bukan data.

## Menjalankan di server sendiri

- Simpan folder `data/` di penyimpanan yang tidak terhapus saat deploy ulang, atau arahkan `DB_PATH` ke sana. Cadangkan file `nexus.db` beserta `nexus.db-wal` dan `nexus.db-shm` kalau ada.
- Satu proses saja. Rate limit disimpan di memori proses.
- Untuk menjaga tetap hidup, pakai `pm2`, `systemd`, atau fitur restart dari hostingmu.

## Tes

```
npm test
```

Tes mencakup key, rate limit, log, modul, satpam, konfigurasi, dan Notifier dengan Telegram tiruan. Tes `test/app.test.js` menjalankan server utuh dan hanya aktif kalau `npm install` sudah dijalankan.

## Batas versi 1.0.0

- Hitungan rate limit kembali nol saat Nexus restart, dan tidak dibagi antar proses.
- Akses modul sebuah key hanya bisa diubah lewat API (`PATCH /admin/keys/:id`), belum lewat dashboard.
- Dashboard untuk satu admin dengan satu token. Belum ada akun atau peran.
- Notifier baru mendukung Telegram, dengan teks biasa tanpa format.
- Log tidak bisa dihapus manual dari dashboard, hanya otomatis lewat `LOG_KEEP_DAYS`.
- `node:sqlite` masih berstatus eksperimental di Node 22. Skrip `npm start` menyembunyikan peringatannya. Kalau API-nya berubah di versi Node berikutnya, bagian yang perlu disesuaikan hanya `src/core/database.js` dan pemanggilan `prepare` di core.

## Riwayat versi

- **1.0.0**: rilis pertama. Core (key, rate limit, log, modul), modul Notifier, dashboard admin.
