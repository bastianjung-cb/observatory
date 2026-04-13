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
	cd /mnt/observer_app && uv run alembic upgrade head

# Create a new migration
migration:
	@read -p "Migration name: " name && cd /mnt/observer_app && uv run alembic revision -m "$$name"

# Sync all data (app + temporal → observer DB)
sync:
	cd /mnt/observer_app && uv run python main.py

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
	cd /mnt/observer_app/web && npm run dev

# Stop the dev server
dev-stop:
	@fuser -k 3001/tcp 2>/dev/null || true
	@echo "Dev server stopped"

# Build the web app for production
build:
	cd /mnt/observer_app/web && npm run build

# Start the production web app (port 3001)
start:
	cd /mnt/observer_app/web && PORT=3001 npm run start

# Stop the production server
start-stop:
	@fuser -k 3001/tcp 2>/dev/null || true
	@echo "Production server stopped"

# Open a psql shell to the observer DB
db-shell:
	docker compose exec postgres psql -U observer -d observer

# Show running containers and ports
status:
	@docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}" | grep -E "observer|cellbyte|temporal"

# Run Python tests
test:
	cd /mnt/observer_app && uv run pytest -v

# TypeScript check
typecheck:
	cd /mnt/observer_app/web && npx tsc --noEmit
