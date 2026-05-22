// Script: fix_sources.js
// Purpose: Update customers.source based on tahu_dari values for existing rows

const pool = require('../config/database');

(async () => {
  try {
    const updates = [
      { sql: "UPDATE customers SET source = 'TikTok' WHERE LOWER(tahu_dari) LIKE '%tiktok%'", label: 'TikTok' },
      { sql: "UPDATE customers SET source = 'Facebook' WHERE LOWER(tahu_dari) LIKE '%facebook%'", label: 'Facebook' },
      { sql: "UPDATE customers SET source = 'Instagram' WHERE LOWER(tahu_dari) LIKE '%instagram%'", label: 'Instagram' },
      { sql: "UPDATE customers SET source = 'Teman/Keluarga' WHERE LOWER(tahu_dari) LIKE '%teman%' OR LOWER(tahu_dari) LIKE '%temen%' OR LOWER(tahu_dari) LIKE '%keluarga%'", label: 'Teman/Keluarga' },
      { sql: "UPDATE customers SET source = 'Website' WHERE (tahu_dari IS NULL OR TRIM(tahu_dari) = '' OR LOWER(tahu_dari) LIKE '%website%')", label: 'Website (blank/website)' }
    ];

    for (const u of updates) {
      const [result] = await pool.query(u.sql);
      console.log(`Updated ${result.affectedRows} rows -> ${u.label}`);
    }

    // Recompute view (if needed) - ensure view exists with new columns
    const viewSql = `CREATE OR REPLACE VIEW customer_stats AS
    SELECT 
        COUNT(*) as total_customers,
        SUM(CASE WHEN source = 'Website' THEN 1 ELSE 0 END) as from_website,
        SUM(CASE WHEN source = 'Instagram' THEN 1 ELSE 0 END) as from_instagram,
        SUM(CASE WHEN source = 'Facebook' THEN 1 ELSE 0 END) as from_facebook,
        SUM(CASE WHEN source = 'TikTok' THEN 1 ELSE 0 END) as from_tiktok,
        SUM(CASE WHEN source LIKE '%Teman%' OR source LIKE '%Keluarga%' THEN 1 ELSE 0 END) as from_friends,
        SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) as new_customers,
        SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today_customers,
        SUM(CASE WHEN source NOT IN ('Website','Instagram','Facebook','TikTok','Teman/Keluarga') THEN 1 ELSE 0 END) as from_others
    FROM customers;`;

    await pool.query(viewSql);
    console.log('Replaced view customer_stats');

    // Show current stats
    const [statsRows] = await pool.query('SELECT * FROM customer_stats');
    console.log('Current stats:', statsRows[0]);

    process.exit(0);
  } catch (err) {
    console.error('Error running fix script:', err.message || err);
    process.exit(1);
  }
})();
