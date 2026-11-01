# Block network access from Generative UI

Generative UI is LLM-written code that runs next to company data the User pasted into Chat, and a prompt injection in that data could make it send the data elsewhere. Its CSP therefore allows no network calls, scripts only from `cdn.jsdelivr.net`, and images only from `data:` and `blob:`, and the host asks the User to confirm the full URL before opening any link. This is deliberately stricter than CopilotKit's OpenIntelligentUI reference, whose CSP allows four CDNs, map tiles and Wikipedia images, so do not copy its CSP or its maps.

## Consequences

Generative UI cannot show live maps, internet images, or live data. The `sendPrompt` sandbox function is not registered while Conversations are single-turn, so all interaction stays inside the sandbox.
