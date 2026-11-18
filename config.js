// ============================================
// FRONTEND CONFIG
// ============================================
// Kosong = same origin (Vercel testing, backend & frontend 1 server)
// Isi = Railway URL (production, frontend Vercel + backend Railway)
//
// Contoh production:
// const API_BASE_URL = 'https://cahaya-phone-backend.up.railway.app';
// ============================================

const API_BASE_URL = '';

// A small seasonal accent for the store's November–December holiday period.
const storeMonth = Number(new Intl.DateTimeFormat('en', {
    month: '2-digit', timeZone: 'Asia/Makassar'
}).format(new Date()));
document.documentElement.classList.toggle('christmas-season', storeMonth === 11 || storeMonth === 12);

// Override fetch: semua /api/ call otomatis pakai base URL
(function() {
    const _originalFetch = window.fetch;
    window.fetch = function(url, options) {
        if (typeof url === 'string' && url.startsWith('/api/')) {
            url = API_BASE_URL + url;
        }
        return _originalFetch.call(this, url, options);
    };
})();
