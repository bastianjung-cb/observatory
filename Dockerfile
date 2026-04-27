# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1 — Build the Next.js app
# =============================================================================
FROM node:20-bookworm-slim AS web-builder

# Build-time env vars baked into the Next.js bundle via next.config.ts.
# These are the only values that *must* be known at build time; everything else
# (DB URLs, secrets, Temporal host) is read at runtime from process.env.
ARG TEMPORAL_UI_URL=""
ARG TEMPORAL_NAMESPACE="default"
ARG APP_URL=""
ARG INSTANCE_NAME="staging"
ENV TEMPORAL_UI_URL=$TEMPORAL_UI_URL \
    TEMPORAL_NAMESPACE=$TEMPORAL_NAMESPACE \
    APP_URL=$APP_URL \
    INSTANCE_NAME=$INSTANCE_NAME \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# =============================================================================
# Stage 2 — Resolve the Python venv (sync pipeline deps)
# =============================================================================
FROM python:3.12-slim-bookworm AS py-builder
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /usr/local/bin/
WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# =============================================================================
# Stage 3 — Runtime image (Python + Node + uv + built artifacts)
# =============================================================================
FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /usr/local/bin/

WORKDIR /app

# Python deps and source for the sync pipeline.
COPY --from=py-builder /app/.venv /app/.venv
COPY pyproject.toml uv.lock alembic.ini ./
COPY main.py db.py app_sync.py temporal_client.py ./
COPY migrations/ ./migrations/

# Built Next.js + node_modules + public + config (matches the dev layout).
COPY --from=web-builder /app/web/.next /app/web/.next
COPY --from=web-builder /app/web/node_modules /app/web/node_modules
COPY --from=web-builder /app/web/public /app/web/public
COPY web/package.json web/next.config.ts /app/web/

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001

EXPOSE 3001
WORKDIR /app/web
CMD ["/app/entrypoint.sh"]
