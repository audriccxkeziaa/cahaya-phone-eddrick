// Contact dates always use the store's timezone, independently of server TZ.
const CONTACT_TIME_ZONE = 'Asia/Makassar';

function formatContactDate(value) {
    if (!value || !Number.isFinite(new Date(value).getTime())) {
        throw new Error('Contact timestamp is missing or invalid');
    }
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        timeZone: CONTACT_TIME_ZONE
    }).format(new Date(value));
}

// Keep the CRM's plain buyer name separate from its address-book label.
function getCustomerContactName(customer) {
    if (customer.tipe === 'Belanja') {
        return `${customer.nama_lengkap.trim()} - ${formatContactDate(customer.first_purchase_at)}`;
    }
    return `customer - ${formatContactDate(customer.first_contact_at)}`;
}

// Baileys/Meta send Unix seconds; some webhook providers send milliseconds.
function getMessageDate(timestamp, now = new Date()) {
    if (timestamp === undefined || timestamp === null || timestamp === '') return now;
    const numeric = Number(timestamp);
    const date = Number.isFinite(numeric)
        ? new Date(numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric)
        : new Date(timestamp);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= 0 || date > now) return now;
    return date;
}

module.exports = { CONTACT_TIME_ZONE, formatContactDate, getCustomerContactName, getMessageDate };
