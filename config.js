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
