import pool from "@/lib/db";

export interface SyncStatus {
  entity: string;
  last_sync_at: string;
}

export interface EntityCounts {
  users: number;
  chats: number;
  messages: number;
  message_parts: number;
  workflows: number;
  activities: number;
}

export async function getSyncStatus(): Promise<SyncStatus[]> {
  const result = await pool.query(
    `SELECT entity, last_sync_at FROM sync_state ORDER BY entity`
  );
  return result.rows;
}

export async function getSetting(key: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT value FROM settings WHERE key = $1`,
    [key]
  );
  return result.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

export async function getLastSyncRun(): Promise<string | null> {
  const result = await pool.query(
    `SELECT MAX(last_sync_at) AS last_run FROM sync_state`
  );
  return result.rows[0]?.last_run?.toISOString() ?? null;
}

export async function getEntityCounts(): Promise<EntityCounts> {
  const result = await pool.query(`
    SELECT
      (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM chats WHERE deleted_at IS NULL)::int AS chats,
      (SELECT count(*) FROM messages)::int AS messages,
      (SELECT count(*) FROM message_parts)::int AS message_parts,
      (SELECT count(*) FROM workflows)::int AS workflows,
      (SELECT count(*) FROM activities)::int AS activities
  `);
  return result.rows[0];
}
