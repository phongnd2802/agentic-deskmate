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


# Question markers make the Model misbehave once per question, so a retry of the same question succeeds.
_misbehaved: set[tuple[str, str]] = set()


def _misbehaves(marker: str, question: str) -> bool:
    if marker not in question or (marker, question) in _misbehaved:
        return False
    _misbehaved.add((marker, question))
    return True


async def stream_answer(messages, info) -> AsyncIterator[str]:
    question = next(p.content for m in reversed(messages) for p in m.parts if p.part_kind == "user-prompt")
    if _misbehaves("[fail]", question):
        yield "Partial text before the failure. "
        raise RuntimeError("scripted failure")
    if _misbehaves("[stall]", question):
        yield "Started writing. "
        await asyncio.sleep(3600)
    for start in range(0, len(ANSWER), 12):
        # Paced so a browser can see the Answer grow, not one buffered blob.
        await asyncio.sleep(0.05)
        yield ANSWER[start : start + 12]
