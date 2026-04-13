ROOT := $(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))
include $(ROOT)/.env
export
LOG_FILE ?= /tmp/observatory-$(DEPLOY_PORT).log

.PHONY: up down migrate reset sync dev dev-stop build start start-stop db-shell status test typecheck

# Start observer infrastructure
up:
	docker compose up -d
	@echo "Observer DB on :5436"

# Stop observer infrastructure
down:
	docker compose down

# Run database migrations (safe, non-destructive)
migrate:
	cd $(ROOT) && uv run alembic upgrade head

# Create a new migration
migration:
	@read -p "Migration name: " name && cd $(ROOT) && uv run alembic revision -m "$$name"

# Sync all data (app + temporal → observer DB)
sync:
	cd $(ROOT) && uv run python main.py

# Reset observer DB — DESTROYS ALL DATA including irreplaceable workflow history
reset:
	@echo ""
	@echo "  ⚠️  WARNING: This will PERMANENTLY DELETE all data in the observer DB."
	@echo "  ⚠️  Workflow and activity data CANNOT be recovered if Temporal has"
	@echo "  ⚠️  already purged the original workflows."
	@echo ""
	@read -p "  Type 'yes-destroy-data' to confirm: " confirm && \
	if [ "$$confirm" = "yes-destroy-data" ]; then \
		docker compose down -v && \
		docker compose up -d && \
		sleep 3 && \
		echo "DB destroyed and recreated. Run 'make migrate && make sync' to repopulate."; \
	else \
		echo "Aborted."; \
	fi

# Reset only rebuildable data (users, chats, messages) — keeps workflows + activities
reset-app-data:
	docker compose exec postgres psql -U observer -d observer -c " \
		DELETE FROM message_parts; \
		DELETE FROM messages; \
		DELETE FROM chats; \
		DELETE FROM users; \
		DELETE FROM sync_state WHERE entity IN ('users', 'chats', 'messages', 'message_parts'); \
	"
	@echo "App data cleared. Run 'make sync' to re-sync from app DB."

# Start the web app in dev mode (port 3001)
dev:
	cd $(ROOT)/web && npm run dev

# Stop the dev server
dev-stop:
	@fuser -k 3001/tcp 2>/dev/null || true
	@echo "Dev server stopped"

# Build the web app for production
build:
	cd $(ROOT)/web && npm run build

# Start the production web app (port 3001)
start:
	cd $(ROOT)/web && PORT=3001 npm run start

# Stop the production server
start-stop:
	@fuser -k 3001/tcp 2>/dev/null || true
	@echo "Production server stopped"

# Deploy: build + run production (default port 9100, override with DEPLOY_PORT=9101)
deploy:
	@echo "Stopping existing instance on port $(DEPLOY_PORT)..."
	@fuser -k $(DEPLOY_PORT)/tcp 2>/dev/null || true
	@echo "Running migrations..."
	cd $(ROOT) && uv run alembic upgrade head
	@echo "Building web app..."
	cd $(ROOT)/web && npm run build
	@echo "Starting on port $(DEPLOY_PORT)..."
	cd $(ROOT)/web && PORT=$(DEPLOY_PORT) nohup npm run start > $(LOG_FILE) 2>&1 &
	@sleep 3
	@echo ""
	@echo "  ✓ Observatory deployed"
	@echo "  → http://100.113.17.93:$(DEPLOY_PORT) (Tailscale)"
	@echo "  → Logs: tail -f $(LOG_FILE)"
	@echo ""

# Stop the deployed instance
deploy-stop:
	@fuser -k $(DEPLOY_PORT)/tcp 2>/dev/null || true
	@echo "Deployed instance stopped"

# View deploy logs
deploy-logs:
	tail -f $(LOG_FILE)

# Open a psql shell to the observer DB
db-shell:
	docker compose exec postgres psql -U observer -d observer

# Show running containers and ports
status:
	@docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}" | grep -E "observer|cellbyte|temporal"

# Run Python tests
test:
	cd $(ROOT) && uv run pytest -v

# TypeScript check
typecheck:
	cd $(ROOT)/web && npx tsc --noEmit
