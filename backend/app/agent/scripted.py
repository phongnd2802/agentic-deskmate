"""A deterministic stand-in for a real Model, so tests and dev need no API key."""

import asyncio
from collections.abc import AsyncIterator

ANSWER = """## Scripted Answer

This text streamed from the scripted Model through **CopilotRuntime** and AG-UI.

```python
def greet(name: str) -> str:
    return f"Hello, {name}"
```

The walking skeleton is working.
"""


async def stream_answer(messages, info) -> AsyncIterator[str]:
    for start in range(0, len(ANSWER), 12):
        # Paced so a browser can see the Answer grow, not one buffered blob.
        await asyncio.sleep(0.05)
        yield ANSWER[start : start + 12]
