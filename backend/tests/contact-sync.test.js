const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { createHmac } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { ensureContactSchema } = require('../utils/contactSchema');
const { sanitizePhone } = require('../utils/phoneUtils');
const { formatContactDate, getCustomerContactName, getMessageDate } = require('../utils/contactUtils');

const PHONE = '6281234567890';
const FIRST_MESSAGE = '2026-10-28T15:59:59.000Z'; // 23:59:59 WITA
const FIRST_PURCHASE = '2026-10-29T15:59:59.000Z'; // Next day, 23:59:59 WITA
const BUYER_NAME = 'Amna Walangadi - 29/10/2026';
const silentConsole = { log() {}, warn() {}, error() {} };
const clone = value => structuredClone(value);

// Isolated dependencies: these tests never load credentials or contact live APIs.
function loadModule(relativePath, mocks) {
    const filename = path.resolve(__dirname, '..', relativePath);
    const module = { exports: {} };
    const realRequire = createRequire(filename);
    const load = name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name);
    const factory = vm.runInThisContext(
        '(function(require, module, exports, console, Date) {\n' + fs.readFileSync(filename, 'utf8') + '\n})',
        { filename }
    );
    factory(load, module, module.exports, silentConsole, mocks.Date || Date);
    return module.exports;
}

function customer(overrides = {}) {
    return {
        id: 1, whatsapp: PHONE, nama_lengkap: 'customer - 28/10/2026',
        tipe: 'Chat Only', status: 'New', source: 'WhatsApp',
        first_contact_at: new Date(FIRST_MESSAGE), last_incoming_message_at: new Date(FIRST_MESSAGE),
        first_purchase_at: overrides.tipe === 'Belanja' ? new Date(FIRST_PURCHASE) : null,
        google_contact_synced: false,
        ...overrides
    };
}

function contact(name, phone = '+62 812-3456-7890', resourceName = 'people/1') {
    return {
        resourceName, etag: 'person-1',
        names: name ? [{ givenName: name, displayName: name }] : [],
        phoneNumbers: [{ value: phone }],
        metadata: { sources: [
            { type: 'CONTACT', id: resourceName, etag: 'contact-1' },
            { type: 'PROFILE', id: 'profile-1', etag: 'profile-1' }
        ] }
    };
}

function fixture({ customers = [customer()], contacts = [], database, ...options } = {}) {
    const state = {
        customers: new Map(customers.map(c => [c.whatsapp, clone(c)])),
        contacts: new Map(contacts.map(c => [c.resourceName, clone(c)])),
        messages: [], purchases: [], queries: [], searches: [], updates: [],
        creates: 0, lists: 0, enqueues: 0, now: FIRST_PURCHASE, ...options
    };
    const db = database || {
        async query(sql, params = []) {
            state.queries.push({ sql, params: clone(params) });
            const row = state.customers.get(params[0]);
            if (sql.includes('SELECT 1 FROM messages')) {
                return { rows: state.messages.filter(m => m.id === params[0]) };
            }
            if (sql.includes('SELECT') && sql.includes('FROM app_settings')) return { rows: [] };
            if (sql.includes('SELECT') && sql.includes('FROM customers')) {
                return { rows: row ? [{ ...clone(row), latest_chat_at: clone(row.last_incoming_message_at) }] : [] };
            }
            if (sql.startsWith('UPDATE customers SET google_contact_synced = FALSE')) {
                for (const c of state.customers.values()) {
                    if (c.id === params[0]) c.google_contact_synced = false;
                }
            } else if (sql.startsWith('UPDATE customers SET google_contact_synced = TRUE')) {
                if (row && row.nama_lengkap === params[1] && row.tipe === params[2] &&
                    Number(row.last_incoming_message_at || 0) === Number(params[3] || 0) &&
                    Number(row.first_purchase_at || 0) === Number(params[4] || 0)) {
                    row.google_contact_synced = true;
                }
            } else if (sql.includes('UPDATE customers SET') && sql.includes('nama_lengkap = $1')) {
                const c = [...state.customers.values()].find(c => c.id === params[12]);
                Object.assign(c, {
                    nama_lengkap: params[0], tipe: 'Belanja', status: 'Completed',
                    alamat: params[7], google_contact_synced: false
                });
                c.first_purchase_at ||= new Date(params[13]);
                return { rows: [clone(c)] };
            } else if (sql.includes('INSERT INTO customers')) {
                // Both inserts must infer the partial unique index in migrate.js.
                assert.match(sql, /ON CONFLICT \(whatsapp\) WHERE whatsapp !~ '\^620\*\$'/);
                const isChat = sql.includes('last_incoming_message_at, created_at');
                const phone = isChat ? params[1] : params[8];
                const existing = state.customers.get(phone);
                const c = existing || customer({
                    id: state.customers.size + 1, whatsapp: phone,
                    nama_lengkap: params[0],
                    tipe: isChat ? 'Chat Only' : 'Belanja',
                    status: isChat ? 'New' : 'Completed',
                    first_contact_at: new Date(isChat ? params[3] : params[13]),
                    last_incoming_message_at: isChat ? new Date(params[3]) : null,
                    first_purchase_at: isChat ? null : new Date(params[13])
                });
                state.customers.set(phone, c);
                return { rows: [clone(c)] };
            } else if (sql.includes('INSERT INTO purchases')) {
                state.purchases.push({ id: state.purchases.length + 1, customer_id: params[0], created_at: params[9] });
                return { rows: [state.purchases.at(-1)] };
            } else if (sql.includes('INSERT INTO messages')) {
                state.messages.push({ id: params[3], customer_id: params[0], time: params[4] });
            } else if (sql.includes('last_incoming_message_at = GREATEST')) {
                const c = [...state.customers.values()].find(c =>
                    c.id === params[1]);
                if (c.tipe !== 'Belanja') c.status = params[0];
                const timestamp = new Date(params.at(-1));
                if (!c.last_incoming_message_at || timestamp > c.last_incoming_message_at) {
                    c.last_incoming_message_at = timestamp;
                }
                if (c.tipe === 'Chat Only') c.nama_lengkap = `customer - ${formatContactDate(c.last_incoming_message_at)}`;
                c.google_contact_synced = false;
                return { rows: [{ status: c.status }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
        }
    };

    async function beforeMutation() {
        if (state.beforeMutation) await state.beforeMutation();
        await new Promise(resolve => setImmediate(resolve));
    }
    const api = {
        async searchContacts(args) {
            state.searches.push(clone(args));
            if (state.failSearch) throw new Error('Search unavailable');
            return { data: { results: args.query && !state.staleSearch
                ? [...state.contacts.values()].map(person => ({ person: clone(person) })) : [] } };
        },
        connections: {
            async list() {
                state.lists++;
                return { data: { connections: [...state.contacts.values()].map(clone) } };
            }
        },
        async get({ resourceName }) {
            const person = state.contacts.get(resourceName);
            if (!person) throw Object.assign(new Error('Not found'), { code: 404 });
            return { data: clone(person) };
        },
        async createContact({ requestBody }) {
            await beforeMutation();
            state.creates++;
            const person = contact(requestBody.names[0].givenName,
                requestBody.phoneNumbers[0].value, 'people/new-' + state.creates);
            Object.assign(person, clone(requestBody));
            state.contacts.set(person.resourceName, person);
            return { data: clone(person) };
        },
        async updateContact(args) {
            await beforeMutation();
            if (state.failUpdate) throw new Error('Google update unavailable');
            const person = state.contacts.get(args.resourceName);
            const body = args.requestBody;
            assert.equal(body.etag, person.etag);
            assert.ok(body.metadata.sources.length > 0, 'CONTACT source metadata is required');
            assert.ok(body.metadata.sources.every(s => s.type === 'CONTACT'));
            assert.equal(body.metadata.sources[0].etag, person.metadata.sources[0].etag);
            for (const field of args.updatePersonFields.split(',')) {
                person[field] = clone(body[field]);
            }
            person.etag += '-updated';
            person.metadata.sources[0].etag += '-updated';
            state.updates.push(clone(args));
            return { data: clone(person) };
        }
    };
    const google = loadModule('config/google.js', {
        './database': db,
        'google-auth-library': { OAuth2Client: class {} },
        '@googleapis/people': { people: () => ({ people: api }) },
        dotenv: { config() {} }
    });
    google.getAuthenticatedClient = async () => state.disconnected ? null : {};
    const webhook = loadModule('controllers/webhookController.js', {
        '../config/database': db, '../config/google': google,
        '../config/csrfMiddleware': { safeEqual: (a, b) => a === b }
    });
    const form = loadModule('controllers/formController.js', {
        Date: class extends Date {
            constructor(...args) { super(...(args.length ? args : [state.now])); }
        },
        '../config/database': db, '../config/google': google,
        '../config/whatsapp': { async enqueueAutoReply() {
            state.enqueues++;
            return { success: true };
        } }
    });
    const receive = (id, timestamp = FIRST_MESSAGE) => webhook.handleIncomingMessage({
        sender: PHONE, message: 'Halo kak', pushname: 'Nama profil WA',
        wa_message_id: id, timestamp: Date.parse(timestamp) / 1000
    });
    const submit = async (name = 'Amna Walangadi', phone = '0812-3456-7890', fields = {}) => {
        let response;
        await form.submitForm({ body: {
            nama: name, whatsapp: phone, merk_unit: 'Samsung',
            tipe_unit: 'A55', harga: 5000000, ...fields
        } }, {
            status(code) { this.code = code; return this; },
            json(body) { response = body; }
        });
        assert.equal(response.success, true, JSON.stringify(response));
        return response;
    };
    const name = () => [...state.contacts.values()][0]?.names?.[0]?.givenName;
    return { state, db, api, google, webhook, receive, submit, name };
}

test('WITA date changes only at midnight in WITA', () => {
    assert.equal(formatContactDate('2026-10-28T15:59:59Z'), '28/10/2026');
    assert.equal(formatContactDate('2026-10-28T16:00:00Z'), '29/10/2026');
    assert.equal(formatContactDate('2026-10-28T00:30:00Z'), '28/10/2026');
});

test('contact date is independent of the server timezone', () => {
    const helper = path.resolve(__dirname, '../utils/contactUtils.js');
    const code = 'process.stdout.write(require(' + JSON.stringify(helper) +
        ').formatContactDate("2026-10-28T15:59:59Z"))';
    for (const TZ of ['UTC', 'Asia/Makassar', 'America/New_York']) {
        assert.equal(execFileSync(process.execPath, ['-e', code], {
            env: { ...process.env, TZ }, encoding: 'utf8'
        }), '28/10/2026');
    }
});

test('message timestamps accept seconds, milliseconds and ISO; bad values use receipt time', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    for (const timestamp of [Date.parse(FIRST_MESSAGE) / 1000, Date.parse(FIRST_MESSAGE), FIRST_MESSAGE]) {
        assert.equal(getMessageDate(timestamp, now).toISOString(), FIRST_MESSAGE);
    }
    for (const timestamp of [undefined, null, '', 'bad date', 0, -1, Infinity, '2099-01-01']) {
        assert.equal(getMessageDate(timestamp, now).toISOString(), now.toISOString());
    }
});

test('first chat, next-day chat, form submission and later chat keep one customer/contact', async () => {
    const f = fixture({ customers: [] });
    assert.equal((await f.receive('first')).success, true);
    await f.google._contactSyncQueue;
    assert.equal(f.name(), 'customer - 28/10/2026');
    assert.equal((await f.receive('tomorrow', '2026-10-29T10:00:00Z')).success, true);
    await f.google._contactSyncQueue;
    assert.equal(f.name(), 'customer - 29/10/2026');
    assert.equal(f.state.customers.get(PHONE).nama_lengkap, 'customer - 29/10/2026');
    const response = await f.submit('  Amna Walangadi  ', '+62 812 3456 7890');
    assert.equal(response.success, true);
    await f.google._contactSyncQueue;
    assert.equal(f.name(), BUYER_NAME);
    await f.receive('after-purchase', '2026-10-30T10:00:00Z');
    await f.google._contactSyncQueue;
    assert.equal(f.name(), BUYER_NAME);
    assert.equal(f.state.customers.size, 1);
    assert.equal(f.state.contacts.size, 1);
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.purchases.length, 1);
    assert.equal(f.state.enqueues, 1);
    assert.equal(f.state.customers.get(PHONE).tipe, 'Belanja');
    assert.equal(f.state.customers.get(PHONE).status, 'Completed');
    assert.equal(f.state.customers.get(PHONE).first_contact_at.toISOString(), FIRST_MESSAGE);
    assert.equal(f.state.messages[0].time, FIRST_MESSAGE);
});

test('a new form customer also uses the partial phone-number unique index', async () => {
    const f = fixture({ customers: [] });
    assert.equal((await f.submit()).success, true);
    await f.google._contactSyncQueue;
    assert.equal(f.name(), BUYER_NAME);
    assert.equal(f.state.customers.size, 1);
});

test('Google updates include fresh CONTACT source etags and keep other phone numbers', async () => {
    const existing = contact('customer - 29/10/2026');
    existing.phoneNumbers.push({ value: '+62 813 9999 0000' });
    const f = fixture({
        customers: [customer({ tipe: 'Belanja', nama_lengkap: 'Amna Walangadi' })],
        contacts: [existing]
    });
    assert.equal((await f.google.syncCustomerContactName('081234567890')).success, true);
    assert.equal(f.name(), BUYER_NAME);
    assert.equal(f.state.contacts.get('people/1').phoneNumbers.length, 2);
    assert.equal(f.state.creates, 0);
    assert.ok(!f.state.updates[0].updatePersonFields.includes('phoneNumbers'));
});

test('incoming chat renames an old saved contact even when previously marked synced', async () => {
    const f = fixture({
        customers: [customer({ google_contact_synced: true })],
        contacts: [contact('Ilyas')]
    });
    assert.equal((await f.receive('old-saved-contact')).success, true);
    await f.google._contactSyncQueue;
    assert.equal(f.name(), 'customer - 28/10/2026');
    assert.equal(f.state.creates, 0);
    assert.equal(f.state.customers.get(PHONE).google_contact_synced, true);
    assert.equal((await f.submit()).success, true);
    await f.google._contactSyncQueue;
    assert.equal(f.name(), BUYER_NAME);
});

test('an empty contact name is filled from the first chat date', async () => {
    const f = fixture({ contacts: [contact('')] });
    await f.google.syncCustomerContactName(PHONE);
    assert.equal(f.name(), 'customer - 28/10/2026');
});

test('an already named buyer keeps the form name when another chat arrives', async () => {
    const f = fixture({
        customers: [customer({ tipe: 'Belanja', nama_lengkap: 'Ilyas', google_contact_synced: true })],
        contacts: [contact('Ilyas - 29/10/2026')]
    });
    await f.receive('buyer-chat');
    await f.google._contactSyncQueue;
    assert.equal(f.name(), 'Ilyas - 29/10/2026');
    assert.ok(!f.state.updates[0].updatePersonFields.includes('names'));
    assert.equal(f.state.creates, 0);
});

test('full normalized numbers distinguish contacts sharing the last ten digits', async () => {
    const wrong = contact('Orang lain', '+6211234567890', 'people/wrong');
    const correct = contact('customer - 29/10/2026');
    const f = fixture({ contacts: [wrong, correct] });
    await f.google.syncCustomerContactName(PHONE);
    assert.equal(f.state.contacts.get('people/wrong').names[0].givenName, 'Orang lain');
    assert.equal(f.state.contacts.get('people/1').names[0].givenName, 'customer - 28/10/2026');
    assert.equal(f.state.searches[0].query, '');
});

test('a stale Google search falls back to connections instead of creating a duplicate', async () => {
    const f = fixture({ contacts: [contact('customer - 29/10/2026')], staleSearch: true });
    await f.google.syncCustomerContactName(PHONE);
    assert.equal(f.name(), 'customer - 28/10/2026');
    assert.equal(f.state.creates, 0);
    assert.equal(f.state.lists, 1);
});

test('contact-list fallback follows pagination before creating a contact', async () => {
    const f = fixture({ contacts: [contact('customer - 29/10/2026')], staleSearch: true });
    const pages = [];
    f.api.connections.list = async ({ pageToken }) => {
        pages.push(pageToken);
        return pageToken
            ? { data: { connections: [...f.state.contacts.values()].map(clone) } }
            : { data: { connections: [], nextPageToken: 'page-2' } };
    };
    assert.equal((await f.google.syncCustomerContactName(PHONE)).success, true);
    assert.deepEqual(pages, [undefined, 'page-2']);
    assert.equal(f.state.creates, 0);
    assert.equal(f.name(), 'customer - 28/10/2026');
});

test('failed Google search does not create a duplicate and remains retryable', async () => {
    const f = fixture({
        contacts: [contact('customer - 29/10/2026')],
        customers: [customer({ google_contact_synced: true })],
        failSearch: true
    });
    assert.equal((await f.google.syncCustomerContactName(PHONE)).success, false);
    assert.equal(f.state.creates, 0);
    assert.equal(f.state.customers.get(PHONE).google_contact_synced, false);
    f.state.failSearch = false;
    assert.equal((await f.google.saveContact({ whatsapp: PHONE })).success, true);
    assert.equal(f.state.customers.get(PHONE).google_contact_synced, true);
});

test('failed rename after form submission is pending and retry uses current form data', async () => {
    const f = fixture({ contacts: [contact('customer - 28/10/2026')], failUpdate: true });
    assert.equal((await f.submit()).success, true);
    await f.google._contactSyncQueue;
    assert.equal(f.state.customers.get(PHONE).google_contact_synced, false);
    f.state.failUpdate = false;
    const result = await f.google.saveContact({
        whatsapp: PHONE, nama_lengkap: 'Stale chat name', tipe: 'Chat Only'
    });
    assert.equal(result.success, true);
    assert.equal(f.name(), BUYER_NAME);
    assert.equal(f.state.customers.get(PHONE).google_contact_synced, true);
});

test('a chat sync in progress cannot overwrite a queued form name', async () => {
    let release, started;
    const blocked = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    let first = true;
    const f = fixture({ beforeMutation: async () => {
        if (first) { first = false; started(); await blocked; }
    } });
    const chatSync = f.google.syncCustomerContactName(PHONE);
    await entered;
    assert.equal((await f.submit()).success, true);
    release();
    await chatSync;
    await f.google._contactSyncQueue;
    assert.equal(f.name(), BUYER_NAME);
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.contacts.size, 1);
});

test('duplicate delivery is ignored and old deliveries do not move the latest-chat time back', async () => {
    const f = fixture();
    await f.receive('newer', '2026-10-30T10:00:00Z');
    await f.receive('older', FIRST_MESSAGE);
    assert.equal((await f.receive('newer', '2026-10-30T10:00:00Z')).duplicate, true);
    await f.google._contactSyncQueue;
    assert.equal(f.state.messages.length, 2);
    assert.equal(f.state.customers.get(PHONE).last_incoming_message_at.toISOString(),
        '2026-10-30T10:00:00.000Z');
    assert.equal(f.name(), 'customer - 30/10/2026');
});

test('placeholder numbers never create or update Google contacts', async () => {
    const f = fixture();
    assert.equal((await f.google.syncCustomerContactName('6200000000000')).skipped, true);
    assert.equal(f.state.searches.length, 0);
    assert.equal(f.state.creates, 0);
});

test('HTTP bridge webhook preserves the original message timestamp', async () => {
    const f = fixture({ customers: [] });
    const previous = process.env.WA_BRIDGE_SECRET;
    process.env.WA_BRIDGE_SECRET = 'test-bridge-secret';
    try {
        let response;
        await f.webhook.handleWhatsAppWebhook({
            headers: { 'x-wa-secret': 'test-bridge-secret' },
            body: { source: 'wa-bridge', sender: PHONE, message: 'Halo',
                timestamp: Date.parse(FIRST_MESSAGE) / 1000, wa_message_id: 'http-1' }
        }, { json(body) { response = body; } });
        assert.equal(response.success, true);
        await f.google._contactSyncQueue;
        assert.equal(f.name(), 'customer - 28/10/2026');
        assert.equal(f.state.messages[0].time, FIRST_MESSAGE);
    } finally {
        if (previous === undefined) delete process.env.WA_BRIDGE_SECRET;
        else process.env.WA_BRIDGE_SECRET = previous;
    }
});

test('Meta webhook preserves the original message timestamp', async () => {
    const f = fixture({ customers: [] });
    const previous = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = 'test-meta-secret';
    try {
        const body = { entry: [{ changes: [{ value: {
            contacts: [{ profile: { name: 'Nama profil WA' } }],
            messages: [{
                type: 'text', from: PHONE, text: { body: 'Halo' }, id: 'meta-1',
                timestamp: String(Date.parse(FIRST_MESSAGE) / 1000)
            }]
        } }] }] };
        const rawBody = Buffer.from(JSON.stringify(body));
        const signature = 'sha256=' + createHmac('sha256', 'test-meta-secret')
            .update(rawBody).digest('hex');
        let status;
        await f.webhook.handleMetaWebhook({
            body, rawBody, headers: { 'x-hub-signature-256': signature }
        }, { sendStatus(code) { status = code; } });
        assert.equal(status, 200);
        await f.google._contactSyncQueue;
        assert.equal(f.name(), 'customer - 28/10/2026');
        assert.equal(f.state.messages[0].time, FIRST_MESSAGE);
    } finally {
        if (previous === undefined) delete process.env.META_APP_SECRET;
        else process.env.META_APP_SECRET = previous;
    }
});

test('admin retry reports an unsuccessful Google update as failed', async () => {
    const controller = loadModule('controllers/googleController.js', {
        '../config/database': { async query() {
            return { rows: [{ id: 1, nama_lengkap: 'Amna', whatsapp: PHONE }] };
        } },
        '../config/google': {
            async isConnected() { return true; },
            async saveContact() { return { success: false, error: 'Google update unavailable' }; }
        }
    });
    let response;
    await controller.resync({}, { json(body) { response = body; } });
    assert.equal(response.failed, 1);
    assert.equal(response.saved, 0);
    assert.equal(response.skipped, 0);
    assert.equal(response.errors[0].error, 'Google update unavailable');
});

for (const { label, body, expectedSaved } of [
    { label: 'default retry excludes contacts previously marked synced', body: undefined, expectedSaved: 0 },
    { label: 'full resync repairs contacts previously marked synced', body: { all: true }, expectedSaved: 1 },
    { label: 'full resync requires an explicit boolean', body: { all: 'true' }, expectedSaved: 0 }
]) {
    test(label, async () => {
        // A legacy contact that the old name-preservation rule marked as synced.
        const f = fixture({
            customers: [customer({ google_contact_synced: true })],
            contacts: [contact('Ilyas')]
        });
        const controller = loadModule('controllers/googleController.js', {
            '../config/database': { async query(sql) {
                assert.match(sql, /whatsapp !~ '\^620\*\$'/);
                const pendingOnly = sql.includes('google_contact_synced = FALSE');
                return { rows: [...f.state.customers.values()].filter(c =>
                    !pendingOnly || c.google_contact_synced !== true) };
            } },
            '../config/google': f.google
        });
        f.google.isConnected = async () => true;
        let response;
        await controller.resync({ body }, { json(result) { response = result; } });
        assert.equal(response.success, true);
        assert.equal(response.saved, expectedSaved);
        assert.equal(response.total, expectedSaved);
        assert.equal(f.name(), expectedSaved ? 'customer - 28/10/2026' : 'Ilyas');
        assert.equal(f.state.creates, 0);
    });
}

test('the requested November examples use latest chat for leads and first purchase for buyers', () => {
    const c = customer({ latest_chat_at: '2026-11-18T04:00:00Z' });
    assert.equal(getCustomerContactName(c), 'customer - 18/11/2026');
    c.latest_chat_at = '2026-11-19T04:00:00Z';
    assert.equal(getCustomerContactName(c), 'customer - 19/11/2026');
    Object.assign(c, { tipe: 'Belanja', nama_lengkap: 'budi', first_purchase_at: '2026-11-18T04:00:00Z' });
    assert.equal(getCustomerContactName(c), 'budi - 18/11/2026');
    c.latest_chat_at = '2026-11-21T04:00:00Z';
    assert.equal(getCustomerContactName(c), 'budi - 18/11/2026');
});

test('missing buyer dates fail instead of silently naming a contact with today or 1970', async () => {
    const f = fixture({ customers: [customer({ tipe: 'Belanja', nama_lengkap: 'Budi', first_purchase_at: null })] });
    assert.equal((await f.google.syncCustomerContactName(PHONE)).success, false);
    assert.equal(f.state.creates, 0);
    assert.equal(f.state.customers.get(PHONE).google_contact_synced, false);
});

test('repeat form submissions keep the original purchase date', async () => {
    const f = fixture();
    await f.submit('Budi');
    await f.google._contactSyncQueue;
    assert.equal(f.name(), 'Budi - 29/10/2026');
    f.state.now = '2026-11-01T16:00:00Z';
    await f.submit('Budi');
    await f.google._contactSyncQueue;
    assert.equal(f.name(), 'Budi - 29/10/2026');
    assert.equal(f.state.customers.get(PHONE).first_purchase_at.toISOString(), FIRST_PURCHASE);
    assert.equal(f.state.purchases.length, 2);
});

// Execute the real application SQL against an isolated PostgreSQL engine. Only
// Google/WhatsApp are mocked, so casts, upserts and migrations are actually tested.
async function postgresFixture(t, { migrate = true } = {}) {
    const db = new PGlite();
    t.after(() => db.close());
    const migration = fs.readFileSync(path.resolve(__dirname, '../migrate.js'), 'utf8');
    for (const table of ['customers', 'messages', 'purchases']) {
        const ddl = migration.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n        \\)`));
        assert.ok(ddl, `production schema for ${table}`);
        await db.exec(ddl[0]);
    }
    await db.exec(`
        ALTER TABLE customers ADD COLUMN tipe VARCHAR(20) DEFAULT 'Belanja';
        ALTER TABLE customers ADD COLUMN last_incoming_message_at TIMESTAMP;
        ALTER TABLE customers ADD COLUMN google_contact_synced BOOLEAN DEFAULT FALSE;
        ALTER TABLE customers ADD COLUMN wa_sent BOOLEAN DEFAULT NULL;
        ALTER TABLE purchases ADD COLUMN wa_auto_dispatch BOOLEAN DEFAULT NULL;
        ALTER TABLE purchases ADD COLUMN wa_enqueued BOOLEAN DEFAULT FALSE;
        ALTER TABLE messages ADD COLUMN wa_message_id VARCHAR(100);
        CREATE UNIQUE INDEX uq_customers_whatsapp_real ON customers (whatsapp) WHERE whatsapp !~ '^620*$';
        CREATE UNIQUE INDEX idx_msg_wa_message_id ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
    `);
    if (migrate) await ensureContactSchema(db);
    return db;
}

test('PostgreSQL: chat rollover and first purchase at 23:59 WITA work in different DB timezones', async t => {
    const db = await postgresFixture(t);
    for (const zone of ['UTC', 'Asia/Makassar', 'Pacific/Auckland', 'America/Los_Angeles']) {
        await db.exec(`SET TIME ZONE '${zone}'; TRUNCATE customers RESTART IDENTITY CASCADE;`);
        const f = fixture({ database: db, customers: [] });
        await f.receive('before-midnight', '2026-10-28T15:59:59Z');
        await f.google._contactSyncQueue;
        assert.equal(f.name(), 'customer - 28/10/2026', zone);
        await f.receive('at-midnight', '2026-10-28T16:00:00Z');
        await f.google._contactSyncQueue;
        assert.equal(f.name(), 'customer - 29/10/2026', zone);
        await f.receive('late-old-message', '2026-10-28T15:59:58Z');
        await f.google._contactSyncQueue;
        assert.equal(f.name(), 'customer - 29/10/2026', zone);
        assert.equal((await db.query('SELECT nama_lengkap FROM customers')).rows[0].nama_lengkap, f.name());
        await f.submit('Budi'); // FIRST_PURCHASE is 23:59:59 on 29 October WITA.
        await f.google._contactSyncQueue;
        assert.equal(f.name(), 'Budi - 29/10/2026', zone);
        f.state.now = '2026-10-29T16:00:00Z';
        await f.submit('Budi'); // Repeat purchase at 00:00 the following day.
        await f.google._contactSyncQueue;
        await f.receive('three-days-later', '2026-11-01T04:00:00Z');
        await f.google._contactSyncQueue;
        assert.equal(f.name(), 'Budi - 29/10/2026', zone);
        const c = (await db.query('SELECT * FROM customers')).rows[0];
        assert.equal(c.first_purchase_at.toISOString(), FIRST_PURCHASE, zone);
        assert.equal(c.nama_lengkap, 'Budi'); // Plain name remains suitable for message greetings.
        assert.equal(c.google_contact_synced, true, zone);
        assert.equal(f.state.creates, 1, zone);
    }
});

test('PostgreSQL: first form date survives no product, repeat forms, history deletion and restart', async t => {
    const db = await postgresFixture(t);
    const f = fixture({ database: db, customers: [] });
    await f.submit('Budi', PHONE, { merk_unit: '', tipe_unit: '', harga: null });
    await f.google._contactSyncQueue;
    assert.equal(f.name(), 'Budi - 29/10/2026');
    assert.equal((await db.query('SELECT * FROM purchases')).rows.length, 0);
    // Force a stale form lookup to exercise the real ON CONFLICT branch.
    const realQuery = db.query.bind(db);
    db.query = (sql, params) => sql.includes('SELECT id FROM customers WHERE whatsapp')
        ? Promise.resolve({ rows: [] }) : realQuery(sql, params);
    f.state.now = '2026-11-01T04:00:00Z';
    await f.submit('Budi');
    await f.google._contactSyncQueue;
    db.query = realQuery;
    await db.exec('DELETE FROM purchases');
    await ensureContactSchema(db);
    const restarted = fixture({ database: db, contacts: [...f.state.contacts.values()] });
    assert.equal((await restarted.google.syncCustomerContactName(PHONE)).success, true);
    assert.equal(restarted.name(), 'Budi - 29/10/2026');
});

test('PostgreSQL: migration recovers earliest purchase date and never resets an established date', async t => {
    const db = await postgresFixture(t, { migrate: false });
    await db.exec(`
        SET TIME ZONE 'Pacific/Auckland';
        INSERT INTO customers (nama_lengkap, whatsapp, tipe, created_at) VALUES
            ('Budi', '${PHONE}', 'Belanja', '2026-10-20 10:00:00'),
            ('Legacy buyer', '6281399999999', 'Belanja', '2026-10-21 15:59:59'),
            ('Lead', '6281499999999', 'Chat Only', '2026-10-22 10:00:00');
        INSERT INTO purchases (customer_id, created_at) VALUES (1, '2026-10-30 16:00:00'), (1, '2026-10-29 15:59:59');
    `);
    await ensureContactSchema(db);
    let rows = (await db.query('SELECT * FROM customers ORDER BY id')).rows;
    assert.equal(rows[0].first_purchase_at.toISOString(), FIRST_PURCHASE);
    assert.equal(rows[1].first_purchase_at.toISOString(), '2026-10-21T15:59:59.000Z');
    assert.equal(rows[2].first_purchase_at, null);
    await db.exec("DELETE FROM purchases; SET TIME ZONE 'America/Los_Angeles';");
    await ensureContactSchema(db);
    rows = (await db.query('SELECT * FROM customers ORDER BY id')).rows;
    assert.equal(rows[0].first_purchase_at.toISOString(), FIRST_PURCHASE);
});

test('PostgreSQL: a chat already in progress cannot overwrite a concurrent form name or status', async t => {
    const db = await postgresFixture(t);
    const f = fixture({ database: db, customers: [] });
    await f.receive('initial');
    await f.google._contactSyncQueue;
    let release, entered;
    const blocked = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const realQuery = db.query.bind(db);
    db.query = async (sql, params) => {
        if (sql.includes('UPDATE customers SET status = CASE')) {
            entered();
            await blocked;
        }
        return realQuery(sql, params);
    };
    const chat = f.receive('concurrent-chat', '2026-10-30T04:00:00Z');
    await started;
    try { await f.submit('Budi'); } finally { release(); }
    assert.equal((await chat).success, true);
    await f.google._contactSyncQueue;
    assert.equal(f.name(), 'Budi - 29/10/2026');
    const c = (await db.query('SELECT * FROM customers')).rows[0];
    assert.equal(c.nama_lengkap, 'Budi');
    assert.equal(c.status, 'Completed');
    assert.equal(c.first_purchase_at.toISOString(), FIRST_PURCHASE);
});

test('PostgreSQL + admin UI: full resync follows cursors and repairs every old saved contact', async t => {
    const db = await postgresFixture(t);
    const contacts = [];
    for (let id = 1; id <= 6; id++) {
        const phone = '628123456780' + id;
        await db.query(`
            INSERT INTO customers (nama_lengkap, whatsapp, tipe, created_at, last_incoming_message_at, google_contact_synced)
            VALUES ('customer - 28/10/2026', $1, 'Chat Only', '2026-10-28 15:59:59', '2026-10-29 04:00:00', TRUE)
        `, [phone]);
        contacts.push(contact('Old saved name', phone, 'people/' + id));
    }
    const f = fixture({ database: db, contacts });
    f.google.isConnected = async () => true;
    const controller = loadModule('controllers/googleController.js', {
        '../config/database': db, '../config/google': f.google
    });
    const elements = Object.fromEntries(['googleResyncBtn', 'googleResyncAllBtn', 'googleResyncResult'].map(id =>
        [id, { textContent: id, disabled: false, style: {} }]));
    const bodies = [];
    const context = {
        window: {}, confirm: () => true,
        document: { getElementById: id => elements[id] },
        apiCall: async (endpoint, options) => {
            assert.equal(endpoint, '/google/resync');
            const body = JSON.parse(options.body);
            bodies.push(body);
            let response;
            await controller.resync({ body }, { json(data) { response = data; } });
            return response;
        }
    };
    const admin = fs.readFileSync(path.resolve(__dirname, '../../admin/admin.js'), 'utf8');
    const start = admin.indexOf('    window.resyncGoogleContacts =');
    const end = admin.indexOf('    // Check for Google OAuth redirect result', start);
    vm.runInNewContext(admin.slice(start, end), context);
    await context.window.resyncGoogleContacts(true);
    assert.deepEqual(bodies, [{ all: true, afterId: 0 }, { all: true, afterId: 5 }]);
    assert.equal(f.state.updates.length, 6);
    assert.ok([...f.state.contacts.values()].every(c => c.names[0].givenName === 'customer - 29/10/2026'));
    assert.match(elements.googleResyncResult.textContent, /6 tersimpan, 0 gagal/);
    assert.equal(elements.googleResyncAllBtn.disabled, false);
    assert.equal(elements.googleResyncBtn.disabled, false);
    assert.equal(elements.googleResyncAllBtn.textContent, 'googleResyncAllBtn');
    // A disconnected account must be shown as failure, not as a successful resync.
    context.apiCall = async () => ({ success: false, error: 'Google Contacts not connected' });
    await context.window.resyncGoogleContacts(true);
    assert.match(elements.googleResyncResult.textContent, /Gagal re-sync: Google Contacts not connected/);
    assert.equal(elements.googleResyncAllBtn.disabled, false);
});
