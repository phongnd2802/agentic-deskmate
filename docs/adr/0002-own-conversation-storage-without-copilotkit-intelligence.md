# Store Conversations ourselves instead of using CopilotKit Intelligence

CopilotKit's Threads feature belongs to its Intelligence platform, which cannot use our own store and needs Kubernetes to self-host. We keep Conversations and Answers in our Postgres so they stay under Organization isolation (ADR-0001), and use CopilotKit only for streaming and rendering. The Conversation ID is the AG-UI `threadId`, and the backend ignores any history the browser sends. The Generative UI tool is registered with `followUp: false`, so one Answer is one run and no second run carries browser-sent history.

## Consequences

Reopening a Conversation does not replay events. It is a read-only page that renders the stored text and Generative UI with no agent run, and values a User changed inside a Generative UI are not saved.

Closing the browser does not stop a run: the Answer finishes and is stored, still spending tokens. Only the stop button cancels it, and the partial Answer is kept as stopped.

`CopilotRuntime`'s in-memory runner also holds run content in Next.js memory, so Postgres is not the only copy. We accept this for the development-only version, which runs a single instance with no real data. It must be reviewed before production, because it keeps Conversation content outside Postgres and multiple Next.js instances would split stop and reconnect.
