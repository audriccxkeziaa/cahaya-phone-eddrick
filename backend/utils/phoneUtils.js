// ============================================
// PHONE NUMBER UTILITY
// Sanitize & normalize Indonesian phone numbers
// ============================================

/**
 * Normalize phone number to WhatsApp-compatible format (628xxx)
 * Handles: "0812 3456 7890", "0812-3456-7890", "+62 812 3456 7890", "62812..."
 * @param {string} raw - Raw phone number input
 * @returns {string} Normalized phone number (e.g. 6281234567890)
 */
function sanitizePhone(raw) {
    if (!raw) return '';

    // Remove all non-digit characters (spaces, dashes, plus, brackets, etc.)
    let num = String(raw).replace(/\D/g, '');

    // Handle 62xxx -> keep as is (already correct)
    if (num.startsWith('62')) {
        return num;
    }

    // Handle 08xxx -> 628xxx
    if (num.startsWith('0')) {
        return '62' + num.slice(1);
    }

    // Handle 8xxx (number without leading 0 or country code) -> 628xxx
    if (num.startsWith('8') && num.length >= 9) {
        return '62' + num;
    }

    return num;
}

/**
 * Validate that a phone number looks like a valid Indonesian WhatsApp number
 * @param {string} phone - Already sanitized phone number
 * @returns {{ valid: boolean, message: string }}
 */
function validatePhone(phone) {
    const num = sanitizePhone(phone);

    if (!num) {
        return { valid: false, message: 'Nomor WhatsApp wajib diisi' };
    }

    if (!num.startsWith('62')) {
        return { valid: false, message: 'Nomor harus dimulai dengan 0 atau +62' };
    }

    if (num.length < 11 || num.length > 15) {
        return { valid: false, message: 'Nomor WhatsApp tidak valid (terlalu pendek atau panjang)' };
    }

    return { valid: true, message: 'OK' };
}

module.exports = { sanitizePhone, validatePhone };
