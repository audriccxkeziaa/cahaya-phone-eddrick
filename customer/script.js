// ============================================
// CUSTOMER FORM JAVASCRIPT
// ============================================

const API_URL = '/api';

// Form elements
const form = document.getElementById('customerForm');
const submitBtn = document.getElementById('submitBtn');
const alert = document.getElementById('alert');

// ============================================
// RETRY QUEUE — keep customer submissions safe across backend restarts
// ============================================
// If submit fails due to network/5xx, we cache the form data in localStorage
// and retry every 30s in the background. The customer doesn't have to know
// the backend was down — they see a polite "sedang mengirim ulang" banner
// and the submission eventually goes through when the server is healthy.
const PENDING_KEY = 'pendingFormSubmission';
const RETRY_INTERVAL_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 20;   // 20 × 30s = 10 minutes of patience

let retryTimer = null;

function getPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); }
    catch (_) { return null; }
}

function setPending(obj) {
    if (obj === null) {
        localStorage.removeItem(PENDING_KEY);
    } else {
        localStorage.setItem(PENDING_KEY, JSON.stringify(obj));
    }
}

function renderRetryBanner(pending) {
    let banner = document.getElementById('retryBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'retryBanner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#FEF3C7;color:#92400E;padding:10px 16px;text-align:center;font-size:13px;z-index:9999;box-shadow:0 2px 4px rgba(0,0,0,0.05);';
        document.body.prepend(banner);
    }
    const ago = Math.round((Date.now() - (pending.savedAt || Date.now())) / 1000);
    banner.innerHTML = `⏳ Pengiriman data tertunda — sedang dicoba ulang otomatis (percobaan ${pending.attempts || 0}/${MAX_RETRY_ATTEMPTS}, ${ago}s lalu). Jangan tutup halaman.`;
}

function clearRetryBanner(successMsg) {
    const banner = document.getElementById('retryBanner');
    if (!banner) return;
    if (successMsg) {
        banner.style.background = '#D1FAE5';
        banner.style.color = '#065F46';
        banner.innerHTML = '✅ ' + successMsg;
        setTimeout(() => banner.remove(), 4000);
    } else {
        banner.remove();
    }
}

function startRetryLoop() {
    if (retryTimer) return;
    retryTimer = setInterval(async () => {
        const pending = getPending();
        if (!pending) {
            stopRetryLoop();
            return;
        }
        pending.attempts = (pending.attempts || 0) + 1;
        setPending(pending);
        renderRetryBanner(pending);

        if (pending.attempts > MAX_RETRY_ATTEMPTS) {
            stopRetryLoop();
            const banner = document.getElementById('retryBanner');
            if (banner) {
                banner.style.background = '#FEE2E2';
                banner.style.color = '#991B1B';
                banner.innerHTML = '❌ Sistem sedang ada gangguan. Data Anda tersimpan — silakan hubungi admin atau coba lagi nanti.';
            }
            return;
        }

        const result = await sendSubmission(pending.data, true);
        if (result.success) {
            setPending(null);
            stopRetryLoop();
            clearRetryBanner('Data berhasil terkirim setelah ' + pending.attempts + ' percobaan ulang.');
        } else if (!result.retryable) {
            // Server says this is invalid (4xx) — stop retrying, surface error.
            setPending(null);
            stopRetryLoop();
            clearRetryBanner();
            showAlert('❌ ' + (result.message || 'Pengiriman ditolak server'), 'error');
        }
    }, RETRY_INTERVAL_MS);
}

function stopRetryLoop() {
    if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
    }
}

// Centralized submit — used by both fresh submit and retry loop.
async function sendSubmission(formData, isRetry = false) {
    try {
        const response = await fetch(`${API_URL}/form-submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        // 4xx = client error (validation, honeypot, etc) — don't retry
        if (response.status >= 400 && response.status < 500) {
            const data = await response.json().catch(() => ({}));
            return { success: false, retryable: false, message: data.message || `HTTP ${response.status}` };
        }
        // 5xx = server error — retry
        if (response.status >= 500) {
            return { success: false, retryable: true, message: `Server error ${response.status}` };
        }
        const data = await response.json();
        if (data.success) {
            return { success: true, data };
        }
        return { success: false, retryable: false, message: data.message || 'Submit gagal' };
    } catch (err) {
        // Network failure — backend down, retryable
        return { success: false, retryable: true, message: err.message || 'Network error' };
    }
}

// On page load, resume retrying any pending submission from a previous session
window.addEventListener('DOMContentLoaded', () => {
    const pending = getPending();
    if (pending) {
        console.log('[retry] resuming pending submission, attempts so far:', pending.attempts);
        renderRetryBanner(pending);
        startRetryLoop();
    }
});

// Show alert message
function showAlert(message, type = 'success') {
    alert.textContent = message;
    alert.className = `alert ${type} show`;
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        alert.classList.remove('show');
    }, 5000);
    
    // Scroll to alert
    alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Normalize phone number to WhatsApp format (628xxx)
 * Handles: "0812 3456 7890", "+62-812-3456-7890", "62812...", "812..."
 */
function formatWhatsApp(number) {
    // Remove all non-digit characters
    let num = String(number).replace(/\D/g, '');

    if (num.startsWith('62')) return num;
    if (num.startsWith('0'))  return '62' + num.slice(1);
    if (num.startsWith('8') && num.length >= 9) return '62' + num;
    return num;
}

function validateForm(formData) {
    if (!formData.nama_lengkap || !formData.whatsapp) {
        showAlert('Nama lengkap dan WhatsApp wajib diisi', 'error');
        return false;
    }

    const normalized = formatWhatsApp(formData.whatsapp);
    if (!normalized.startsWith('62') || normalized.length < 11 || normalized.length > 15) {
        showAlert('Nomor WhatsApp tidak valid. Contoh: 08123456789 atau +62812345678', 'error');
        return false;
    }

    return true;
}

// Handle form submit
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form data
    const formData = {
        nama_lengkap: document.getElementById('nama_lengkap').value.trim(),
        // Also send `nama` for backward compatibility with backend
        nama: document.getElementById('nama_lengkap').value.trim(),
        nama_sales: document.getElementById('nama_sales').value.trim(),
        merk_unit: document.getElementById('merk_unit').value,
        tipe_unit: document.getElementById('tipe_unit').value.trim(),
        harga: document.getElementById('harga').value,
        qty: document.getElementById('qty').value || 1,
        tanggal_lahir: document.getElementById('tanggal_lahir').value,
        alamat: document.getElementById('alamat').value.trim(),
        whatsapp: document.getElementById('whatsapp').value.trim(),
        metode_pembayaran: document.getElementById('metode_pembayaran').value,
        tahu_dari: document.getElementById('tahu_dari').value,
        opted_in: true,
        // Honeypot — must be empty. Bots filling every input will trip this.
        website_url: document.getElementById('website_url')?.value || ''
    };
    
    // Validate
    if (!validateForm(formData)) {
        return;
    }
    
    // Format WhatsApp
    formData.whatsapp = formatWhatsApp(formData.whatsapp);
    
    // Disable button
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').textContent = 'Mengirim...';

    const result = await sendSubmission(formData);

    if (result.success) {
        showAlert('✅ Data berhasil disimpan! Pesan WhatsApp akan segera dikirim.', 'success');
        form.reset();
        // If there was a stale pending submission from before, it's superseded — drop it
        setPending(null);
        stopRetryLoop();
        clearRetryBanner();
    } else if (result.retryable) {
        // Network or 5xx — queue for background retry. User keeps the success-y UX:
        // their data isn't lost, and the banner explains what's happening.
        setPending({ data: formData, savedAt: Date.now(), attempts: 0 });
        startRetryLoop();
        renderRetryBanner(getPending());
        showAlert('⏳ Server sedang sibuk. Data Anda tersimpan di browser dan akan dikirim ulang otomatis. Jangan tutup halaman.', 'success');
        form.reset();
    } else {
        // Real validation/auth error — don't retry, just show
        showAlert('❌ ' + (result.message || 'Pengiriman gagal'), 'error');
    }

    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-text').textContent = 'Kirim Data Customer';
});

// Auto-format WhatsApp input — allow spaces/dashes while typing, normalize on blur
document.getElementById('whatsapp').addEventListener('blur', (e) => {
    const normalized = formatWhatsApp(e.target.value);
    if (normalized) e.target.value = normalized;
});

// Auto-format price input
document.getElementById('harga').addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    e.target.value = value;
});

console.log('✅ Customer Form initialized');
console.log('📡 API URL:', API_URL);