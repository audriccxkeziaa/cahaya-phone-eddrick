// Migration script: add email column to admins and create admin_reset_tokens table
const db = require('../config/database');

(async () => {
  try {
    console.log('Running admin reset tables migration...');

    // Add email column if not exists (check information_schema)
    const [cols] = await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'email'");
    if (cols.length === 0) {
      await db.query("ALTER TABLE admins ADD COLUMN email VARCHAR(255) NULL");
      console.log('Added admins.email column');
    } else {
      console.log('admins.email already exists');
    }

    // Create reset tokens table
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_reset_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        token VARCHAR(128) NOT NULL,
        expires_at DATETIME NOT NULL,
        used TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // (Optional) ensure at least one admin has an email for testing
    const [rows] = await db.query('SELECT id, username, email FROM admins LIMIT 1');
    if (rows.length > 0 && !rows[0].email) {
      await db.query('UPDATE admins SET email = ? WHERE id = ?', ['admin@localhost', rows[0].id]);
      console.log('Set default email for admin -> admin@localhost');
    }

    console.log('Migration completed.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();