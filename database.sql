-- ============================================
-- RAILWAY DATABASE SETUP - CAHAYA PHONE CRM
-- PostgreSQL schema — run against your Railway
-- PostgreSQL database (psql or Railway console)
-- ============================================

-- ============================================
-- TABLE: admins
-- ============================================
CREATE TABLE IF NOT EXISTS admins (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50)  UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    nama        VARCHAR(100) NOT NULL,
    email       VARCHAR(255) DEFAULT NULL,
    role        VARCHAR(20)  NOT NULL DEFAULT 'staff',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique index on lower-cased email (allows NULL, prevents duplicate emails)
DO $body$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'admins_email_unique_idx'
    ) THEN
        CREATE UNIQUE INDEX admins_email_unique_idx
            ON admins (LOWER(email)) WHERE email IS NOT NULL;
    END IF;
END $body$;

-- Insert default owner admin (username: superadmin / password: admin123)
-- bcrypt hash of 'admin123' with cost 10
-- email = owner recovery address; "Lupa password" sends the reset link here.
INSERT INTO admins (username, password, nama, email, role)
VALUES (
    'superadmin',
    '$2a$10$i4H32RnI3kzLIDrZSYYEVOMRKzUcAydkLpAm4X.2KvT5aZL.qeU9u',
    'Cahaya Phone Superadmin',
    'cahayaphone288@gmail.com',
    'owner'
)
ON CONFLICT (username) DO UPDATE
    SET nama = EXCLUDED.nama,
        role = EXCLUDED.role,
        -- backfill the recovery email only if it isn't set yet; never clobber
        -- an address the owner already configured via Settings.
        email = COALESCE(admins.email, EXCLUDED.email);

-- ============================================
-- TABLE: admin_reset_tokens
-- ============================================
CREATE TABLE IF NOT EXISTS admin_reset_tokens (
    id          SERIAL PRIMARY KEY,
    admin_id    INT          NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token       VARCHAR(128) NOT NULL,
    expires_at  TIMESTAMP    NOT NULL,
    used        BOOLEAN      DEFAULT FALSE,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: customers
-- ============================================
CREATE TABLE IF NOT EXISTS customers (
    id                          SERIAL PRIMARY KEY,
    nama_lengkap                VARCHAR(100) NOT NULL,
    nama_sales                  VARCHAR(100),
    merk_unit                   VARCHAR(100),
    tipe_unit                   VARCHAR(100),
    harga                       NUMERIC(15,2),
    qty                         INT          DEFAULT 1,
    tanggal_lahir               DATE,
    alamat                      TEXT,
    whatsapp                    VARCHAR(20)  NOT NULL,
    metode_pembayaran           VARCHAR(50),
    tahu_dari                   VARCHAR(50),
    source                      VARCHAR(20)  NOT NULL DEFAULT 'Unknown',
    status                      VARCHAR(20)  DEFAULT 'New',
    opted_in                    BOOLEAN      DEFAULT TRUE,
    -- tipe: 'Belanja' (came via form/purchase) | 'Chat Only' (inbound WA only)
    tipe                        VARCHAR(20)  DEFAULT 'Belanja',
    -- catatan: free-text admin notes per customer
    catatan                     TEXT,
    -- wa_sent: TRUE = WA auto-reply delivered, FALSE = failed, NULL = not yet sent
    wa_sent                     BOOLEAN      DEFAULT NULL,
    -- last_incoming_message_at: timestamp of most recent inbound WA message
    last_incoming_message_at    TIMESTAMP,
    created_at                  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_whatsapp ON customers (whatsapp);
CREATE INDEX IF NOT EXISTS idx_whatsapp ON customers (whatsapp);
CREATE INDEX IF NOT EXISTS idx_source   ON customers (source);
CREATE INDEX IF NOT EXISTS idx_status   ON customers (status);
CREATE INDEX IF NOT EXISTS idx_customers_last_msg
    ON customers (last_incoming_message_at)
    WHERE last_incoming_message_at IS NOT NULL;

-- ============================================
-- TABLE: messages  (WhatsApp chat log)
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
    id              SERIAL PRIMARY KEY,
    customer_id     INT         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    direction       VARCHAR(3)  NOT NULL CHECK (direction IN ('in', 'out')),
    message         TEXT        NOT NULL,
    -- wa_message_id: Cloud API message ID for idempotency (dedup on webhook)
    wa_message_id   VARCHAR(100),
    -- channel: 'whatsapp' (default) — reserved for future multi-channel support
    channel         VARCHAR(20) DEFAULT 'whatsapp',
    sent_at         TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_wa_message_id
    ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msg_customer  ON messages (customer_id);
CREATE INDEX IF NOT EXISTS idx_msg_direction ON messages (direction);

-- ============================================
-- TABLE: purchases  (transaction history)
-- One row per sale event; customers table holds the latest snapshot.
-- Repeat orders are recorded here so omzet/pipeline stats stay accurate.
-- ============================================
CREATE TABLE IF NOT EXISTS purchases (
    id                  SERIAL PRIMARY KEY,
    customer_id         INT          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    merk_unit           VARCHAR(100),
    tipe_unit           VARCHAR(100),
    harga               NUMERIC(15,2),
    qty                 INT          DEFAULT 1,
    nama_sales          VARCHAR(100),
    metode_pembayaran   VARCHAR(50),
    source              VARCHAR(20)  DEFAULT 'Website',
    created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchases_customer ON purchases (customer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_merk     ON purchases (merk_unit);
CREATE INDEX IF NOT EXISTS idx_purchases_date     ON purchases (created_at);

-- ============================================
-- TABLE: invoices  (digital receipts)
-- ============================================
CREATE TABLE IF NOT EXISTS invoices (
    id                  SERIAL PRIMARY KEY,
    invoice_number      VARCHAR(50)  UNIQUE NOT NULL,
    token               VARCHAR(64)  UNIQUE NOT NULL,
    customer_id         INT          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    purchase_id         INT          REFERENCES purchases(id) ON DELETE SET NULL,
    items               JSONB        NOT NULL DEFAULT '[]',
    subtotal            NUMERIC(15,2) DEFAULT 0,
    diskon              NUMERIC(15,2) DEFAULT 0,
    total               NUMERIC(15,2) DEFAULT 0,
    metode_pembayaran   VARCHAR(50),
    catatan             TEXT,
    created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_token    ON invoices (token);

-- ============================================
-- TABLE: broadcast_jobs
-- ============================================
CREATE TABLE IF NOT EXISTS broadcast_jobs (
    id              SERIAL PRIMARY KEY,
    message         TEXT         NOT NULL,
    source_filter   VARCHAR(50),
    status          VARCHAR(20)  DEFAULT 'running',
    total           INT          DEFAULT 0,
    sent            INT          DEFAULT 0,
    failed          INT          DEFAULT 0,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: broadcast_recipients
-- Tracks per-customer delivery status for each broadcast job.
-- ============================================
CREATE TABLE IF NOT EXISTS broadcast_recipients (
    id              SERIAL PRIMARY KEY,
    job_id          INT          NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
    customer_id     INT          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    customer_name   VARCHAR(100),
    customer_phone  VARCHAR(20),
    -- status: pending | sending | sent | failed | skipped
    status          VARCHAR(20)  DEFAULT 'pending',
    error           TEXT,
    sent_at         TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_br_job    ON broadcast_recipients (job_id);
CREATE INDEX IF NOT EXISTS idx_br_status ON broadcast_recipients (job_id, status);

-- ============================================
-- TABLE: birthday_greetings
-- ============================================
CREATE TABLE IF NOT EXISTS birthday_greetings (
    id              SERIAL PRIMARY KEY,
    customer_id     INT          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    greeting_year   INT          NOT NULL,
    message         TEXT,
    status          VARCHAR(20)  DEFAULT 'pending',
    error           TEXT,
    sent_at         TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (customer_id, greeting_year)
);

CREATE INDEX IF NOT EXISTS idx_bg_customer ON birthday_greetings (customer_id);
CREATE INDEX IF NOT EXISTS idx_bg_year     ON birthday_greetings (greeting_year);

-- ============================================
-- TABLE: app_settings  (key-value store)
-- ============================================
CREATE TABLE IF NOT EXISTS app_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: whatsapp_logs
-- Cloud API outbound queue + delivery tracking.
-- Status flow: PENDING → QUEUED → SENDING → SENT → DELIVERED → READ
--              (or any → FAILED, with auto-retry up to max_retries)
-- ============================================
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id                      SERIAL PRIMARY KEY,
    phone                   VARCHAR(20)  NOT NULL,
    type                    VARCHAR(20)  DEFAULT 'template',
    template_name           VARCHAR(100),
    template_language       VARCHAR(10)  DEFAULT 'id',
    template_components     JSONB        DEFAULT '[]',
    message_body            TEXT,
    wa_message_id           VARCHAR(100),
    status                  VARCHAR(20)  DEFAULT 'PENDING',
    retry_count             INT          DEFAULT 0,
    max_retries             INT          DEFAULT 3,
    next_retry_at           TIMESTAMP,
    error_code              VARCHAR(50),
    error_detail            TEXT,
    api_response            JSONB,
    priority                VARCHAR(10)  DEFAULT 'normal',
    -- auto_dispatch: TRUE = worker sends automatically with pacing;
    -- FALSE = waits for admin manual click. Captured at enqueue-time.
    auto_dispatch           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    sent_at                 TIMESTAMP,
    delivered_at            TIMESTAMP,
    read_at                 TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wl_phone       ON whatsapp_logs (phone);
CREATE INDEX IF NOT EXISTS idx_wl_status      ON whatsapp_logs (status);
CREATE INDEX IF NOT EXISTS idx_wl_created     ON whatsapp_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_wl_retry
    ON whatsapp_logs (status, next_retry_at)
    WHERE status = 'FAILED' AND retry_count < max_retries;
CREATE INDEX IF NOT EXISTS idx_wl_wa_msg_id
    ON whatsapp_logs (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wl_auto_dispatch_queue
    ON whatsapp_logs (priority, id)
    WHERE status = 'QUEUED' AND auto_dispatch = TRUE;

-- ============================================
-- TABLE: wa_daily_stats
-- ============================================
CREATE TABLE IF NOT EXISTS wa_daily_stats (
    id              SERIAL PRIMARY KEY,
    stat_date       DATE         NOT NULL UNIQUE,
    sent_count      INT          DEFAULT 0,
    failed_count    INT          DEFAULT 0,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wds_date ON wa_daily_stats (stat_date);

-- ============================================
-- TABLE: admin_activity_logs  (audit trail)
-- ============================================
CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id              SERIAL PRIMARY KEY,
    admin_id        INT          REFERENCES admins(id) ON DELETE SET NULL,
    admin_username  VARCHAR(50)  NOT NULL,
    action          VARCHAR(100) NOT NULL,
    detail          TEXT,
    ip_address      VARCHAR(45),
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_aal_admin   ON admin_activity_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_aal_action  ON admin_activity_logs (action);
CREATE INDEX IF NOT EXISTS idx_aal_created ON admin_activity_logs (created_at);

-- ============================================
-- VIEW: customer_stats
-- Aggregate counts used by the dashboard stats endpoint.
-- Uses AT TIME ZONE 'Asia/Makassar' for correct WITA "today" boundary.
-- ============================================
DROP VIEW IF EXISTS customer_stats;
CREATE VIEW customer_stats AS
SELECT
    COUNT(*)                                                                                AS total_customers,
    COUNT(*) FILTER (WHERE source = 'Website')                                             AS from_website,
    COUNT(*) FILTER (WHERE source = 'Instagram')                                           AS from_instagram,
    COUNT(*) FILTER (WHERE source = 'Facebook')                                            AS from_facebook,
    COUNT(*) FILTER (WHERE source = 'TikTok')                                              AS from_tiktok,
    COUNT(*) FILTER (WHERE source LIKE '%Teman%' OR source LIKE '%Keluarga%')              AS from_friends,
    COUNT(*) FILTER (WHERE status = 'New')                                                 AS new_customers,
    COUNT(*) FILTER (WHERE status = 'Contacted')                                           AS contacted_customers,
    COUNT(*) FILTER (WHERE status = 'Follow Up')                                           AS followup_customers,
    COUNT(*) FILTER (WHERE status = 'Completed')                                           AS completed_customers,
    COUNT(*) FILTER (WHERE status = 'Inactive')                                            AS inactive_customers,
    COUNT(*) FILTER (WHERE
        (created_at AT TIME ZONE 'Asia/Makassar')::date =
        (NOW()      AT TIME ZONE 'Asia/Makassar')::date
    )                                                                                       AS today_customers,
    COUNT(*) FILTER (WHERE source NOT IN (
        'Website','Instagram','Facebook','TikTok','Teman/Keluarga'
    ))                                                                                      AS from_others
FROM customers;

-- ============================================
-- VIEW: customer_purchases_detail
-- One row per purchase with denormalized customer info.
-- Useful for browsing in Supabase / pgAdmin without manual JOINs.
-- ============================================
DROP VIEW IF EXISTS customer_purchases_detail;
CREATE VIEW customer_purchases_detail AS
SELECT
    p.id                                                                    AS purchase_id,
    p.customer_id,
    c.nama_lengkap                                                          AS customer_nama,
    c.whatsapp                                                              AS customer_whatsapp,
    c.alamat                                                                AS customer_alamat,
    p.merk_unit,
    p.tipe_unit,
    p.harga,
    p.qty,
    (COALESCE(p.harga, 0) * COALESCE(p.qty, 1))                            AS subtotal,
    p.nama_sales,
    p.metode_pembayaran,
    p.source,
    (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Makassar')         AS purchase_date_wita,
    p.created_at                                                            AS purchase_date_utc
FROM purchases p
LEFT JOIN customers c ON c.id = p.customer_id
ORDER BY p.created_at DESC;

-- ============================================
-- VIEW: customer_summary
-- One row per customer with aggregated purchase totals.
-- ============================================
DROP VIEW IF EXISTS customer_summary;
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
    COALESCE(agg.purchase_count, 0)     AS total_purchases,
    COALESCE(agg.total_qty, 0)          AS total_unit_bought,
    COALESCE(agg.total_spent, 0)        AS total_spent,
    agg.last_purchase_at,
    c.last_incoming_message_at,
    c.created_at,
    c.updated_at
FROM customers c
LEFT JOIN (
    SELECT
        customer_id,
        COUNT(*)                                        AS purchase_count,
        SUM(COALESCE(qty, 1))                           AS total_qty,
        SUM(COALESCE(harga, 0) * COALESCE(qty, 1))     AS total_spent,
        MAX(created_at)                                 AS last_purchase_at
    FROM purchases
    GROUP BY customer_id
) agg ON agg.customer_id = c.id
ORDER BY agg.total_spent DESC NULLS LAST;

-- ============================================
-- VERIFY
-- ============================================
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT id, username, nama, role FROM admins;