# Sinkronisasi nama kontak WhatsApp

Nama pada Google Contacts yang terhubung mengikuti aturan berikut:

- Chat pertama tanpa form: `customer - DD/MM/YYYY`, sesuai tanggal pesan pertama dalam WITA (`Asia/Makassar`).
- Chat pada hari berikutnya: tanggal tersebut tetap.
- Submit form customer: nomor yang sama menjadi `Belanja`, dan nama kontak mengikuti nama di form, tanpa akhiran tanggal.
- Chat setelah belanja: nama pembeli tetap.
- Kontak dengan nama manual tetap dipertahankan saat hanya chat. Submit form menjadi acuan nama untuk nomor tersebut.

Format `08...`, `628...`, dan `+62...` dinormalisasi menjadi nomor yang sama. Pencocokan menggunakan seluruh nomor, bukan sepuluh digit terakhir. Nomor dummy untuk walk-in tanpa WA tidak dikirim ke Google Contacts.

Timestamp pesan Baileys/Meta diteruskan sampai penyimpanan, sehingga pesan yang baru berhasil diproses setelah tengah malam tetap menggunakan tanggal pengirimannya. Kolom `TIMESTAMP` yang sudah ada menyimpan waktu UTC; saat membaca tanggal kontak, query menyebut UTC secara eksplisit sebelum diformat ke WITA. Zona waktu mesin server tidak menjadi acuan tanggal.

Semua proses chat, form, dan retry menggunakan satu jalur sinkronisasi dengan antrean berurutan per proses backend. Update mengirim metadata CONTACT dan etag terbaru sesuai [ketentuan Google People API](https://developers.google.com/people/api/rest/v1/people/updateContact). Kegagalan dicatat sebagai pending untuk tombol **Sync Kontak Gagal** di admin. Antrean berada dalam memori; setelah restart, retry kontak pending melalui tombol tersebut.

## Deploy dan verifikasi

Deploy ulang backend dan wa-bridge. Tidak diperlukan migrasi skema baru. Pastikan Google Contacts pada admin terhubung ke akun Google yang juga disinkronkan ke kontak HP WhatsApp toko. Perubahan di Google Contacts masih perlu disinkronkan oleh perangkat sebelum nama di WhatsApp terlihat berubah.

Uji dengan satu nomor: chat pertama → chat hari berikutnya → submit form dengan nomor yang sama → chat lagi. Periksa kontak Google dan nama yang tampil di WhatsApp. Uji pergantian hari WITA pada 23:59 dan 00:00.

## Memperbaiki kontak lama

Kontak lama yang pernah ditandai sukses bisa masih menggunakan nama/tanggal lama. Setelah deploy, jalankan script pada environment yang memiliki konfigurasi database dan Google toko:

```powershell
node backend/scripts/sync_contact_names.js --phone 081234567890
```

Atau proses semua nomor valid, termasuk kontak yang sudah ditandai tersinkron:

```powershell
node backend/scripts/sync_contact_names.js --all
```

Script benar-benar membuat/memperbarui Google Contacts sesuai data customer. Script tidak mengirim pesan WhatsApp. Tidak perlu mengubah nama customer lama di database: tanggal kontak chat dihitung dari `customers.created_at`, dan nama pembeli dari `nama_lengkap`.

Tanggal lama hanya bisa dipulihkan dari waktu yang masih tersimpan. Bila pesan pertama dahulu tertunda lalu waktu aslinya tidak tersimpan, tanggal aslinya tidak bisa direkonstruksi secara pasti. Akurasi timestamp pesan yang baru masuk diperbaiki oleh perubahan ini.

## Tes regresi

```powershell
npm --prefix backend test
```

Tes memakai database dan People API tiruan tanpa membaca `.env` atau menghubungi layanan asli. Cakupan termasuk chat pertama/ulang, form, pencocokan nomor, tengah malam WITA, zona waktu server berbeda, metadata update, pesan duplikat, kegagalan API, dan chat/form yang berjalan bersamaan. Integrasi dengan database serta akun Google deployment tetap perlu diverifikasi pada environment toko.
