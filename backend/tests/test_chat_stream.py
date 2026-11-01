"""Seam 1: the real AG-UI endpoint with the scripted Model, no browser and no real LLM."""

import json

import httpx2

from app.main import app


RUN_INPUT = {
    "threadId": "thread-1",
    "runId": "run-1",
    "messages": [{"id": "m1", "role": "user", "content": "What is this skeleton?"}],
    "tools": [],
    "context": [],
    "state": {},
    "forwardedProps": {},
}


async def _sign_in(client: httpx2.AsyncClient, email: str, password: str) -> None:
    response = await client.post("/auth/sign-in", json={"email": email, "password": password})
    assert response.status_code == 200, response.text


async def ask_ag_ui(client: httpx2.AsyncClient) -> list[dict]:
    async with client.stream("POST", "/agent", json=RUN_INPUT) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        lines = [line async for line in response.aiter_lines()]

    events = [json.loads(line.removeprefix("data: ")) for line in lines if line.startswith("data: ")]
    assert any(event["type"] == "RUN_FINISHED" for event in events)
    return events


async def test_answer_streams_from_the_scripted_model(admin_credentials):
    email, password = admin_credentials
    transport = httpx2.ASGITransport(app=app)
    async with httpx2.AsyncClient(transport=transport, base_url="http://test") as client:
        await _sign_in(client, email, password)
        events = await ask_ag_ui(client)

    deltas = [event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT"]
    assert len(deltas) > 1, "the Answer must arrive in pieces, not one buffered blob"

    answer = "".join(deltas)
    assert "Scripted Answer" in answer
    assert "```python" in answer, "the Answer must carry Markdown with a fenced code block"
