from __future__ import annotations

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

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "users", now)
    logger.info("Synced %d users", len(users))
    return len(users)


def sync_chats(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental upsert of chats updated since last sync."""
    last_sync = get_last_sync(observer_conn, "chats") or EPOCH

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, title, "createdAt", "updatedAt", "deletedAt", "userId" '
            'FROM "Chat" WHERE "updatedAt" > %s ORDER BY "updatedAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    chats = [
        {
            "id": str(row[0]),
            "title": row[1],
            "created_at": row[2],
            "updated_at": row[3],
            "deleted_at": row[4],
            "user_id": str(row[5]),
        }
        for row in rows
    ]

    if chats:
        upsert_chats(observer_conn, chats)

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "chats", now)
    logger.info("Synced %d chats (since %s)", len(chats), last_sync)
    return len(chats)


def sync_messages(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental insert of messages created since last sync."""
    last_sync = get_last_sync(observer_conn, "messages") or EPOCH

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, "order", role, metadata, "createdAt", "chatId" '
            'FROM "Message" WHERE "createdAt" > %s ORDER BY "createdAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    messages = [
        {
            "id": str(row[0]),
            "order": row[1],
            "role": row[2],
            "metadata": row[3],
            "created_at": row[4],
            "chat_id": str(row[5]),
        }
        for row in rows
    ]

    if messages:
        insert_messages(observer_conn, messages)

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "messages", now)
    logger.info("Synced %d messages (since %s)", len(messages), last_sync)
    return len(messages)


def sync_message_parts(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> int:
    """Incremental insert of message parts created since last sync."""
    last_sync = get_last_sync(observer_conn, "message_parts") or EPOCH

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT id, "order", content, "createdAt", "messageId" '
            'FROM "MessagePart" WHERE "createdAt" > %s ORDER BY "createdAt"',
            (last_sync,),
        )
        rows = cur.fetchall()

    parts = [
        {
            "id": str(row[0]),
            "order": row[1],
            "content": row[2],
            "created_at": row[3],
            "message_id": str(row[4]),
        }
        for row in rows
    ]

    if parts:
        insert_message_parts(observer_conn, parts)

    now = datetime.now(timezone.utc)
    update_last_sync(observer_conn, "message_parts", now)
    logger.info("Synced %d message parts (since %s)", len(parts), last_sync)
    return len(parts)


def sync_app_data(app_conn: psycopg.Connection, observer_conn: psycopg.Connection) -> None:
    """Run all app data syncs in order (respecting FK dependencies)."""
    sync_users(app_conn, observer_conn)
    sync_chats(app_conn, observer_conn)
    sync_messages(app_conn, observer_conn)
    sync_message_parts(app_conn, observer_conn)
