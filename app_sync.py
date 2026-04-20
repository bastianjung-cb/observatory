from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import psycopg

from db import (
    get_last_sync,
    insert_message_parts,
    insert_messages,
    update_last_sync,
    upsert_chats,
    upsert_users,
)

logger = logging.getLogger(__name__)

EPOCH = datetime(2000, 1, 1, tzinfo=timezone.utc)


def sync_users(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Full upsert of all users from app DB to observer DB."""
    tick_start = datetime.now(timezone.utc)

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, "authId", email, "givenName", "familyName", '
            '"isSuspended", "deletedAt" FROM "User"'
        )
        rows = cur.fetchall()

    users = [
        {
            "id": str(row[0]),
            "auth_id": row[1],
            "email": row[2],
            "given_name": row[3],
            "family_name": row[4],
            "is_suspended": row[5],
            "deleted_at": row[6],
        }
        for row in rows
    ]

    if users:
        upsert_users(observer_conn, users)

    update_last_sync(observer_conn, "users", tick_start)
    observer_conn.commit()
    logger.info("Synced %d users", len(users))
    return len(users)


def sync_chats(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental upsert of chats updated since last sync.

    Captures `tick_start` BEFORE the query so any row inserted between the
    query end and the watermark update is NOT silently skipped — it will be
    picked up on the next tick (updated_at > tick_start).
    """
    last_sync = get_last_sync(observer_conn, "chats") or EPOCH
    tick_start = datetime.now(timezone.utc)

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, title, "createdAt", "updatedAt", "deletedAt", "userId" '
            'FROM "Chat" WHERE "updatedAt" > %s ORDER BY "updatedAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    chats = [
        {
            "id": str(row[0]), "title": row[1], "created_at": row[2],
            "updated_at": row[3], "deleted_at": row[4], "user_id": str(row[5]),
        }
        for row in rows
    ]

    if chats:
        upsert_chats(observer_conn, chats)

    update_last_sync(observer_conn, "chats", tick_start)
    observer_conn.commit()
    logger.info("Synced %d chats (since %s, watermark→%s)", len(chats), last_sync, tick_start)
    return len(chats)


def sync_messages(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental insert of messages created since last sync."""
    last_sync = get_last_sync(observer_conn, "messages") or EPOCH
    tick_start = datetime.now(timezone.utc)

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, "order", role, metadata, "createdAt", "chatId" '
            'FROM "Message" WHERE "createdAt" > %s ORDER BY "createdAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    messages = [
        {
            "id": str(row[0]), "order": row[1], "role": row[2],
            "metadata": row[3], "created_at": row[4], "chat_id": str(row[5]),
        }
        for row in rows
    ]

    if messages:
        insert_messages(observer_conn, messages)

    update_last_sync(observer_conn, "messages", tick_start)
    observer_conn.commit()
    logger.info("Synced %d messages (since %s, watermark→%s)", len(messages), last_sync, tick_start)
    return len(messages)


def sync_message_parts(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental insert of message parts created since last sync."""
    last_sync = get_last_sync(observer_conn, "message_parts") or EPOCH
    tick_start = datetime.now(timezone.utc)

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, "order", content, "createdAt", "messageId" '
            'FROM "MessagePart" WHERE "createdAt" > %s ORDER BY "createdAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    parts = [
        {
            "id": str(row[0]), "order": row[1], "content": row[2],
            "created_at": row[3], "message_id": str(row[4]),
        }
        for row in rows
    ]

    if parts:
        insert_message_parts(observer_conn, parts)

    update_last_sync(observer_conn, "message_parts", tick_start)
    observer_conn.commit()
    logger.info("Synced %d message parts (since %s, watermark→%s)", len(parts), last_sync, tick_start)
    return len(parts)


def sync_app_data(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> None:
    """Run all app data syncs in order (respecting FK dependencies)."""
    sync_users(app_conn, observer_conn)
    sync_chats(app_conn, observer_conn)
    sync_messages(app_conn, observer_conn)
    sync_message_parts(app_conn, observer_conn)


def sync_generation_batches(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Enrich column_generation_workflows with metadata from app DB."""
    last_sync = get_last_sync(observer_conn, "generation_batches") or EPOCH

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT gb.id, gb."columnId", gb.prompt, gb.variant, gb."variantOptions", '
            'gb.rows, gb."totalRows", gb."completedRows", gb."failedRows", '
            'gb.status, gb."userId", gb."createdAt", gb."updatedAt", '
            'r.name as "columnName" '
            'FROM "GenerationBatch" gb '
            'LEFT JOIN "Resource" r ON r.id = gb."columnId" '
            'WHERE gb."updatedAt" > %s ORDER BY gb."updatedAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    updated = 0
    for row in rows:
        batch_id = str(row[0])
        user_id = str(row[10]) if row[10] else None
        metadata = {
            "id": str(row[0]),
            "columnId": str(row[1]) if row[1] else None,
            "columnName": row[13],
            "prompt": row[2],
            "variant": row[3],
            "variantOptions": row[4],
            "rows": row[5],
            "totalRows": row[6],
            "completedRows": row[7],
            "failedRows": row[8],
            "status": row[9],
            "userId": user_id,
            "createdAt": row[11].isoformat() if row[11] else None,
            "updatedAt": row[12].isoformat() if row[12] else None,
        }

        with observer_conn.cursor() as cur:
            cur.execute(
                "UPDATE column_generation_workflows SET user_id = %s, metadata = %s WHERE batch_id = %s::uuid",
                (user_id, json.dumps(metadata), batch_id),
            )
            if cur.rowcount > 0:
                updated += 1
        observer_conn.commit()

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "generation_batches", now)
    logger.info("Enriched %d generation batches (since %s)", updated, last_sync)
    return updated
