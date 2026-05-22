const mysql = require('mysql2/promise');

(async () => {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'cahaya_phone_crm'
    });

    const newHash = '$2a$10$i4H32RnI3kzLIDrZSYYEVOMRKzUcAydkLpAm4X.2KvT5aZL.qeU9u';

    const [result] = await connection.execute(
      'UPDATE admins SET password = ? WHERE username = ?',
      [newHash, 'admin']
    );

    console.log('Updated rows:', result.affectedRows);
    await connection.end();
  } catch (err) {
    console.error('Error updating admin hash:', err);
  }
})();