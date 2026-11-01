THROWAWAY PROTOTYPE. Do not build on this code: it exists to answer integration questions.

Stack under test: FastAPI + Pydantic AI 2.64.0 (`AGUIAdapter`, scripted `FunctionModel`, no LLM) behind Next.js 15.5.4 + CopilotKit 1.83.0.

## Run

```sh
./run.sh                 # FastAPI on :8100, Next.js on :3100
open http://localhost:3100
```

Prompts are keywords, not language: `slider`, `table`, `csp`, `cspnav`, `preview`, `sandboxfn`, `slowtext`, `slowtool`, `tall`, `badtable`, `nohtml`, `hallucinate`, anything else for plain text. Add `route:ogui`, `route:a2ui` or `route:none` to change which render tools the model is offered.

Page switches on `/`: `csp=off` (stock renderer), `fn=1` (register openLink), `nofollow=1` (no follow-up run), `lock=1`, `picker=1`, `vi=1`, `thread=<id>`, `hostcsp=1`, `rt=default|abort|owned` (runtime variant).

Stored pages: `/reopen/<threadId>` (no CopilotKit provider) and `/hydrate/<threadId>?delay=4000` (`agent.setMessages`). Answers live in FastAPI process memory, so a reload of `agent/main.py` empties them.

## Regenerate evidence

With `./run.sh` running: `web/e2e/all.sh`. It truncates `evidence/backend-log.jsonl` and rewrites every result file. Needs a Chromium at `~/.cache/ms-playwright/chromium-1248`, see `web/e2e/lib.mjs`.

`/evil/*` on FastAPI stands in for an attacker host, so a hit in the log means generated code reached the network.
