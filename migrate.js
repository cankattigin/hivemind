require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const migrations = [
  "ALTER TABLE entities ADD COLUMN IF NOT EXISTS nature text",
  "ALTER TABLE entities ADD COLUMN IF NOT EXISTS icon_url text",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS permissions jsonb default '{}'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS pipeline_templates jsonb default '[]'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS departments jsonb default '[]'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS roles jsonb default '[]'",
];

async function migrate() {
  console.log('Running migrations...\n');
  for (const sql of migrations) {
    try {
      await pool.query(sql);
      console.log('✅', sql);
    } catch (e) {
      console.error('❌', sql, '\n  ', e.message);
    }
  }
  await pool.end();
  console.log('\nAll migrations complete.');
}

migrate();
