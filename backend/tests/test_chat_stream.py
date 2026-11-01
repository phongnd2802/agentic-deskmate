"""Seam 1: the real AG-UI endpoint with the scripted Model, no browser and no real LLM."""

import json

import httpx2


RUN_INPUT = {
    "threadId": "6f1c2b0e-3d7a-4b8e-9a51-0c7d2f4e8a11",
    "runId": "run-1",
    "messages": [{"id": "m1", "role": "user", "content": "What is this skeleton?"}],
    "tools": [],
    "context": [],
    "state": {},
    "forwardedProps": {},
}


async def ask_ag_ui(client: httpx2.AsyncClient) -> list[dict]:
    run = {**RUN_INPUT, "forwardedProps": {"modelId": client.model_id}}
    async with client.stream("POST", "/agent", json=run) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        lines = [line async for line in response.aiter_lines()]

    events = [json.loads(line.removeprefix("data: ")) for line in lines if line.startswith("data: ")]
    assert any(event["type"] == "RUN_FINISHED" for event in events)
    return events


async def test_answer_streams_from_the_scripted_model(people):
    events = await ask_ag_ui(people["member"])

    deltas = [event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT"]
    assert len(deltas) > 1, "the Answer must arrive in pieces, not one buffered blob"

    answer = "".join(deltas)
    assert "Scripted Answer" in answer
    assert "```python" in answer, "the Answer must carry Markdown with a fenced code block"
