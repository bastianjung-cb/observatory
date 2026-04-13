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
