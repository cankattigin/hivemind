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
  "ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id uuid",
  "ALTER TABLE entity_types ADD COLUMN IF NOT EXISTS detail_blocks jsonb default '[]'",
  "ALTER TABLE memberships ADD COLUMN IF NOT EXISTS tiers jsonb default '[\"member\"]'",
  "ALTER TABLE memberships ADD COLUMN IF NOT EXISTS job_title text default ''",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS status text default 'active'",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text",
  "ALTER TABLE memberships ADD COLUMN IF NOT EXISTS status text default 'active'",
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS needs_reassignment boolean default false",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS email text",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz",
  `CREATE TABLE IF NOT EXISTS reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    type text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz DEFAULT now()
  )`,
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
