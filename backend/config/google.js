// ============================================
// GOOGLE CONTACTS SERVICE
// OAuth 2.0 + People API for auto-saving contacts
// ============================================

const { OAuth2Client } = require('google-auth-library');
const { people: peopleApi } = require('@googleapis/people');
const db = require('./database');
const { sanitizePhone, validatePhone } = require('../utils/phoneUtils');
const { formatContactDate } = require('../utils/contactUtils');
require('dotenv').config();

class GoogleContactsService {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI;
        this._invalidGrantAt = null;
        // People API mutations for the connected account must run sequentially.
        this._contactSyncQueue = Promise.resolve();
        this._recentContacts = new Map();
    }

    getOAuth2Client() {
        return new OAuth2Client(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );
    }

    getAuthUrl() {
        const oauth2Client = this.getOAuth2Client();
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/contacts'
            ]
        });
    }

    async handleCallback(code) {
        const oauth2Client = this.getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        await db.query(`
            CREATE TABLE IF NOT EXISTS google_tokens (
                id SERIAL PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expiry_date BIGINT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await db.query('DELETE FROM google_tokens');
        await db.query(
            `INSERT INTO google_tokens (access_token, refresh_token, expiry_date) VALUES ($1, $2, $3)`,
            [tokens.access_token, tokens.refresh_token, tokens.expiry_date]
        );

        this._invalidGrantAt = null;
        this._recentContacts.clear();
        return tokens;
    }

    async getAuthenticatedClient() {
        if (this._invalidGrantAt && (Date.now() - this._invalidGrantAt < 10 * 60 * 1000)) {
            return null;
        }

        const result = await db.query('SELECT * FROM google_tokens ORDER BY id DESC LIMIT 1');
        if (result.rows.length === 0) return null;

        const token = result.rows[0];
        const oauth2Client = this.getOAuth2Client();
        oauth2Client.setCredentials({
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expiry_date: parseInt(token.expiry_date)
        });

        oauth2Client.on('tokens', async (newTokens) => {
            const updates = [newTokens.access_token, newTokens.expiry_date];
            if (newTokens.refresh_token) {
                await db.query(
                    `UPDATE google_tokens SET access_token = $1, refresh_token = $2, expiry_date = $3, updated_at = NOW()`,
                    [newTokens.access_token, newTokens.refresh_token, newTokens.expiry_date]
                );
            } else {
                await db.query(
                    `UPDATE google_tokens SET access_token = $1, expiry_date = $2, updated_at = NOW()`,
                    updates
                );
            }
        });

        try {
            await oauth2Client.getAccessToken();
        } catch (err) {
            if (err.message?.includes('invalid_grant') || err.response?.data?.error === 'invalid_grant') {
                console.error('🔑 Google token expired/revoked — clearing tokens. Please re-authenticate via /api/google/auth');
                this._invalidGrantAt = Date.now();
                await db.query('DELETE FROM google_tokens').catch(() => {});
                return null;
            }
            throw err;
        }

        this._invalidGrantAt = null;
        return oauth2Client;
    }

    async isConnected() {
        try {
            if (this._invalidGrantAt && (Date.now() - this._invalidGrantAt < 10 * 60 * 1000)) {
                return false;
            }
            const result = await db.query('SELECT * FROM google_tokens ORDER BY id DESC LIMIT 1');
            return result.rows.length > 0 && !!result.rows[0].refresh_token;
        } catch {
            return false;
        }
    }

    /**
     * Match the complete normalized number, never just its last digits.
     * Search uses a cache, so warm it first and fall back to the contact list
     * before deciding to create a new person.
     */
    async findContactByPhone(people, phone) {
        const cleanPhone = sanitizePhone(phone);
        if (!validatePhone(cleanPhone).valid || /^620*$/.test(cleanPhone)) return null;
        const personFields = 'names,phoneNumbers,metadata';
        const matches = person => (person?.phoneNumbers || []).some(p =>
            [p.canonicalForm, p.value].some(value => value && sanitizePhone(value) === cleanPhone)
        );

        const recent = this._recentContacts.get(cleanPhone);
        if (recent && Date.now() - recent.savedAt < 5 * 60 * 1000) {
            try {
                const { data } = await people.people.get({
                    resourceName: recent.resourceName, personFields
                });
                if (matches(data)) return data;
            } catch (err) {
                if ((err.response?.status || err.code) !== 404) throw err;
            }
        }
        this._recentContacts.delete(cleanPhone);

        // A failed search must propagate: treating it as "not found" creates duplicates.
        await people.people.searchContacts({ query: '', readMask: personFields });
        const queries = ['+' + cleanPhone, cleanPhone, '0' + cleanPhone.slice(2)];
        for (const query of queries) {
            const res = await people.people.searchContacts({
                query, readMask: personFields, pageSize: 30
            });
            const match = (res.data.results || []).map(r => r.person).find(matches);
            if (match) return match;
        }

        let pageToken;
        do {
            const { data } = await people.people.connections.list({
                resourceName: 'people/me', personFields, pageSize: 1000,
                ...(pageToken ? { pageToken } : {})
            });
            const match = (data.connections || []).find(matches);
            if (match) return match;
            pageToken = data.nextPageToken;
        } while (pageToken);
        return null;
    }

    async findContactByPhoneNumber(phone) {
        const auth = await this.getAuthenticatedClient();
        if (!auth) return null;
        return this.findContactByPhone(peopleApi({ version: 'v1', auth }), phone);
    }

    _isPlaceholderName(name) {
        if (!name || typeof name !== 'string') return false;
        return /^.+\s*-\s*\d{2}\/\d{2}\/\d{4}$/i.test(name.trim()) ||
            /^customer$/i.test(name.trim());
    }

    isPlaceholderName(name) {
        return this._isPlaceholderName(name);
    }

    /**
     * All callers (incoming chat, form submission, and retry) use current DB data.
     * Chat Only keeps the first contact date. Belanja uses the submitted name.
     */
    syncCustomerContactName(phone) {
        const cleanPhone = sanitizePhone(phone);
        const run = () => this._syncCustomerContactName(cleanPhone);
        const pending = this._contactSyncQueue.then(run, run);
        this._contactSyncQueue = pending.catch(() => {});
        return pending;
    }

    async _syncCustomerContactName(phone) {
        if (!validatePhone(phone).valid || /^620*$/.test(phone)) {
            return { success: false, skipped: true, error: 'Invalid phone number' };
        }

        try {
            const { rows } = await db.query(
                `SELECT id, tipe, nama_lengkap, whatsapp, alamat, source,
                        merk_unit, tipe_unit, metode_pembayaran,
                        created_at AT TIME ZONE 'UTC' AS first_contact_at
                 FROM customers WHERE whatsapp = $1 ORDER BY created_at ASC LIMIT 1`,
                [phone]
            );
            if (rows.length === 0) return { success: false, skipped: true, error: 'Customer not found' };
            const customer = rows[0];
            await db.query('UPDATE customers SET google_contact_synced = FALSE WHERE id = $1', [customer.id]);
            const isBuyer = customer.tipe === 'Belanja';
            const firstDate = formatContactDate(customer.first_contact_at);
            const desiredName = isBuyer
                ? customer.nama_lengkap.trim()
                : `customer - ${firstDate}`;

            const auth = await this.getAuthenticatedClient();
            if (!auth) return { success: false, error: 'Not connected' };
            const people = peopleApi({ version: 'v1', auth });
            const existing = await this.findContactByPhone(people, phone);
            const notes = [`Tipe: ${customer.tipe}`, `Kontak pertama: ${firstDate}`];
            if (customer.merk_unit) notes.push(`Merk: ${customer.merk_unit}`);
            if (customer.tipe_unit) notes.push(`Unit: ${customer.tipe_unit}`);
            if (customer.metode_pembayaran) notes.push(`Bayar: ${customer.metode_pembayaran}`);
            if (customer.source) notes.push(`Dari: ${customer.source}`);
            const biographies = [{
                value: `[Cahaya Phone]\n${notes.join('\n')}`,
                contentType: 'TEXT_PLAIN'
            }];

            let result;
            let action;
            if (!existing?.resourceName) {
                const contactData = {
                    names: [{ givenName: desiredName }],
                    phoneNumbers: [{ value: '+' + phone, type: 'mobile' }],
                    biographies
                };
                if (customer.alamat) {
                    contactData.addresses = [{ formattedValue: customer.alamat, type: 'home' }];
                }
                result = await people.people.createContact({ requestBody: contactData });
                action = 'created';
            } else {
                // Fresh CONTACT source etags are required by updateContact.
                const { data: current } = await people.people.get({
                    resourceName: existing.resourceName,
                    personFields: 'names,phoneNumbers,metadata'
                });
                const existingName = current.names?.[0]?.displayName || current.names?.[0]?.givenName || '';
                // A form submission is authoritative for this number. Incoming chat
                // alone preserves human-given names in the phone's address book.
                const canUpdateName = isBuyer || !existingName || this._isPlaceholderName(existingName);
                const requestBody = {
                    etag: current.etag,
                    metadata: {
                        sources: (current.metadata?.sources || []).filter(source => source.type === 'CONTACT')
                    },
                    biographies
                };
                const fields = ['biographies'];
                if (canUpdateName && existingName !== desiredName) {
                    requestBody.names = [{ givenName: desiredName }];
                    fields.push('names');
                }
                if (customer.alamat) {
                    requestBody.addresses = [{ formattedValue: customer.alamat, type: 'home' }];
                    fields.push('addresses');
                }
                result = await people.people.updateContact({
                    resourceName: existing.resourceName,
                    updatePersonFields: fields.join(','),
                    requestBody
                });
                action = canUpdateName ? 'updated' : 'preserved';
            }

            const resourceName = result.data.resourceName;
            this._recentContacts.set(phone, { resourceName, savedAt: Date.now() });
            if (this._recentContacts.size > 1000) {
                this._recentContacts.delete(this._recentContacts.keys().next().value);
            }
            await this._markSynced(phone, customer);
            console.log(`[CONTACT] ${action}: ${desiredName}`);
            return { success: true, resourceName, action };
        } catch (err) {
            console.error('[CONTACT] sync failed:', err.message);
            return { success: false, error: err.message };
        }
    }

    // Retry follows the same naming rules, using fresh customer data.
    async saveContact(customer) {
        return this.syncCustomerContactName(customer.whatsapp);
    }

    async _markSynced(phone, customer) {
        await db.query(
            `UPDATE customers SET google_contact_synced = TRUE
             WHERE whatsapp = $1 AND nama_lengkap = $2 AND tipe = $3`,
            [sanitizePhone(phone), customer.nama_lengkap, customer.tipe]
        );
    }

    async disconnect() {
        this._recentContacts.clear();
        try {
            const auth = await this.getAuthenticatedClient();
            if (auth) {
                await auth.revokeCredentials().catch(() => {});
            }
            await db.query('DELETE FROM google_tokens');
            return { success: true };
        } catch (error) {
            await db.query('DELETE FROM google_tokens').catch(() => {});
            return { success: true };
        }
    }
}

module.exports = new GoogleContactsService();
