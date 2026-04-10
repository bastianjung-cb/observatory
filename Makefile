.PHONY: up down reset sync dev dev-stop build start start-stop db-shell status

# Start observer infrastructure (local Postgres only; app DB + Temporal are remote)
up:
	docker compose up -d
	@echo "Observer DB on :5436, App DB + Temporal via Azure (see .env)"

# Stop observer infrastructure
down:
	docker compose down

# Reset observer DB (wipe all data, recreate volume)
reset:
	docker compose down -v
	docker compose up -d
	@sleep 3
	@echo "DB cleared and ready. Run 'make sync' to repopulate."

# Sync all data (app + temporal → observer DB)
sync:
	cd /mnt/observer_app && uv run python main.py

# Reset and sync in one go
fresh: reset sync

# Start the web app (port 3001)
dev:
	cd /mnt/observer_app/web && npm run dev

# Stop the web app
dev-stop:
	@fuser -k 3001/tcp 2>/dev/null || true
	@echo "Dev server stopped"

# Build the web app for production
build:
	cd /mnt/observer_app/web && npm run build

# Start the production web app (port 3001)
start:
	cd /mnt/observer_app/web && PORT=3001 npm run start

# Stop the production web app
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
