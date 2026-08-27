# Migrasi WhatsApp: Baileys → Meta Cloud API Resmi

Dokumen ini adalah **spesifikasi kerja**. Bagian A dikerjakan oleh coding agent.
Bagian B dikerjakan manusia di dashboard Meta. Bagian C adalah urutan go-live.

Kode dan setup **dipisah total**: setelah Bagian A selesai, program bisa jalan
seperti biasa memakai Baileys. Cloud API baru aktif ketika `WA_PROVIDER=cloud`
diisi di environment. Rollback = kembalikan env var ke `baileys`.

---

## Prinsip yang tidak boleh dilanggar

1. **Jangan sentuh controller.** `formController`, `birthdayController`,
   `adminController` memanggil `require('../config/whatsapp')` dan tidak boleh
   berubah sama sekali. Pergantian provider terjadi di balik modul itu.
2. **Jangan hapus kode Baileys.** `wa-bridge/` dan adapter Baileys tetap ada
   sebagai jalur rollback.
3. **Jangan ubah skema database.** Sudah kompatibel — lihat catatan di bawah.
4. **Default tetap Baileys.** Tanpa `WA_PROVIDER=cloud`, perilaku program harus
   identik dengan sebelum migrasi. Ini syarat penerimaan mutlak.

### Yang sudah siap dan tidak perlu dibuat lagi

Tabel `whatsapp_logs` di `database.sql` sudah dirancang untuk Cloud API:
sudah punya kolom `template_name`, `template_language`, `template_components`,
`wa_message_id`, `status`, `error_code`, `api_response`, `delivered_at`, `read_at`.

Tabel `customers` sudah punya `last_incoming_message_at` **beserta indeksnya** —
ini yang dipakai untuk menentukan jendela 24 jam. Tidak perlu tabel baru.

Path `/api/webhook/*` sudah dikecualikan dari CSRF di
`backend/config/csrfMiddleware.js:97`. Tidak perlu diubah.

---

# BAGIAN A — Dikerjakan coding agent

## Task 1 — Pecah adapter jadi dua, tambahkan pemilih provider

**Tujuan:** `require('../config/whatsapp')` mengembalikan adapter Baileys atau
adapter Cloud API tergantung env, tanpa satu pun controller berubah.

Langkah:

1. `git mv backend/config/whatsapp.js backend/config/whatsapp-baileys.js`
   (isinya tidak diubah sama sekali di task ini).
2. Buat `backend/config/whatsapp.js` baru berisi **hanya** pemilih:

```js
// Pemilih provider WhatsApp. Controller cukup require('./whatsapp') dan tidak
// perlu tahu transport-nya apa. WA_PROVIDER=cloud → Meta Cloud API resmi.
// Nilai lain / kosong → Baileys (default, perilaku lama).
const provider = (process.env.WA_PROVIDER || 'baileys').toLowerCase();
module.exports = provider === 'cloud'
    ? require('./whatsapp-cloud')
    : require('./whatsapp-baileys');
```

3. `backend/config/wa-worker.js` meng-import `spinText` yang dipakai balik oleh
   `whatsapp-baileys.js` (`require('./wa-worker')` di dalam `enqueueAutoReply`).
   Pastikan circular require ini tetap bekerja setelah rename. Jalankan
   `node --check` pada ketiga file dan pastikan server masih bisa start.

**Syarat penerimaan:** tanpa `WA_PROVIDER`, aplikasi berjalan persis seperti
sebelumnya — kirim, antre, broadcast, ulang tahun, panel admin, semua sama.

---

## Task 2 — Hapus pemanggilan `_bridgeCall` dari worker

**Masalah:** `backend/config/wa-worker.js` memanggil
`whatsappService._bridgeCall('POST', '/api/send', ...)` langsung saat mengirim
auto-reply antre dan broadcast. Method itu khusus Baileys dan tidak akan ada di
adapter Cloud API.

Langkah:

1. Tambahkan method publik baru di `whatsapp-baileys.js`:

```js
// Kirim untuk baris whatsapp_logs yang SUDAH ada (dipakai worker saat
// menguras antrean). Berbeda dari sendText yang membuat baris log baru.
// Return: { success, wa_message_id, error, error_code, retryable }
async sendForExistingLog(phone, message, { typing = true, category = 'text' } = {}) { ... }
```

   Isinya: bungkus `_bridgeCall('POST', '/api/send', ...)` dengan penanganan
   error yang sama seperti di `sendText` (klasifikasi `retryable`, deteksi
   `NOT_ON_WHATSAPP`), **tapi tanpa** `_insertLog` / `_updateLog` — pemanggil
   yang mengurus barisnya.

2. Ganti semua pemanggilan `whatsappService._bridgeCall('POST', '/api/send', …)`
   di `wa-worker.js` menjadi `whatsappService.sendForExistingLog(…)`.
   Perilaku dan logging di worker harus tetap sama.

3. `whatsappService._incrementDailyCounter(...)` juga dipanggil worker — biarkan,
   tapi pastikan adapter Cloud API nanti mengekspornya juga (Task 3).

**Syarat penerimaan:** tidak ada lagi kemunculan `_bridgeCall` di luar
`whatsapp-baileys.js`. Verifikasi: `grep -rn "_bridgeCall" backend/ wa-bridge/`

---

## Task 3 — Buat adapter Cloud API

Buat `backend/config/whatsapp-cloud.js`. **Permukaan publiknya harus identik**
dengan `whatsapp-baileys.js`. Daftar wajib:

| Method | Perilaku di Cloud API |
|---|---|
| `sendText(phone, message, {category, skipOptCheck})` | Lihat "Logika jendela 24 jam" |
| `sendForExistingLog(phone, message, {category})` | Sama, tanpa buat baris log |
| `sendMessage(phone, message)` | Delegasi ke `sendText` |
| `sendBroadcastMessage(phone, message)` | `sendText` dengan `category: 'broadcast'` |
| `sendBirthdayGreeting(customer, customMessage)` | `sendText` dengan `category: 'birthday'` |
| `enqueueAutoReply(customer, opts)` | **Salin apa adanya** dari versi Baileys — cuma INSERT ke `whatsapp_logs`, tidak menyentuh transport |
| `isNumberRegistered(phone)` | Cloud API tidak punya cek ini. Return `{ registered: true, unchecked: true }` |
| `getStatus()` | Lihat Task 6 |
| `isConfigured()` | `true` kalau `META_PHONE_NUMBER_ID` dan `META_ACCESS_TOKEN` terisi |
| `restartBridge()` / `disconnectBridge()` | No-op, return `{ success: true, noop: true }` |
| `getDailyStats()`, `getStats()`, `setDailyLimit()`, `setAutoReplyMessage()`, `loadSettings()`, `updateMessageStatus()`, `_insertLog()`, `_updateLog()`, `_updateLogFailed()`, `_isOptedOut()`, `_incrementDailyCounter()`, `_getAutoReplyTemplate()` | **Salin apa adanya** dari versi Baileys — semuanya murni operasi database |

Cara paling aman: `class WhatsAppCloudService extends require('./whatsapp-baileys').constructor`
sulit karena Baileys mengekspor instance. Lebih baik **pindahkan method-method
database murni ke `backend/config/wa-log-store.js`** dan pakai di kedua adapter,
supaya tidak ada duplikasi. Kalau itu terlalu invasif, salin dan beri komentar
`// DUPLIKAT dari whatsapp-baileys.js — ubah keduanya kalau berubah`.

### Pemanggilan HTTP ke Meta

```
POST https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages
Headers: Authorization: Bearer ${META_ACCESS_TOKEN}
         Content-Type: application/json
```

Pesan bebas (di dalam jendela 24 jam — **gratis**):

```json
{ "messaging_product": "whatsapp", "to": "628xxxxxxxxxx",
  "type": "text", "text": { "body": "isi pesan" } }
```

Pesan template (di luar jendela — **berbayar**):

```json
{ "messaging_product": "whatsapp", "to": "628xxxxxxxxxx", "type": "template",
  "template": { "name": "konfirmasi_data_masuk", "language": { "code": "id" },
    "components": [ { "type": "body",
      "parameters": [ { "type": "text", "text": "Budi" } ] } ] } }
```

Sukses → `{ "messages": [ { "id": "wamid.XXX" } ] }`. Simpan `id` itu ke
`whatsapp_logs.wa_message_id`. Gagal → `{ "error": { "message", "code", "error_subcode", "fbtrace_id" } }`.

### Klasifikasi error (ganti `_isRetryable`)

| Kondisi | retryable |
|---|---|
| HTTP 5xx, timeout, ECONNRESET | ya |
| `code: 130429` (rate limit), `131056` (pair rate limit) | ya |
| `code: 131047` (di luar jendela, butuh template) | **tidak** — perbaiki logikanya, bukan diulang |
| `code: 131026` (tidak bisa dikirim / bukan nomor WA) | tidak |
| `code: 132xxx` (template tidak ada / parameter tidak cocok / belum approve) | tidak |
| `code: 190` (token kedaluwarsa) | tidak — log `ERROR` mencolok, ini butuh tindakan manusia |

Simpan `code` Meta ke `whatsapp_logs.error_code` dan seluruh objek error ke
`api_response`.

### Logika jendela 24 jam

Ini yang menentukan biaya, jadi harus tepat.

```
window_open = customers.last_incoming_message_at IS NOT NULL
              AND last_incoming_message_at > NOW() - INTERVAL '24 hours'
```

- `window_open == true` → kirim **pesan teks bebas**. Gratis. Isi pesan dipakai apa adanya.
- `window_open == false` → kirim **template** sesuai `category`, dengan pemetaan
  di Task 4. Berbayar.

Kalau `category` tidak punya template terdaftar dan jendela tertutup, **jangan
kirim**. Tandai log `FAILED` dengan `error_code = 'NO_TEMPLATE'` dan
`retryable = false`. Jangan pernah diam-diam mengirim teks bebas di luar jendela —
Meta akan menolak dengan 131047 dan itu memboroskan percobaan.

### Yang harus dimatikan saat provider = cloud

- `variasiPesan()` dan `spinText()` **tidak boleh** dipakai untuk pesan template.
  Isi template sudah tetap; menambah karakter acak membuatnya tidak cocok dengan
  template terdaftar dan ditolak Meta. Untuk pesan bebas di dalam jendela,
  variasi juga tidak perlu — tidak ada risiko fingerprint di API resmi.

---

## Task 4 — Daftar template

Buat `backend/config/wa-templates.js`:

```js
// Pemetaan kategori internal → template terdaftar di Meta.
// Nama dan jumlah parameter HARUS sama persis dengan yang disetujui Meta,
// kalau tidak Meta menolak dengan error 132000/132001.
module.exports = {
    auto_reply: {
        name: 'konfirmasi_data_masuk',
        language: 'id',
        category: 'UTILITY',
        params: c => [c.nama_lengkap || 'Kak']
    },
    birthday: {
        name: 'ucapan_ulang_tahun',
        language: 'id',
        category: 'MARKETING',
        params: c => [c.nama_lengkap || 'Kak']
    },
    broadcast: {
        name: 'promo_umum',
        language: 'id',
        category: 'MARKETING',
        params: c => [c.nama_lengkap || 'Kak', c.isi_promo || '']
    }
};
```

Isi template yang harus didaftarkan manusia ada di Bagian B langkah 6.

---

## Task 5 — Webhook Meta

Cloud API memakai bentuk webhook yang berbeda dari wa-bridge, jadi ini
**endpoint baru**, bukan mengubah `/api/webhook/whatsapp` yang sudah ada.

1. **Tangkap raw body untuk verifikasi tanda tangan.** Di `backend/server.js:95`,
   ubah `app.use(express.json({ limit: '50kb' }))` menjadi:

```js
app.use(express.json({
    limit: '50kb',
    verify: (req, _res, buf) => { req.rawBody = buf; }
}));
```

2. Tambahkan dua route di `backend/routes/api.js`, di dekat route webhook yang ada:

```js
router.get('/webhook/meta', webhookController.verifyMetaWebhook);
router.post('/webhook/meta', webhookLimiter, webhookController.handleMetaWebhook);
```

3. Di `backend/controllers/webhookController.js`:

**`verifyMetaWebhook`** — dipanggil Meta sekali saat mendaftarkan webhook:

```
GET /api/webhook/meta?hub.mode=subscribe&hub.verify_token=XXX&hub.challenge=123
```
Kalau `hub.verify_token === process.env.META_VERIFY_TOKEN`, balas **200 dengan
`hub.challenge` sebagai teks polos** (bukan JSON). Kalau tidak, balas 403.

**`handleMetaWebhook`** —
- Verifikasi header `X-Hub-Signature-256`. Nilainya `sha256=<hex>` di mana hex =
  HMAC-SHA256 dari `req.rawBody` memakai `META_APP_SECRET`. Bandingkan dengan
  `safeEqual` dari `csrfMiddleware.js`. Tidak cocok → 401, jangan diproses.
- **Balas 200 secepatnya**, proses isinya setelah itu. Meta akan mengirim ulang
  dan akhirnya menonaktifkan webhook kalau respons lambat.
- Bentuk payload: `body.entry[].changes[].value` berisi:
  - `.messages[]` — chat masuk. Petakan ke pemanggilan
    `exports.handleIncomingMessage({ sender: m.from, message: m.text?.body,
    pushname: value.contacts?.[0]?.profile?.name, wa_message_id: m.id })`.
    **Pakai ulang fungsi yang sudah ada** — semua logika customer, opt-out,
    Google Contacts, dan ignore-list sudah benar di sana dan tidak boleh
    diduplikasi. Hanya tangani `m.type === 'text'`; tipe lain diabaikan.
  - `.statuses[]` — status kiriman. Petakan lalu panggil
    `whatsappService.updateMessageStatus(s.id, ack)` dengan:
    `sent → 2`, `delivered → 3`, `read → 4`, `failed → 0`.
    Ini memakai skala ack Baileys yang sudah dipahami `updateMessageStatus`,
    jadi dashboard tidak perlu diubah.
    Untuk `failed`, simpan juga `s.errors[0].code` ke `whatsapp_logs.error_code`.

**Syarat penerimaan:** POST tanpa signature yang benar ditolak 401. GET dengan
verify token benar mengembalikan challenge apa adanya.

---

## Task 6 — `getStatus()` dan panel admin

Panel WhatsApp di admin sekarang menampilkan QR dan tombol connect/disconnect.
Dengan Cloud API tidak ada QR — nomor selalu tersambung.

`getStatus()` di adapter Cloud API harus mengembalikan bentuk yang **sama**
seperti versi Baileys (supaya `admin/admin.js` tidak rusak), diisi dari:

```
GET https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}
    ?fields=display_phone_number,verified_name,quality_rating
Headers: Authorization: Bearer ${META_ACCESS_TOKEN}
```

Pemetaan: `status: 'connected'`, `info.phone` = `display_phone_number` tanpa
non-digit, dan tambahkan field baru `quality_rating` serta `provider: 'cloud'`.
Cache hasilnya minimal 5 menit — jangan panggil Graph API tiap polling dashboard.

Di `admin/admin.js`, saat `status.provider === 'cloud'`:
- Sembunyikan blok QR, tombol "Scan Ulang", dan "Disconnect".
- Tampilkan: nomor, nama terverifikasi, dan quality rating dengan warna
  (GREEN/YELLOW/RED). Quality rating turun = peringatan dini sebelum Meta
  menurunkan limit; ini pengganti fungsi panel QR.

---

## Task 7 — Sesuaikan pacing worker

Delay 4:30–6:00 per pesan, break, warm-up, dan jam kerja di `wa-worker.js` ada
untuk menghindari deteksi Baileys. Di API resmi semuanya tidak relevan dan hanya
memperlambat.

Di `CONFIG` `wa-worker.js`, buat nilainya bergantung provider. Saat
`WA_PROVIDER=cloud`:

- Delay antar pesan semua kategori: **2–5 detik**.
- Break berkala: **dimatikan**.
- Warm-up harian dan `_getWarmupCap()`: **dimatikan**.
- Jam kerja 08:00–22:00 WITA: **tetap dipertahankan** — ini soal sopan santun ke
  customer, bukan anti-ban. Jangan kirim ucapan ulang tahun jam 3 pagi.
- Daily limit: tetap dipakai sebagai **rem biaya**, bukan rem ban. Beri label
  ulang di UI admin jadi "Batas pesan harian (kontrol biaya)".
- Retry: pertahankan gerbang yang ada (limit harian, jendela settle, opt-out),
  tapi jeda boleh turun ke 30–60 detik.

Semua ini harus **tidak berlaku** saat provider = baileys. Nilai lama tetap utuh.

---

## Task 8 — Environment variable

Tambahkan ke `.env.example` (buat kalau belum ada) dan dokumentasikan:

```bash
# baileys (default) | cloud
WA_PROVIDER=baileys

# Diisi hanya kalau WA_PROVIDER=cloud
META_API_VERSION=v21.0
META_PHONE_NUMBER_ID=
META_WABA_ID=
META_ACCESS_TOKEN=
META_APP_SECRET=
META_VERIFY_TOKEN=
```

`META_VERIFY_TOKEN` adalah string bebas yang dibuat sendiri — dipakai sekali saat
mendaftarkan webhook, harus sama di kedua sisi.

Saat boot, kalau `WA_PROVIDER=cloud` tapi ada variabel yang kosong, **server harus
menolak start** dengan pesan jelas menyebut variabel mana yang kurang. Jangan
diam-diam jatuh ke Baileys — itu bikin bingung saat produksi.

---

## Verifikasi akhir Bagian A

```bash
node --check backend/config/whatsapp.js
node --check backend/config/whatsapp-cloud.js
node --check backend/config/whatsapp-baileys.js
node --check backend/config/wa-worker.js
node --check backend/controllers/webhookController.js
grep -rn "_bridgeCall" backend/          # tidak boleh ada di luar whatsapp-baileys.js
```

Lalu jalankan server tanpa `WA_PROVIDER` dan pastikan semua fitur lama normal.

---

# BAGIAN B — Dikerjakan manusia di dashboard Meta

Urutan ini penting. Langkah 1–3 bisa makan waktu berhari-hari.

1. **Siapkan nomor baru.** Jangan pakai nomor toko yang dipakai chat manual —
   nomor yang masuk Cloud API **tidak bisa lagi dibuka di aplikasi WhatsApp di HP**.
   Nomor harus bisa menerima SMS/telepon untuk verifikasi, dan belum pernah
   terdaftar di WhatsApp (atau dihapus dulu akunnya dari HP).

2. **Buat Meta Business Account** di business.facebook.com, lalu ajukan
   **verifikasi bisnis** (Business Settings → Security Center). Siapkan NIB/NPWP/
   akta dan bukti alamat usaha. Ini bagian yang paling lama — bisa 1–2 minggu.

3. **Buat App** di developers.facebook.com → tipe **Business** → tambahkan produk
   **WhatsApp**. Dari sini didapat WABA ID dan Phone Number ID.

4. **Daftarkan nomor** di WhatsApp Manager, verifikasi lewat SMS, lalu ajukan
   **display name** (nama yang muncul ke customer). Display name juga melalui
   review Meta.

5. **Buat System User token permanen.** Business Settings → Users → System Users →
   buat system user dengan peran Admin → Generate Token → pilih app-nya →
   centang `whatsapp_business_messaging` dan `whatsapp_business_management`.
   **Jangan pakai token sementara dari halaman Getting Started** — umurnya 24 jam
   dan produksi akan mati mendadak.

6. **Daftarkan template** di WhatsApp Manager → Message Templates. Buat tiga ini,
   persis seperti yang dirujuk `backend/config/wa-templates.js`:

   **`konfirmasi_data_masuk`** — kategori **Utility**, bahasa Indonesia:
   > Halo {{1}}, terima kasih telah menghubungi Cahaya Phone Gorontalo. Data Anda sudah kami terima dan tim kami akan segera menghubungi Anda untuk proses selanjutnya.

   Footer: `Cahaya Phone Gorontalo`

   **`ucapan_ulang_tahun`** — kategori **Marketing**, bahasa Indonesia:
   > Selamat ulang tahun, {{1}}! Semoga sehat dan sukses selalu. Tunjukkan pesan ini di Cahaya Phone Gorontalo untuk mendapat penawaran spesial.

   Footer: `Balas STOP untuk berhenti menerima pesan`

   **`promo_umum`** — kategori **Marketing**, bahasa Indonesia:
   > Halo {{1}}, ada kabar dari Cahaya Phone Gorontalo. {{2}}

   Footer: `Balas STOP untuk berhenti menerima pesan`

   Catatan: template dengan parameter yang terlalu bebas seperti `{{2}}` di
   `promo_umum` kadang ditolak. Kalau ditolak, buat beberapa template promo
   dengan isi tetap, bukan satu template serbaguna.

   Review biasanya 1×24 jam. Kategori ditentukan Meta, bukan Anda — kalau Meta
   memindahkan `konfirmasi_data_masuk` ke Marketing, biayanya naik dan teks
   templatenya perlu dibuat lebih transaksional.

7. **Isi metode pembayaran** di WhatsApp Manager → Billing. Kartu kredit.
   Tanpa ini pesan berbayar akan ditolak setelah kuota percobaan habis.

8. **Daftarkan webhook.** App Dashboard → WhatsApp → Configuration:
   - Callback URL: `https://<domain-produksi>/api/webhook/meta`
   - Verify Token: nilai `META_VERIFY_TOKEN` yang diisi di Railway
   - Setelah tersambung, klik **Manage** dan subscribe ke field **`messages`**.
     Tanpa subscribe ini, chat masuk dan status kiriman tidak akan pernah datang.

---

# BAGIAN C — Urutan go-live

1. Deploy hasil Bagian A ke produksi **dengan `WA_PROVIDER` masih `baileys`**.
   Pastikan tidak ada yang berubah. Diamkan beberapa hari.
2. Isi semua env var Meta di Railway, `WA_PROVIDER` **tetap** `baileys`.
3. Setelah template disetujui, ubah `WA_PROVIDER=cloud` dan restart.
4. **Tes berurutan, jangan langsung nyalakan semua:**
   - Kirim chat dari HP pribadi ke nomor API → cek customer tersimpan di dashboard
     dan pesannya tercatat. Ini menguji webhook.
   - Balas dari dashboard dalam 24 jam → harus terkirim sebagai pesan bebas dan
     **tidak menambah biaya** di Billing.
   - Isi form dari website dengan nomor uji → auto-reply harus datang sebagai
     template `konfirmasi_data_masuk`.
   - Set tanggal lahir customer uji ke hari ini → tunggu cron ucapan ulang tahun.
   - Broadcast ke 2–3 nomor internal dulu, jangan ke daftar customer.
5. Cek `whatsapp_logs` — status harus berjalan sampai `DELIVERED`/`READ`.
   Kalau mandek di `SENT`, berarti webhook status belum tersubscribe (langkah B8).
6. Pantau Billing di WhatsApp Manager selama minggu pertama dan bandingkan
   dengan jumlah baris `whatsapp_logs` per kategori.

**Rollback:** ubah `WA_PROVIDER` kembali ke `baileys` dan restart. Nomor Baileys
lama harus tetap tersambung selama masa transisi.

---

## Penghematan biaya yang belum diimplementasikan

Belum masuk spesifikasi ini karena menyentuh halaman customer, bukan backend:
setelah customer submit form, arahkan ke tombol `wa.me` sehingga customer yang
mengirim chat lebih dulu. Itu membuka jendela 24 jam, dan auto-reply berubah dari
template berbayar (Rp 356,65) menjadi pesan bebas gratis. Karena auto-reply adalah
kiriman terbanyak, ini memangkas sebagian besar tagihan bulanan.

Kerjakan setelah migrasi stabil, jangan barengan.
