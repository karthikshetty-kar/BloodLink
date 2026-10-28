const sqlite3 = require('./node_modules/sqlite3').verbose();
const path = require('path');

async function inspectDb(fileName) {
  const dbPath = path.join(__dirname, 'database', fileName);
  const db = new sqlite3.Database(dbPath);
  const get = (sql) => new Promise((res, rej) => db.get(sql, (err, row) => err ? rej(err) : res(row)));
  const all = (sql) => new Promise((res, rej) => db.all(sql, (err, rows) => err ? rej(err) : res(rows)));
  
  const integrity = await get('PRAGMA integrity_check');
  const tables = await all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  
  const counts = {};
  for (const t of tables) {
    const c = await get(`SELECT COUNT(*) as cnt FROM ${t.name}`);
    counts[t.name] = c.cnt;
  }
  db.close();
  return { fileName, dbPath, integrity: integrity.integrity_check, counts };
}

(async () => {
  try {
    const live = await inspectDb('bloodlink.db');
    console.log('LIVE DB:', JSON.stringify(live, null, 2));
    const backup = await inspectDb('bloodlink_pre_fix_backup_20261026.db');
    console.log('PRE-FIX BACKUP DB:', JSON.stringify(backup, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
})();
