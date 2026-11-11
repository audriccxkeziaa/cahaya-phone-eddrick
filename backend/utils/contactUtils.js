// Contact dates always use the store's timezone, independently of server TZ.
const CONTACT_TIME_ZONE = 'Asia/Makassar';

function formatContactDate(value) {
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        timeZone: CONTACT_TIME_ZONE
    }).format(new Date(value));
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

module.exports = { CONTACT_TIME_ZONE, formatContactDate, getMessageDate };
