# Make Next.js the only entry point to the Python backend

The browser talks only to Next.js, which runs `CopilotRuntime` for Chat and proxies every other request to FastAPI. This gives one origin, simple cookie handling, and a backend that is never exposed to the internet. Next.js does not touch the database: FastAPI owns sign-in, sessions and data, and authenticates every request, including checking that the chosen Model belongs to the User's Organization.

## Consequences

`CopilotRuntime` answers `/connect` and `/stop` from its own memory without calling FastAPI, and a spike showed `/connect` replaying one User's Conversation to another caller that knew the `threadId`. Every runtime request must therefore pass `identifyUser`, which asks FastAPI to validate the session, so FastAPI still decides who the caller is even when it does not serve the request. The runtime must also allow the `cookie` header through `forwardHeaders`, because it does not forward cookies by default.
