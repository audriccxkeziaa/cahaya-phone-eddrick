# 📱 CAHAYA PHONE CRM

Aplikasi CRM berbasis web dengan integrasi WhatsApp Business API untuk mengelola customer dan chat secara otomatis.

## ✨ FITUR UTAMA

### Customer Form (Website)
- ✅ Form pendaftaran lengkap (nama, sales, produk, harga, dll)
- ✅ Auto-save ke database dengan source "Website"
- ✅ Kirim WhatsApp auto-reply otomatis
- ✅ Validasi input & format nomor otomatis

### Webhook WhatsApp
- ✅ Terima pesan WhatsApp masuk otomatis
- ✅ Buat customer baru dari Instagram/sosmed
- ✅ Deteksi source (Instagram/Facebook/TikTok)
- ✅ Log semua chat ke database
- ✅ Auto-reply untuk customer baru

### Admin Dashboard
- ✅ Login dengan JWT authentication
- ✅ Dashboard statistik lengkap
- ✅ Lihat semua customer dengan filter & search
- ✅ Detail customer lengkap
- ✅ Log chat WhatsApp (in/out)
- ✅ Responsive design
- ⚠️ Admin profile: hanya nama tampilan yang bisa diubah via panel (username/password tidak tersedia di UI)

### Forgot / Reset Password
- Admin dapat mereset password jika lupa melalui halaman `admin/forgot.html`.
- Flow: POST `/api/admin/forgot` (username atau email) → server mengirim link reset via email jika **MAIL** dikonfigurasi, atau mengembalikan token di respons dalam mode development.
- Link reset mengarah ke `admin/reset.html?token=...` yang memanggil POST `/api/admin/reset` untuk mengganti password.

### Environment variables (mail)
- Optional mail settings to enable email delivery:
  - `MAIL_HOST` (e.g. smtp.gmail.com)
  - `MAIL_PORT` (e.g. 587)
  - `MAIL_USER` (SMTP user)
  - `MAIL_PASS` (SMTP password)
  - `MAIL_FROM` (optional, email from)
  - `FRONTEND_URL` (optional, e.g. http://localhost:5500)

Note: If MAIL_* is not configured, API will return a reset token in response (developer fallback).
## 🚀 QUICK START

### 1. Setup Database
```bash
# Import database.sql ke MySQL via phpMyAdmin
```

### 2. Setup Backend
```bash
cd backend
npm install
# Edit .env (database & WhatsApp API)
npm start
```

### 3. Buka Aplikasi
- **Customer Form**: Buka `customer/index.html` di browser
- **Admin Panel**: Buka `admin/index.html` di browser

### 4. Login Admin
```
Username: admin
Password: admin123
```

## 📁 STRUKTUR PROJECT

```
cahaya-phone-crm/
├── database.sql              # Database schema & data
├── backend/                  # Node.js + Express API
│   ├── server.js            # Main server
│   ├── config/              # Database, WhatsApp, Auth
│   ├── controllers/         # Form, Webhook, Admin
│   ├── routes/              # API routes
│   └── .env                 # Configuration
├── customer/                 # Customer form (public)
│   ├── index.html
│   ├── style.css
│   └── script.js
└── admin/                    # Admin panel (protected)
    ├── index.html           # Login
    ├── dashboard.html       # Dashboard
    ├── admin.css
    └── admin.js
```

## 🔧 TEKNOLOGI

- **Backend**: Node.js, Express, MySQL
- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Auth**: JWT (JSON Web Token)
- **WhatsApp API**: Fonnte / Wablas
- **Database**: MySQL 5.7+

## 📊 DATABASE

### Tables:
- **admins**: Data admin & authentication
- **customers**: Data customer lengkap + source tracking
- **messages**: Log chat WhatsApp (in/out)

### View:
- **customer_stats**: Statistik dashboard

## 🔐 SECURITY

- ✅ Password hashing (bcryptjs)
- ✅ JWT token authentication
- ✅ Protected API routes
- ✅ SQL injection protection
- ✅ Input validation
- ✅ CORS configuration

## 📝 API ENDPOINTS

### Public
```
POST /api/form-submit          # Submit customer form
POST /api/webhook/whatsapp     # WhatsApp webhook
POST /api/admin/login          # Admin login
```

### Protected (Require Token)
```
GET  /api/admin/stats          # Dashboard statistics
GET  /api/admin/customers      # List customers
GET  /api/admin/customers/:id  # Customer detail
GET  /api/admin/messages       # Chat log
```

## ⚙️ KONFIGURASI

Edit file `backend/.env`:

```env
# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=cahaya_phone_crm

# Server
PORT=5000

# JWT Secret
JWT_SECRET=your-secret-key

# WhatsApp API (Fonnte)
WHATSAPP_API_URL=https://api.fonnte.com/send
WHATSAPP_API_KEY=your-api-key
WHATSAPP_SENDER=6281234567890
```

## 📖 DOKUMENTASI LENGKAP

Baca **`PANDUAN-LENGKAP.md`** untuk:
- Step-by-step setup detail
- WhatsApp API configuration
- Testing procedures
- Troubleshooting
- Tips & tricks

## 🔍 TESTING

1. Submit form customer → Cek database & dashboard admin
2. Login admin → Lihat statistik & customer
3. Kirim WhatsApp ke nomor → Cek webhook & chat log
4. Filter & search customer
5. View detail customer

## ⚠️ CATATAN

- Backend harus jalan sebelum buka form/admin
- Untuk webhook, butuh URL publik (gunakan ngrok untuk testing lokal)
- Ganti password admin default setelah deploy
- Monitor saldo WhatsApp API secara berkala

## 🆘 TROUBLESHOOTING

### Backend error?
- Cek XAMPP MySQL sudah jalan
- Cek database sudah diimport
- Cek .env configuration

### Form tidak bisa submit?
- Cek backend sudah jalan (http://localhost:5000)
- Cek Console browser (F12)

### Login admin gagal?
- Clear browser localStorage
- Cek database table admins

### WhatsApp tidak terkirim?
- Cek API key & saldo
- Cek nomor format 628xxx
- Cek log di terminal backend

## 📞 SUPPORT

Jika ada pertanyaan atau butuh bantuan:
1. Cek PANDUAN-LENGKAP.md
2. Lihat log di terminal backend
3. Lihat Console browser (F12)

---

**Made with ❤️ for Cahaya Phone**

🚀 **Ready to use!**