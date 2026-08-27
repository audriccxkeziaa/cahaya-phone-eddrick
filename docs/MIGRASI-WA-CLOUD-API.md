# Migrasi WhatsApp: Baileys → Meta Cloud API Resmi

Bagian A (kode) **sudah selesai dan ada di repo**. Bagian B dikerjakan manusia
di dashboard Meta saat klien setuju. Bagian C adalah urutan go-live.

Kode dan setup **dipisah total**: program tetap berjalan memakai Baileys.
Cloud API baru aktif ketika `WA_PROVIDER=cloud` diisi di environment.
Rollback = kembalikan env var ke `baileys` lalu restart.

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

# BAGIAN A — SUDAH DIIMPLEMENTASIKAN

Status: **selesai dan ada di repo**. Program masih berjalan memakai Baileys
persis seperti sebelumnya; jalur Cloud API baru aktif kalau `WA_PROVIDER=cloud`.

## File yang dibuat

| File | Isi |
|---|---|
| `backend/config/whatsapp.js` | Pemilih provider. Membaca `WA_PROVIDER`, mengembalikan adapter yang sesuai. Controller tidak berubah sama sekali. |
| `backend/config/wa-service-base.js` | Semua logika bersama: logging `whatsapp_logs`, opt-out, statistik harian, pengaturan, antrean auto-reply. Tidak ada transport di sini. |
| `backend/config/whatsapp-baileys.js` | Adapter lama (dulu `whatsapp.js`), kini turunan dari base. Perilakunya tidak berubah. |
| `backend/config/whatsapp-cloud.js` | Adapter Meta Cloud API: logika jendela 24 jam, kirim template vs teks bebas, klasifikasi error Meta, status nomor + quality rating. |
| `backend/config/wa-templates.js` | Pemetaan kategori internal ke nama template Meta, plus pembersih parameter. |

## File yang diubah

| File | Perubahan |
|---|---|
| `backend/config/wa-worker.js` | `_bridgeCall` diganti `sendForExistingLog`; klasifikasi transient sekarang memakai flag `retryable` dari provider, bukan regex; pacing jadi sadar provider; `variasiPesan` dan warm-up nomor dimatikan di mode cloud. |
| `backend/controllers/webhookController.js` | Ditambah `verifyMetaWebhook` dan `handleMetaWebhook` beserta pemroses payload dan pemetaan status. Chat masuk tetap lewat `handleIncomingMessage` yang sama. |
| `backend/routes/api.js` | Route `GET/POST /api/webhook/meta`. |
| `backend/server.js` | Raw body ditangkap untuk verifikasi tanda tangan; validasi env saat boot untuk mode cloud. |
| `admin/admin.js`, `admin/dashboard.html` | Panel WA menampilkan nomor + quality rating saat mode cloud; blok QR dan tombol Disconnect/Restart disembunyikan. |
| `.env.example` | Seluruh variabel `WA_PROVIDER` dan `META_*`. |

## Keputusan penting

**Jendela 24 jam menentukan biaya.** `whatsapp-cloud.js` mengecek
`customers.last_incoming_message_at`. Terbuka: kirim teks bebas. Tertutup:
kirim template. Kalau pengecekan itu sendiri gagal, sistem menganggap
**tertutup** dan mengirim template — salah menebak "terbuka" berarti Meta
menolak dengan 131047 dan pesannya hilang, sedangkan salah menebak "tertutup"
hanya berarti terkirim sebagai template berbayar. Dipilih yang sampai.

**Kategori tanpa template = gagal permanen.** Kalau jendela tertutup dan
kategori tidak punya template terdaftar, pesan ditandai `FAILED` dengan
`error_code = 'NO_TEMPLATE'` dan tidak diulang. Sistem tidak akan diam-diam
mencoba mengirim teks bebas di luar jendela.

**Error Meta yang tidak layak diulang.** `131047` (di luar jendela), `131026`
(tidak terkirim), `132xxx` (template salah), `190` (token mati) semuanya
permanen. Yang diulang hanya `130429`, `131056`, `133016`, dan HTTP 5xx.
Token mati (`190`) dicetak sebagai `console.error` mencolok karena itu butuh
tindakan manusia, bukan retry.

**Webhook membalas 200 lebih dulu, memproses belakangan.** Meta mengirim ulang
lalu menonaktifkan webhook yang lambat merespons.

**Pacing di mode cloud.** Delay turun ke 2-5 detik, break dan warm-up mati.
Yang sengaja dipertahankan: jam kerja 08:00-22:00 WITA (sopan santun ke
customer, bukan anti-ban) dan daily limit — yang di mode cloud berubah fungsi
jadi rem biaya.

## Verifikasi yang sudah dijalankan

- `node --check` bersih di 10 file yang disentuh.
- Kedua provider dimuat dan permukaan API-nya identik (26 method wajib, nol
  yang hilang di kedua sisi).
- Pembersih parameter template: newline dan spasi ganda jadi spasi tunggal.
- Kategori tak terdaftar mengembalikan `null` (memicu jalur `NO_TEMPLATE`).
- Klasifikasi error: `130429` retry, `131047` tidak, HTTP 500 retry.
- Boot mode cloud tanpa env lengkap menolak start dan menyebut variabel yang kurang.
- Webhook: token benar mengembalikan challenge apa adanya (200), token salah
  403, tanda tangan valid 200, tanda tangan salah 401, tanpa tanda tangan 401.

Yang **belum** bisa diuji tanpa akun Meta: pengiriman sungguhan, bentuk payload
webhook asli, dan quality rating. Itu bagian dari uji go-live di Bagian C.

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
