// ============================================
// REALTIME RELAY (Option C)
// Subscribe to Supabase Postgres changes SERVER-SIDE (service role key — never
// exposed to the browser) and fan out lightweight "table changed" events to admin
// browsers over SSE. Keeps the existing JWT/cookie auth model; no Supabase
// credentials in the frontend, no RLS overhaul.
//
// Frontend connects to GET /api/admin/stream (authMiddleware via cookie) with
// EventSource{ withCredentials:true } and re-fetches the current view on events.
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Requires dep:  @supabase/supabase-js
// Requires Supabase: Realtime enabled (replication) on the watched tables.
// If env/dep missing, realtime stays OFF and the admin simply keeps using
// its existing manual/polling refresh — nothing breaks.
// ============================================

const WATCH_TABLES = ['customers', 'messages', 'whatsapp_logs', 'purchases'];

const clients = new Set(); // active SSE response objects

function addClient(res) {
    clients.add(res);
    res.on('close', () => clients.delete(res));
}

function broadcast(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
        try { res.write(data); } catch (_) { clients.delete(res); }
    }
}

// Heartbeat keeps SSE alive through Railway/Vercel idle timeouts (~30-60s).
setInterval(() => broadcast({ table: '_ping', event: 'ping', at: Date.now() }), 25_000).unref?.();

let started = false;
function startRealtime() {
    if (started) return;
    started = true;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.warn('[Realtime] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — realtime disabled (admin uses manual refresh).');
        return;
    }

    let createClient;
    try {
        ({ createClient } = require('@supabase/supabase-js'));
    } catch (_) {
        console.warn('[Realtime] @supabase/supabase-js not installed — realtime disabled.');
        return;
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const channel = supabase.channel('admin-realtime');
    for (const table of WATCH_TABLES) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
            broadcast({ table, event: payload.eventType, at: Date.now() });
        });
    }
    channel.subscribe((status) => console.log(`[Realtime] channel: ${status}`));
}

module.exports = { startRealtime, addClient };
