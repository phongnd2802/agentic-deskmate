.PHONY: dev down test test-backend test-e2e typecheck api-types api-types-check

# One command: Postgres, backend and frontend with hot reload (Docker Compose).
dev:
	docker compose up --build

down:
	docker compose down

test: test-backend typecheck test-e2e

# Seam 1: the real AG-UI endpoint with the scripted Model.
test-backend:
	cd backend && uv run pytest

typecheck:
	cd frontend && bun run typecheck

# Seam 2: the browser through Next.js.
test-e2e:
	docker compose up -d --build --wait
	cd frontend && bunx playwright test
	docker compose down

api-types:
	cd backend && uv run python -m app.openapi /tmp/deskmate-openapi.json
	cd frontend && bunx openapi-typescript /tmp/deskmate-openapi.json -o src/lib/api-types.ts

# Fails when the committed types no longer match the backend's OpenAPI document.
api-types-check: api-types
	git diff --exit-code -- frontend/src/lib/api-types.ts
