# Make Next.js the only entry point to the Python backend

The browser talks only to Next.js, which runs `CopilotRuntime` for Chat and proxies every other request to FastAPI. This gives one origin, simple cookie handling, and a backend that is never exposed to the internet. Next.js does not touch the database: FastAPI owns sign-in, sessions and data, and authenticates every request, including checking that the chosen Model belongs to the User's Organization.
