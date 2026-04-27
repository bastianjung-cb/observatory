#!/usr/bin/env bash
set -euo pipefail

cd /app
echo "[entrypoint] alembic upgrade head"
uv run alembic upgrade head

cd /app/web
echo "[entrypoint] next start on port ${PORT:-3001}"
exec npm run start -- -p "${PORT:-3001}"
