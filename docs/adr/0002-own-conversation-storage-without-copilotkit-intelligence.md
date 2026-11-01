# Store Conversations ourselves instead of using CopilotKit Intelligence

CopilotKit's Threads feature belongs to its Intelligence platform, which cannot use our own store and needs Kubernetes to self-host. We keep Conversations and Answers in our Postgres so they stay under Organization isolation (ADR-0001), and use CopilotKit only for streaming and rendering. The Conversation ID is the AG-UI `threadId`, and the backend ignores any history the browser sends.

## Consequences

Reopening a Conversation does not replay events. It is a read-only page that renders the stored text and Generative UI, and values a User changed inside a Generative UI are not saved. A run cannot resume after the browser disconnects.
