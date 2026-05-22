// ============================================
// INVOICE CONTROLLER
// Handle invoice (nota digital) CRUD
// ============================================

const db = require('../config/database');
const crypto = require('crypto');

/**
 * Generate invoice number: CP-YYYYMMDD-XXXX
 */
function generateInvoiceNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `CP-${date}-${rand}`;
}

/**
 * Generate unique public token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create invoice
 * POST /api/admin/invoices
 */
exports.createInvoice = async (req, res) => {
  try {
    const { customer_id, purchase_id, items, diskon, metode_pembayaran, catatan } = req.body;

    if (!customer_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'customer_id dan items wajib diisi' });
    }

    // Verify customer exists
    const { rows: customers } = await db.query('SELECT id, nama_lengkap, whatsapp FROM customers WHERE id = $1', [customer_id]);
    if (customers.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
    }

    const subtotal = items.reduce((sum, item) => sum + (Number(item.harga) || 0) * (Number(item.qty) || 1), 0);
    const totalDiskon = Number(diskon) || 0;
    const total = subtotal - totalDiskon;

    const invoice_number = generateInvoiceNumber();
    const token = generateToken();

    const { rows } = await db.query(
      `INSERT INTO invoices (invoice_number, token, customer_id, purchase_id, items, subtotal, diskon, total, metode_pembayaran, catatan)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [invoice_number, token, customer_id, purchase_id || null, JSON.stringify(items), subtotal, totalDiskon, total, metode_pembayaran || null, catatan || null]
    );

    res.json({
      success: true,
      data: rows[0],
      customer: customers[0]
    });

  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ success: false, message: 'Gagal membuat nota' });
  }
};

/**
 * List all invoices
 * GET /api/admin/invoices
 */
exports.getInvoices = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.nama_lengkap, c.whatsapp
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       ORDER BY i.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat nota' });
  }
};

/**
 * Get single invoice (admin)
 * GET /api/admin/invoices/:id
 */
exports.getInvoiceById = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.nama_lengkap, c.whatsapp, c.alamat
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Nota tidak ditemukan' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat nota' });
  }
};

/**
 * Delete invoice
 * DELETE /api/admin/invoices/:id
 */
exports.deleteInvoice = async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ success: false, message: 'Nota tidak ditemukan' });
    res.json({ success: true, message: 'Nota dihapus' });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus nota' });
  }
};

/**
 * Public view invoice by token (NO AUTH)
 * GET /api/nota/:token
 */
exports.getInvoicePublic = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.nama_lengkap, c.whatsapp, c.alamat
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.token = $1`,
      [req.params.token]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Nota tidak ditemukan' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Public invoice error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat nota' });
  }
};

/**
 * Create invoice from existing purchase
 * POST /api/admin/invoices/from-purchase
 */
exports.createFromPurchase = async (req, res) => {
  try {
    const { purchase_id, diskon, catatan } = req.body;

    if (!purchase_id) {
      return res.status(400).json({ success: false, message: 'purchase_id wajib diisi' });
    }

    const { rows: purchases } = await db.query(
      `SELECT p.*, c.nama_lengkap, c.whatsapp
       FROM purchases p
       JOIN customers c ON c.id = p.customer_id
       WHERE p.id = $1`,
      [purchase_id]
    );

    if (purchases.length === 0) {
      return res.status(404).json({ success: false, message: 'Pembelian tidak ditemukan' });
    }

    const p = purchases[0];
    const items = [{
      nama: [(p.merk_unit || ''), (p.tipe_unit || '')].filter(Boolean).join(' ') || 'Produk',
      qty: p.qty || 1,
      harga: Number(p.harga) || 0
    }];

    const subtotal = items[0].harga * items[0].qty;
    const totalDiskon = Number(diskon) || 0;
    const total = subtotal - totalDiskon;
    const invoice_number = generateInvoiceNumber();
    const token = generateToken();

    const { rows } = await db.query(
      `INSERT INTO invoices (invoice_number, token, customer_id, purchase_id, items, subtotal, diskon, total, metode_pembayaran, catatan)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [invoice_number, token, p.customer_id, purchase_id, JSON.stringify(items), subtotal, totalDiskon, total, p.metode_pembayaran || null, catatan || null]
    );

    res.json({
      success: true,
      data: rows[0],
      customer: { nama_lengkap: p.nama_lengkap, whatsapp: p.whatsapp }
    });

  } catch (error) {
    console.error('Create from purchase error:', error);
    res.status(500).json({ success: false, message: 'Gagal membuat nota' });
  }
};
