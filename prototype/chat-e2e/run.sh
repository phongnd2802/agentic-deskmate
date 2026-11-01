#!/usr/bin/env bash
# Throwaway demo: FastAPI on :8100, Next.js on :3100.
cd "$(dirname "$0")"
trap 'kill 0' EXIT
export COPILOTKIT_TELEMETRY_DISABLED=true # runtime phones home by default
(cd agent && uv run uvicorn main:app --port 8100 --log-level warning --reload) &
(cd web && pnpm install --ignore-scripts >/dev/null; pnpm exec next dev --turbopack -p 3100) &
wait
