from __future__ import annotations

import json
import logging
import time
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


def _fetch_batches_to_enrich(
    app_conn: psycopg.Connection,
    observer_conn: psycopg.Connection,
    last_sync: datetime,
) -> list[dict]:
    """Fetch GenerationBatch rows that need enrichment.
    Two sources, unioned in one app-DB query: updatedAt > last_sync (incremental)
    and observer's NULL-metadata batch_ids (backfill for late-arrival races).
    """
    with observer_conn.cursor() as cur:
        cur.execute(
            "SELECT batch_id::text FROM column_generation_workflows WHERE metadata IS NULL"
        )
        backfill_ids = [row[0] for row in cur.fetchall()]

    if len(backfill_ids) > 10000:
        logger.warning(
            "Unexpectedly large NULL-metadata backfill set: %d rows", len(backfill_ids)
        )

    with app_conn.cursor() as cur:
        cur.execute(
            'SELECT gb.id, gb."columnId", gb.prompt, gb.variant, gb."variantOptions", '
            'gb.rows, gb."totalRows", gb."completedRows", gb."failedRows", '
            'gb.status, gb."userId", gb."createdAt", gb."updatedAt", '
            'r.name as "columnName" '
            'FROM "GenerationBatch" gb '
            'LEFT JOIN "Resource" r ON r.id = gb."columnId" '
            'WHERE gb."updatedAt" > %s OR gb.id::text = ANY(%s) '
            'ORDER BY gb."updatedAt"',
            (last_sync, backfill_ids),
        )
        rows = cur.fetchall()

    return [
        {
            "id": str(row[0]),
            "columnId": str(row[1]) if row[1] else None,
            "columnName": row[13],
            "prompt": row[2],
            "variant": row[3],
            "variantOptions": row[4],
            "rows": row[5], "totalRows": row[6],
            "completedRows": row[7], "failedRows": row[8],
            "status": row[9],
            "userId": str(row[10]) if row[10] else None,
            "createdAt": row[11].isoformat() if row[11] else None,
            "updatedAt": row[12].isoformat() if row[12] else None,
        }
        for row in rows
    ]


def _apply_batch_enrichment(
    observer_conn: psycopg.Connection, batches: list[dict]
) -> int:
    """Batched UPDATE of column_generation_workflows.metadata + user_id.
    Returns rows updated. Caller commits."""
    if not batches:
        return 0
    values_sql_parts = []
    params: list = []
    for b in batches:
        values_sql_parts.append("(%s::uuid, %s::uuid, %s::jsonb)")
        params.extend([b["id"], b.get("userId"), json.dumps(b)])
    values_sql = ", ".join(values_sql_parts)
    sql = (
        "UPDATE column_generation_workflows cgw "
        "SET user_id = COALESCE(v.user_id, cgw.user_id), "
        "    metadata = COALESCE(v.metadata, cgw.metadata) "
        f"FROM (VALUES {values_sql}) AS v(batch_id, user_id, metadata) "
        "WHERE cgw.batch_id = v.batch_id"
    )
    with observer_conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def _find_orphan_batch_ids(
    observer_conn: psycopg.Connection, fetched_batches: list[dict]
) -> list[str]:
    fetched_ids = {b["id"] for b in fetched_batches}
    with observer_conn.cursor() as cur:
        cur.execute(
            "SELECT batch_id::text FROM column_generation_workflows WHERE metadata IS NULL"
        )
        null_ids = [row[0] for row in cur.fetchall()]
    return sorted(bid for bid in null_ids if bid not in fetched_ids)


def sync_generation_batches(
    app_conn: psycopg.Connection, observer_conn: psycopg.Connection
) -> int:
    """Enrich column_generation_workflows.metadata/user_id from app DB.
    Watermark + NULL-metadata backfill so the race between Temporal-path insert
    and app-path enrichment can't permanently strand a cgw row.
    """
    last_sync = get_last_sync(observer_conn, "generation_batches") or EPOCH
    tick_start = datetime.now(timezone.utc)

    batches = _fetch_batches_to_enrich(app_conn, observer_conn, last_sync)
    updated = _apply_batch_enrichment(observer_conn, batches)

    orphans = _find_orphan_batch_ids(observer_conn, batches)
    if orphans:
        logger.warning(
            "Orphan column_generation_workflows rows (batch_id not in app DB): %s",
            ", ".join(orphans),
        )

    update_last_sync(observer_conn, "generation_batches", tick_start)
    observer_conn.commit()
    logger.info(
        "Enriched %d batches (fetched %d, orphans %d, since %s, watermark→%s)",
        updated, len(batches), len(orphans), last_sync, tick_start,
    )
    return updated


_MATERIALIZED_VIEWS = (
    "mv_chat_stats",
    "mv_column_creation_stats",
    "mv_daily_activity_stats",
)


def refresh_materialized_views(observer_conn: psycopg.Connection) -> None:
    """Refresh the dashboard/list MVs.

    Uses CONCURRENTLY when the MV is already populated; falls back to plain
    REFRESH on first run (CONCURRENTLY can't run on an unpopulated MV).
    Each MV is refreshed in its own try/except — one failure doesn't block
    the others. Caller commits at phase boundaries."""
    for mv_name in _MATERIALIZED_VIEWS:
        try:
            t0 = time.monotonic()
            with observer_conn.cursor() as cur:
                cur.execute(
                    "SELECT ispopulated FROM pg_matviews "
                    "WHERE schemaname = 'public' AND matviewname = %s",
                    (mv_name,),
                )
                row = cur.fetchone()
                if row is None:
                    raise RuntimeError(f"materialized view {mv_name} does not exist")
                populated = bool(row[0])
            mode = "CONCURRENTLY" if populated else ""
            # mv_name is hardcoded — safe to interpolate.
            with observer_conn.cursor() as cur:
                cur.execute(f"REFRESH MATERIALIZED VIEW {mode} {mv_name}")
            observer_conn.commit()
            logger.info(
                "Refreshed %s (%s) in %.2fs",
                mv_name,
                mode or "blocking",
                time.monotonic() - t0,
            )
        except Exception:
            logger.exception("Failed to refresh %s; continuing", mv_name)
            observer_conn.rollback()
