# Sinkronisasi nama kontak WhatsApp

Nama pada Google Contacts yang terhubung mengikuti aturan berikut:

- Belum pernah belanja/submit form: `customer - DD/MM/YYYY`, sesuai tanggal **chat pertama** dalam WITA/Gorontalo (`Asia/Makassar`, UTC+8).
- Contoh: chat 18 November menjadi `customer - 18/11/2026`; chat lagi 19 November tetap `customer - 18/11/2026`. Waktu chat terakhir tetap dicatat terpisah untuk monitoring. Tanggal kontak tetap memakai waktu pertama kali customer tercatat, termasuk ketika ada pesan lama yang terlambat masuk.
- Submit form pertama: nomor yang sama menjadi `Belanja`, dan nama kontak menjadi `nama form - DD/MM/YYYY`, memakai tanggal **pembelian pertama**. Contoh: `Budi - 18/11/2026`.
- Chat setelah belanja maupun submit form ulang tidak mengubah tanggal pembelian pertama. Nama mengikuti nama dari form, tanpa menambahkan tanggal berulang. Nama profil WA tidak dipakai.
- Kontak yang tersimpan dengan nama manual/lama (misalnya `Ilyas`) juga diganti sesuai aturan tersebut. Nama pembeli dalam database tetap polos agar sapaan pesan tidak ikut memuat tanggal.

Format `08...`, `628...`, dan `+62...` dinormalisasi menjadi nomor yang sama. Pencocokan menggunakan seluruh nomor, bukan sepuluh digit terakhir. Nomor dummy untuk walk-in tanpa WA tidak dikirim ke Google Contacts.

Timestamp pesan Baileys/Meta diteruskan sampai penyimpanan, sehingga pesan yang baru berhasil diproses setelah tengah malam tetap menggunakan tanggal pengirimannya. Kolom `TIMESTAMP` lama menyimpan waktu UTC; saat membaca tanggal kontak, query menyebut UTC secara eksplisit sebelum diformat ke WITA. Waktu form dan purchase baru dikirim sebagai timestamp ISO dengan zona UTC. `customers.first_purchase_at` memakai `TIMESTAMPTZ` dan diisi hanya sekali, menggunakan `COALESCE` pada update/upsert agar submit form ulang tidak menggantinya. Zona waktu mesin server/database tidak menjadi acuan tanggal kontak.

Semua proses chat, form, dan retry menggunakan satu jalur sinkronisasi dengan antrean berurutan per proses backend. Update mengirim metadata CONTACT dan etag terbaru sesuai [ketentuan Google People API](https://developers.google.com/people/api/rest/v1/people/updateContact). Kegagalan dicatat sebagai pending untuk tombol **Sync Kontak Gagal** di admin. Antrean berada dalam memori; setelah restart, retry kontak pending melalui tombol tersebut.

## Deploy dan verifikasi

Deploy backend dan admin. Migrasi menambahkan `customers.first_purchase_at` dan mengisi pembeli lama dari purchase paling awal yang tersimpan. Backend persistent juga menjalankan migrasi kontak yang idempotent **sebelum menerima request**; jalankan `npm --prefix backend run migrate` untuk deployment yang tidak memakai startup persistent (misalnya Vercel). Tidak ada perubahan wa-bridge pada rilis ini. Pastikan Google Contacts pada admin terhubung ke akun Google yang juga disinkronkan ke kontak HP WhatsApp toko. Perubahan di Google Contacts masih perlu disinkronkan oleh perangkat sebelum nama di WhatsApp terlihat berubah.

Uji dengan satu nomor: chat pertama → chat hari berikutnya (tanggal tetap) → submit form dengan nomor yang sama (nama + tanggal beli pertama) → chat lagi → submit form ulang (tanggal beli tetap). Periksa kontak Google dan nama di WhatsApp. Uji pergantian hari WITA pada 23:59:59 dan 00:00:00, setara 15:59:59 dan 16:00:00 UTC.

## Memperbaiki kontak lama

Kontak lama yang pernah ditandai sukses bisa masih menggunakan nama/tanggal lama karena versi sebelumnya mempertahankan nama kontak manual. Setelah deploy, buka **Google Contacts → Perbarui Semua Nama Kontak** di dashboard admin. Tombol ini memperbarui semua nomor customer valid, termasuk yang sudah ditandai sukses. **Sync Kontak Gagal** tetap hanya memproses yang pending/gagal.

Dashboard memproses lima kontak per request lalu melanjutkan dengan cursor ID supaya tidak menunggu seluruh database dalam satu request panjang. API `POST /api/google/resync` menerima `{ all: true, afterId: 0 }` dan mengembalikan `hasMore` serta `nextAfterId`. Pemanggil API langsung harus melanjutkan sampai `hasMore: false`.

Alternatifnya, jalankan script pada environment yang memiliki konfigurasi database dan Google toko:

```powershell
node backend/scripts/sync_contact_names.js --phone 081234567890
```

Atau proses semua nomor valid, termasuk kontak yang sudah ditandai tersinkron:

```powershell
node backend/scripts/sync_contact_names.js --all
```

Script benar-benar membuat/memperbarui Google Contacts sesuai data customer. Script tidak mengirim pesan WhatsApp. Tanggal chat berasal dari `last_incoming_message_at` (fallback `created_at` bila belum ada), sedangkan pembeli memakai `first_purchase_at` yang tersimpan. Jalankan migrasi sebelum script pada deployment yang belum di-upgrade.

Jika nama Google Contacts sudah benar tetapi WhatsApp masih menampilkan nama lama, pastikan HP WhatsApp toko menyinkronkan akun Google yang sama, lalu sinkronkan kontak dan buka kembali WhatsApp. Periksa juga apakah nomor itu tersimpan dengan nama lama di akun kontak/SIM lain. Backend memperbarui Google Contacts; tampilan nama di WhatsApp tetap mengikuti kontak perangkat.

Tanggal lama hanya bisa dipulihkan dari waktu yang masih tersimpan. Untuk pembeli lama yang sama sekali tidak punya riwayat purchase, migrasi memakai `customers.created_at` sebagai fallback historis; bila record dahulu dibuat dari chat, waktu pembelian asli tidak bisa dipastikan tanpa data tambahan. Tanggal yang sudah terisi tidak digeser saat restart atau saat riwayat purchase diedit/dihapus.

## Tes regresi

```powershell
npm --prefix backend test
```

Tes memakai People API/WhatsApp tiruan serta PostgreSQL lokal di memori melalui PGlite (dependency khusus development), tanpa membaca `.env` atau menghubungi layanan asli. Cakupan termasuk chat pertama/ulang, form ulang, pembelian pertama tanpa produk, migration/backfill, upsert nomor yang sama, tengah malam WITA, empat zona waktu database, zona waktu server berbeda, metadata update, pesan duplikat/terlambat, kegagalan API, dan chat/form bersamaan. Akun Google dan tampilan kontak WhatsApp deployment tetap perlu diverifikasi di environment toko.

Migrasi juga memperbaiki label Chat Only lama memakai `customers.created_at` (chat pertama) dan menandainya pending untuk sinkronisasi. Waktu chat terakhir tidak berubah.

Perubahan nama/konversi menjadi Belanja dari admin juga menandai kontak pending dan menjalankan sinkronisasi. Pembelian yang ditambahkan lewat admin mengisi tanggal beli pertama hanya jika belum terisi; edit, pembelian ulang, maupun penghapusan riwayat tidak mengganti tanggal tersebut.

## Monitoring bulanan dan tampilan Natal

Laporan Sukses dan Omzet menampilkan Januari–Desember pada setiap tahun, termasuk bulan kosong. Panah tahun menampilkan tahun dari data customer maupun pembelian. Transaksi sukses dihitung dari catatan `purchases`, bukan jumlah customer berstatus Completed; pembelian ulang masuk bulan tanggal belanjanya dalam WITA. Customer belanja adalah jumlah customer unik pada bulan tersebut. Customer baru adalah jumlah registrasi, ditampilkan terpisah tanpa membagi transaksi ulang dengan registrasi untuk membuat rate.

Klik nama bulan untuk melihat tanggal/jam WITA, customer, nomor WA, produk, jumlah unit, subtotal, sales, dan metode pembayaran. Detail berisi maksimal 25 transaksi per halaman; ringkasan omzet/customer/unit tetap mencakup seluruh bulan. Membuka ulang laporan mengambil data baru agar koreksi transaksi terlihat. Di HP, tabel bisa digeser untuk melihat kolom berikutnya.

Verifikasi deployment: coba customer lama yang belanja pada dua bulan berbeda dan transaksi pada batas 23:59:59/00:00:00 WITA; cocokkan omzet ringkasan dengan detail. Uji kedua tombol kontak, termasuk kegagalan sebagian, sambungkan ulang akun Google bila kredensial dicabut, lalu retry. Tes lokal memakai Google/WhatsApp tiruan; hasil pada akun toko perlu diperiksa sesudah deploy.

Aksen Natal merah/hijau/emas tampil pada form customer, login admin, dan dashboard selama November–Desember mengikuti WITA. Bulan lain menggunakan tampilan reguler. Service worker admin diperbarui agar aset JS/CSS baru ikut dimuat.
