# Block network access from Generative UI

Generative UI is LLM-written code that runs next to company data the User pasted into Chat, and a prompt injection in that data could make it send the data elsewhere. Its CSP therefore allows no network calls and images only from `data:` and `blob:`. Scripts load only from `cdn.jsdelivr.net` plus inline scripts, which `'unsafe-inline'` must allow because the sandbox injects generated code that way. The host asks the User to confirm the full URL before opening any link. This is deliberately stricter than CopilotKit's OpenIntelligentUI reference, whose CSP allows four CDNs, map tiles and Wikipedia images, so do not copy its CSP or its maps.

The sandbox CSP alone is not enough. A spike showed generated code sending data out by setting `location.href`, which no directive in the frame's own CSP stops, so every page that renders Generative UI must also send a `frame-src 'none'` header. CopilotKit's streaming preview iframe has no CSP and leaked data, so generated code stays out of the browser until it is complete, and Users see a placeholder while it is written.

## Consequences

Generative UI cannot show live maps, internet images, or live data, and it has no live preview. The `sendPrompt` sandbox function is not registered while Conversations are single-turn, so all interaction stays inside the sandbox.

The backend holds render tool arguments and validates them before forwarding, because neither the renderer nor the run reports a bad render. Invalid arguments mark the Answer as failed with a retry. Filtering tools by presentation only limits what the Model is offered, so this check is also what stops a Model calling a tool it was not offered.

jsDelivr serves any published npm package, so its allowance is not a trust boundary. The `frame-src` fix was tested in Chromium only.
