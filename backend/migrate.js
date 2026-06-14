  const { Client } = require('pg');
  require('dotenv').config();

  async function migrate() {
    console.log('🚀 Starting database migration (PostgreSQL)...');

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
      await client.connect();
      console.log('✅ Connected to database');

      // Buat tabel admins
      console.log('Creating table: admins...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          nama VARCHAR(100) NOT NULL,
          email VARCHAR(255) UNIQUE DEFAULT NULL,
          role VARCHAR(20) NOT NULL DEFAULT 'staff',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Backfill role column for existing installations (idempotent)
      await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'staff'`);
      // Ensure UNIQUE on email (skip if already exists)
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'admins_email_unique_idx') THEN
            CREATE UNIQUE INDEX admins_email_unique_idx ON admins (LOWER(email)) WHERE email IS NOT NULL;
          END IF;
        END $$;
      `);
      console.log('✅ Table admins created/verified');

      // Buat tabel admin_reset_tokens
      console.log('Creating table: admin_reset_tokens...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_reset_tokens (
          id SERIAL PRIMARY KEY,
          admin_id INT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
          token VARCHAR(128) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          used BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Table admin_reset_tokens created/verified');

      // Buat tabel customers
      console.log('Creating table: customers...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS customers (
          id SERIAL PRIMARY KEY,
          nama_lengkap VARCHAR(100) NOT NULL,
          nama_sales VARCHAR(100),
          merk_unit VARCHAR(100),
          tipe_unit VARCHAR(100),
          harga NUMERIC(15,2),
          qty INT DEFAULT 1,
          tanggal_lahir DATE,
          alamat TEXT,
          whatsapp VARCHAR(20) NOT NULL,
          metode_pembayaran VARCHAR(50),
          tahu_dari VARCHAR(50),
          source VARCHAR(20) NOT NULL DEFAULT 'Unknown',
          status VARCHAR(20) DEFAULT 'New',
          opted_in BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp ON customers (whatsapp)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_source ON customers (source)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_status ON customers (status)`);
      console.log('✅ Table customers created/verified');

      // Buat tabel messages
      console.log('Creating table: messages...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          direction VARCHAR(3) CHECK (direction IN ('in', 'out')) NOT NULL,
          message TEXT NOT NULL,
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_msg_customer ON messages (customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_msg_direction ON messages (direction)`);
      console.log('✅ Table messages created/verified');

      // Buat tabel purchases (riwayat pembelian)
      console.log('Creating table: purchases...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS purchases (
          id SERIAL PRIMARY KEY,
          customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          merk_unit VARCHAR(100),
          tipe_unit VARCHAR(100),
          harga NUMERIC(15,2),
          qty INT DEFAULT 1,
          nama_sales VARCHAR(100),
          metode_pembayaran VARCHAR(50),
          source VARCHAR(20) DEFAULT 'Website',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_purchases_customer ON purchases (customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_purchases_merk ON purchases (merk_unit)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases (created_at)`);
      console.log('✅ Table purchases created/verified');

      await client.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS wa_auto_dispatch BOOLEAN DEFAULT NULL`);
      await client.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS wa_enqueued BOOLEAN DEFAULT FALSE`);

      // Buat tabel invoices (nota digital)
      console.log('Creating table: invoices...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS invoices (
          id SERIAL PRIMARY KEY,
          invoice_number VARCHAR(50) UNIQUE NOT NULL,
          token VARCHAR(64) UNIQUE NOT NULL,
          customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          purchase_id INT REFERENCES purchases(id) ON DELETE SET NULL,
          items JSONB NOT NULL DEFAULT '[]',
          subtotal NUMERIC(15,2) DEFAULT 0,
          diskon NUMERIC(15,2) DEFAULT 0,
          total NUMERIC(15,2) DEFAULT 0,
          metode_pembayaran VARCHAR(50),
          catatan TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_token ON invoices (token)`);
      console.log('✅ Table invoices created/verified');

      // ============================================
      // CLEANUP: Hapus duplikat & nomor WA internal tidak valid
      // ============================================
      console.log('Cleaning up invalid & duplicate customers...');

      // Hapus customer dengan nomor WA internal (bukan nomor Indonesia valid)
      // Nomor valid Indonesia: 62xxx, panjang 11-15 digit
      const { rows: invalidRows } = await client.query(`
        DELETE FROM customers
        WHERE whatsapp !~ '^62[0-9]{9,13}$'
          AND tipe = 'Chat Only'
        RETURNING id, nama_lengkap, whatsapp
      `);
      if (invalidRows.length > 0) {
        console.log(`  Removed ${invalidRows.length} Chat Only records with invalid phone numbers`);
        invalidRows.forEach(r => console.log(`    - #${r.id} ${r.nama_lengkap} (${r.whatsapp})`));
      }

      // Hapus duplikat: keep record terlama (atau yang tipe='Belanja'), hapus sisanya
      const { rows: dupRows } = await client.query(`
        DELETE FROM customers
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY whatsapp
                ORDER BY
                  CASE WHEN tipe = 'Belanja' THEN 0 ELSE 1 END,
                  created_at ASC
              ) as rn
            FROM customers
            -- Only de-dupe REAL numbers. Placeholder numbers ("62" + only zeros,
            -- used for walk-in customers without WhatsApp) are NOT a shared identity
            -- and must never be merged/deleted as duplicates.
            WHERE whatsapp !~ '^620*$'
          ) ranked
          WHERE rn > 1
        )
        RETURNING id, nama_lengkap, whatsapp
      `);
      if (dupRows.length > 0) {
        console.log(`  Removed ${dupRows.length} duplicate records (kept oldest/Belanja)`);
        dupRows.forEach(r => console.log(`    - #${r.id} ${r.nama_lengkap} (${r.whatsapp})`));
      }

      // UNIQUE on whatsapp — but ONLY for real numbers. Placeholder numbers
      // ("62" followed by only zeros) are entered for walk-in customers without a
      // WhatsApp; two different no-phone customers may share the same dummy and must
      // NOT collide. So we drop the old all-rows constraint and enforce uniqueness
      // via a PARTIAL unique index that skips placeholders.
      await client.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_customers_whatsapp') THEN
            ALTER TABLE customers DROP CONSTRAINT uq_customers_whatsapp;
          END IF;
        END $$
      `);
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_whatsapp_real
         ON customers (whatsapp) WHERE whatsapp !~ '^620*$'`
      );
      console.log('✅ Partial unique index on real whatsapp numbers verified (placeholders allowed to repeat)');

      // Ensure last_incoming_message_at column (for fast 24h window check)
      console.log('Ensuring last_incoming_message_at column...');
      await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_incoming_message_at TIMESTAMP`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_last_msg ON customers (last_incoming_message_at) WHERE last_incoming_message_at IS NOT NULL`);
      // Backfill from messages table
      await client.query(`
        UPDATE customers c SET last_incoming_message_at = sub.last_msg
        FROM (
          SELECT customer_id, MAX(sent_at) as last_msg
          FROM messages WHERE direction = 'in'
          GROUP BY customer_id
        ) sub
        WHERE c.id = sub.customer_id AND c.last_incoming_message_at IS NULL
      `);
      console.log('✅ last_incoming_message_at column verified');

      // Ensure wa_message_id column on messages (webhook idempotency)
      console.log('Ensuring messages.wa_message_id column...');
      await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id VARCHAR(100)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_wa_message_id ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL`);
      console.log('✅ messages.wa_message_id column verified');

      // Ensure opted_in column exists and backfill NULLs
      console.log('Ensuring opted_in column...');
      await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS opted_in BOOLEAN DEFAULT TRUE`);
      await client.query(`UPDATE customers SET opted_in = TRUE WHERE opted_in IS NULL`);

      // Ensure tipe column exists (Belanja / Chat Only)
      console.log('Ensuring tipe column...');
      await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS tipe VARCHAR(20) DEFAULT 'Belanja'`);
      await client.query(`UPDATE customers SET tipe = 'Belanja' WHERE tipe IS NULL`);
      console.log('✅ opted_in column verified');

      // Ensure catatan column exists (notes for Chat Only customers)
      console.log('Ensuring catatan column...');
      await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS catatan TEXT`);

      // Ensure wa_sent column exists (WhatsApp delivery status)
      console.log('Ensuring wa_sent column...');
      await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS wa_sent BOOLEAN DEFAULT NULL`);

      // Ensure google_contact_synced column exists
      console.log('Ensuring google_contact_synced column...');
      await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS google_contact_synced BOOLEAN DEFAULT FALSE`);

      // Migrate old status values to new system
      console.log('Migrating status values...');
      await client.query(`UPDATE customers SET status = 'Contacted' WHERE status = 'Existing'`);
      await client.query(`UPDATE customers SET status = 'Inactive' WHERE status = 'Old'`);
      await client.query(`UPDATE customers SET status = 'New' WHERE status NOT IN ('New','Contacted','Follow Up','Completed','Inactive')`);
      console.log('✅ Status values migrated');

      // Broadcast tables (DB-backed queue for serverless)
      console.log('Creating table: broadcast_jobs...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS broadcast_jobs (
          id SERIAL PRIMARY KEY,
          message TEXT NOT NULL,
          source_filter VARCHAR(50),
          status VARCHAR(20) DEFAULT 'running',
          total INT DEFAULT 0,
          sent INT DEFAULT 0,
          failed INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Table broadcast_jobs created/verified');

      console.log('Creating table: broadcast_recipients...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS broadcast_recipients (
          id SERIAL PRIMARY KEY,
          job_id INT NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
          customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          customer_name VARCHAR(100),
          customer_phone VARCHAR(20),
          status VARCHAR(20) DEFAULT 'pending',
          error TEXT,
          sent_at TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_br_job ON broadcast_recipients (job_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_br_status ON broadcast_recipients (job_id, status)`);
      console.log('✅ Table broadcast_recipients created/verified');

      // Birthday greetings log
      console.log('Creating table: birthday_greetings...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS birthday_greetings (
          id SERIAL PRIMARY KEY,
          customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          greeting_year INT NOT NULL,
          message TEXT,
          status VARCHAR(20) DEFAULT 'pending',
          error TEXT,
          sent_at TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(customer_id, greeting_year)
        )
      `);
      await client.query(`ALTER TABLE birthday_greetings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      await client.query(`ALTER TABLE birthday_greetings ADD COLUMN IF NOT EXISTS dispatch_mode VARCHAR(10) DEFAULT 'manual'`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_bg_customer ON birthday_greetings (customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_bg_year ON birthday_greetings (greeting_year)`);
      console.log('✅ Table birthday_greetings created/verified');

      // App settings (key-value store for birthday message, etc.)
      console.log('Creating table: app_settings...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key VARCHAR(100) PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Table app_settings created/verified');

      // WhatsApp Logs — semua pengiriman WA dicatat di sini (Cloud API)
      // Status flow: PENDING → SENT → DELIVERED → READ (atau FAILED)
      // Worker akan retry FAILED otomatis sampai max_retries
      console.log('Creating table: whatsapp_logs...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_logs (
          id SERIAL PRIMARY KEY,
          phone VARCHAR(20) NOT NULL,
          type VARCHAR(20) DEFAULT 'template',
          template_name VARCHAR(100),
          template_language VARCHAR(10) DEFAULT 'id',
          template_components JSONB DEFAULT '[]',
          message_body TEXT,
          wa_message_id VARCHAR(100),
          status VARCHAR(20) DEFAULT 'PENDING',
          retry_count INT DEFAULT 0,
          max_retries INT DEFAULT 3,
          next_retry_at TIMESTAMP,
          error_code VARCHAR(50),
          error_detail TEXT,
          api_response JSONB,
          priority VARCHAR(10) DEFAULT 'normal',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          sent_at TIMESTAMP,
          delivered_at TIMESTAMP,
          read_at TIMESTAMP
        )
      `);
      // auto_dispatch: TRUE = worker auto-sends with pacing; FALSE = waits for
      // admin manual click. Captured at enqueue-time from form_autoreply_enabled
      // toggle. Once a row is enqueued, its dispatch mode is sticky — flipping
      // the toggle afterward does not affect rows already in queue.
      await client.query(`ALTER TABLE whatsapp_logs ADD COLUMN IF NOT EXISTS auto_dispatch BOOLEAN NOT NULL DEFAULT TRUE`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_wl_phone ON whatsapp_logs (phone)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_wl_status ON whatsapp_logs (status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_wl_created ON whatsapp_logs (created_at)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_wl_retry ON whatsapp_logs (status, next_retry_at) WHERE status = 'FAILED' AND retry_count < max_retries`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_wl_wa_msg_id ON whatsapp_logs (wa_message_id) WHERE wa_message_id IS NOT NULL`);
      // Worker scans QUEUED + auto_dispatch=TRUE on every tick — partial index keeps it cheap
      await client.query(`CREATE INDEX IF NOT EXISTS idx_wl_auto_dispatch_queue ON whatsapp_logs (priority, id) WHERE status = 'QUEUED' AND auto_dispatch = TRUE`);
      console.log('✅ Table whatsapp_logs created/verified');

      // WA Daily Stats — counter harian persist di DB (tidak hilang saat restart)
      console.log('Creating table: wa_daily_stats...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS wa_daily_stats (
          id SERIAL PRIMARY KEY,
          stat_date DATE NOT NULL UNIQUE,
          sent_count INT DEFAULT 0,
          failed_count INT DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_wds_date ON wa_daily_stats (stat_date)`);
      console.log('✅ Table wa_daily_stats created/verified');

      // Admin activity logs (audit trail)
      console.log('Creating table: admin_activity_logs...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_activity_logs (
          id SERIAL PRIMARY KEY,
          admin_id INT REFERENCES admins(id) ON DELETE SET NULL,
          admin_username VARCHAR(50) NOT NULL,
          action VARCHAR(100) NOT NULL,
          detail TEXT,
          ip_address VARCHAR(45),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_aal_admin ON admin_activity_logs (admin_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_aal_action ON admin_activity_logs (action)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_aal_created ON admin_activity_logs (created_at)`);
      console.log('✅ Table admin_activity_logs created/verified');

      // Ensure messages.channel column exists (for 24h window tracking)
      console.log('Ensuring messages.channel column...');
      await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel VARCHAR(20) DEFAULT 'whatsapp'`);
      console.log('✅ Messages channel column verified');

      // Buat view statistik
      console.log('Creating view: customer_stats...');
      await client.query(`DROP VIEW IF EXISTS customer_stats`);
      await client.query(`
        CREATE VIEW customer_stats AS
        SELECT
          COUNT(*) as total_customers,
          SUM(CASE WHEN source = 'Website' THEN 1 ELSE 0 END) as from_website,
          SUM(CASE WHEN source = 'Instagram' THEN 1 ELSE 0 END) as from_instagram,
          SUM(CASE WHEN source = 'Facebook' THEN 1 ELSE 0 END) as from_facebook,
          SUM(CASE WHEN source = 'TikTok' THEN 1 ELSE 0 END) as from_tiktok,
          SUM(CASE WHEN source LIKE '%Teman%' OR source LIKE '%Keluarga%' THEN 1 ELSE 0 END) as from_friends,
          SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) as new_customers,
          SUM(CASE WHEN status = 'Contacted' THEN 1 ELSE 0 END) as contacted_customers,
          SUM(CASE WHEN status = 'Follow Up' THEN 1 ELSE 0 END) as followup_customers,
          SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed_customers,
          SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END) as inactive_customers,
          SUM(CASE WHEN (created_at AT TIME ZONE 'Asia/Makassar')::date = (NOW() AT TIME ZONE 'Asia/Makassar')::date THEN 1 ELSE 0 END) as today_customers,
          SUM(CASE WHEN source NOT IN ('Website','Instagram','Facebook','TikTok','Teman/Keluarga') THEN 1 ELSE 0 END) as from_others
        FROM customers
      `);
      console.log('✅ View customer_stats created/verified');

      // ============================================
      // VIEW: customer_purchases_detail
      // For Supabase Table Editor browsing — one row per purchase, with full
      // customer info denormalized so the owner doesn't have to JOIN manually.
      // Example use: filter by customer_nama, sort by total spent, etc.
      // ============================================
      console.log('Creating view: customer_purchases_detail...');
      await client.query(`DROP VIEW IF EXISTS customer_purchases_detail`);
      await client.query(`
        CREATE VIEW customer_purchases_detail AS
        SELECT
          p.id AS purchase_id,
          p.customer_id,
          c.nama_lengkap AS customer_nama,
          c.whatsapp AS customer_whatsapp,
          c.alamat AS customer_alamat,
          p.merk_unit,
          p.tipe_unit,
          p.harga,
          p.qty,
          (COALESCE(p.harga, 0) * COALESCE(p.qty, 1)) AS subtotal,
          p.nama_sales,
          p.metode_pembayaran,
          p.source,
          (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Makassar') AS purchase_date_wita,
          p.created_at AS purchase_date_utc
        FROM purchases p
        LEFT JOIN customers c ON c.id = p.customer_id
        ORDER BY p.created_at DESC
      `);
      console.log('✅ View customer_purchases_detail created/verified');

      // ============================================
      // VIEW: customer_summary
      // One row per customer with aggregated purchase totals — for at-a-glance
      // "siapa pelanggan top, berapa total belanja"
      // ============================================
      console.log('Creating view: customer_summary...');
      await client.query(`DROP VIEW IF EXISTS customer_summary`);
      await client.query(`
        CREATE VIEW customer_summary AS
        SELECT
          c.id,
          c.nama_lengkap,
          c.whatsapp,
          c.tipe,
          c.status,
          c.source,
          c.alamat,
          c.tanggal_lahir,
          COALESCE(agg.purchase_count, 0) AS total_purchases,
          COALESCE(agg.total_qty, 0) AS total_unit_bought,
          COALESCE(agg.total_spent, 0) AS total_spent,
          agg.last_purchase_at,
          c.last_incoming_message_at,
          c.created_at,
          c.updated_at
        FROM customers c
        LEFT JOIN (
          SELECT customer_id,
                COUNT(*) AS purchase_count,
                SUM(COALESCE(qty, 1)) AS total_qty,
                SUM(COALESCE(harga, 0) * COALESCE(qty, 1)) AS total_spent,
                MAX(created_at) AS last_purchase_at
          FROM purchases GROUP BY customer_id
        ) agg ON agg.customer_id = c.id
        ORDER BY agg.total_spent DESC NULLS LAST
      `);
      console.log('✅ View customer_summary created/verified');

      // Buat default admin jika belum ada, atau update existing
      const { rows: adminRows } = await client.query('SELECT COUNT(*) as count FROM admins');
      if (parseInt(adminRows[0].count) === 0) {
        console.log('Creating default admin...');
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('admin123', 10);

        await client.query(
          `INSERT INTO admins (username, password, nama, email, role)
          VALUES ($1, $2, $3, $4, 'owner')`,
          ['superadmin', hashedPassword, 'Cahaya Phone Superadmin', 'cahayaphone288@gmail.com']
        );
        console.log('✅ Default admin created (role: owner, recovery email: cahayaphone288@gmail.com)');
        console.log('   Username: superadmin');
        console.log('   Password: admin123');
      } else {
        // Update existing admin username & nama to latest, ensure first admin = owner.
        // Backfill the recovery email only when empty — so "Lupa password" has a
        // destination — without clobbering an address the owner set via Settings.
        await client.query(
          `UPDATE admins
             SET username = 'superadmin',
                 nama = 'Cahaya Phone Superadmin',
                 role = 'owner',
                 email = COALESCE(email, 'cahayaphone288@gmail.com')
           WHERE id = (SELECT id FROM admins ORDER BY id LIMIT 1)`
        );
        console.log('✅ Admin updated: superadmin / Cahaya Phone Superadmin / role=owner (recovery email ensured)');
      }

      // Tampilkan ringkasan
      const { rows: cc } = await client.query('SELECT COUNT(*) as count FROM customers');
      const { rows: ac } = await client.query('SELECT COUNT(*) as count FROM admins');
      const { rows: mc } = await client.query('SELECT COUNT(*) as count FROM messages');
      const { rows: pc } = await client.query('SELECT COUNT(*) as count FROM purchases');
      const { rows: ic } = await client.query('SELECT COUNT(*) as count FROM invoices');

      console.log('\n📊 Database Summary:');
      console.log(`   Customers: ${cc[0].count}`);
      console.log(`   Admins: ${ac[0].count}`);
      console.log(`   Messages: ${mc[0].count}`);
      console.log(`   Purchases: ${pc[0].count}`);
      console.log(`   Invoices: ${ic[0].count}`);
      console.log('\n✅ Migration completed successfully!');

    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      console.error('Full error:', error);
      process.exit(1);
    } finally {
      await client.end();
      console.log('🔌 Database connection closed');
    }
  }

  migrate()
    .then(() => {
      console.log('✅ All done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
