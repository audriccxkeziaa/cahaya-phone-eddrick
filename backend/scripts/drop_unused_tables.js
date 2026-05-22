const db = require('../config/database');

(async () => {
  try {
    console.log('Dropping unused tables...');

    const r1 = await db.query('DROP TABLE IF EXISTS admin_sessions CASCADE');
    console.log('✅ admin_sessions dropped');

    const r2 = await db.query('DROP TABLE IF EXISTS wa_chat_state CASCADE');
    console.log('✅ wa_chat_state dropped');

    console.log('Done — 2 unused tables removed.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
