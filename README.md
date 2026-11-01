# agentic-deskmate

A team of AI teammates: agents that work with files, run code, browse the web, and use your company's tools and knowledge.

## Status

Walking skeleton. A question in Chat streams an Answer from a scripted Model through Next.js, `CopilotRuntime`, AG-UI and FastAPI. Nothing is saved and nobody signs in yet.

## Development

Requires Docker with Compose and `make`. `uv` and Bun are installed in the containers; install them on the host only for the tests below.

```sh
make dev                 # Postgres, FastAPI and Next.js with hot reload
open http://localhost:3000
```

An Admin adds Providers in Settings; Users pick one of their Models in the composer. Set `ENCRYPTION_KEY` (a Fernet key) to protect stored API keys; Compose has a development default. Private and loopback Provider addresses are blocked unless `PROVIDER_ALLOWED_NETWORKS` lists their network (comma-separated CIDR). FastAPI is not published to the host: the browser only talks to Next.js, which proxies the run to the backend inside the Compose network.

## Tests

```sh
make test                # both seams, then typecheck
make test-backend        # Seam 1: the real AG-UI endpoint with the scripted Model
make test-e2e            # Seam 2: Playwright through Next.js (starts and stops Compose)
make typecheck
```

The single Model factory in `backend/app/agent/factory.py` is the substitution point: both seams use its scripted Model, so no test needs a real LLM or API key. It returns the scripted Model when `SCRIPTED_MODEL=true`, which the tests and `make test-e2e` set.

## API types

The frontend's `src/lib/api-types.ts` is generated from the backend's OpenAPI document. Regenerate after changing the API, and commit the result; CI fails when it is stale.

```sh
make api-types
make api-types-check
```
