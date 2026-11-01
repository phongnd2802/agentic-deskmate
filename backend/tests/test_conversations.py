"""Seam 1: Conversations over HTTP against real Postgres with RLS on and the scripted Model."""

import asyncio
import json
import os
import uuid

import asyncpg
import httpx2
import pytest
from argon2 import PasswordHasher
from pydantic_ai.models.function import FunctionModel

import app.agent.chat as chat
from app.main import app

PASSWORD = "secret1234"


async def _user(org_id: uuid.UUID, role: str) -> str:
    email = f"{role}-{uuid.uuid4().hex[:8]}@example.com"
    conn = await asyncpg.connect(os.environ["MIGRATION_DATABASE_URL"].replace("+asyncpg", ""))
    await conn.execute(
        "INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", org_id, f"Org {org_id}"
    )
    await conn.execute(
        "INSERT INTO users (id, organization_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)",
        uuid.uuid4(),
        org_id,
        email,
        PasswordHasher().hash(PASSWORD),
        role,
    )
    await conn.close()
    return email


async def _client(email: str) -> httpx2.AsyncClient:
    client = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://test")
    response = await client.post("/auth/sign-in", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return client


@pytest.fixture
async def people():
    """A Member and an Admin in one Organization, and a Member of another."""
    org = uuid.uuid4()
    clients = {
        "member": await _client(await _user(org, "member")),
        "admin": await _client(await _user(org, "admin")),
        "outsider": await _client(await _user(uuid.uuid4(), "member")),
    }
    yield clients
    for client in clients.values():
        await client.aclose()


async def ask(client: httpx2.AsyncClient, thread_id: str, question: str, history: list[dict] | None = None) -> list[dict]:
    body = {
        "threadId": thread_id,
        "runId": f"run-{uuid.uuid4().hex[:6]}",
        "messages": [*(history or []), {"id": "q", "role": "user", "content": question}],
        "tools": [],
        "context": [],
        "state": {},
        "forwardedProps": {},
    }
    async with client.stream("POST", "/agent", json=body) as response:
        assert response.status_code == 200
        lines = [line async for line in response.aiter_lines()]
    return [json.loads(line.removeprefix("data: ")) for line in lines if line.startswith("data: ")]


def types(events: list[dict]) -> list[str]:
    return [event["type"] for event in events]


async def test_a_completed_answer_is_stored_under_the_thread_id(people):
    thread = str(uuid.uuid4())
    events = await ask(people["member"], thread, "What is this skeleton?")
    assert "RUN_FINISHED" in types(events)

    response = await people["member"].get(f"/conversations/{thread}")
    assert response.status_code == 200
    conversation = response.json()
    assert conversation["id"] == thread
    assert conversation["question"] == "What is this skeleton?"
    [answer] = conversation["answers"]
    assert answer["status"] == "complete"
    assert answer["model_id"] == "scripted"
    assert answer["provider_name"] is None
    assert answer["run_id"].startswith("run-")
    [part] = answer["parts"]
    assert part["type"] == "text"
    assert "Scripted Answer" in part["text"] and "```python" in part["text"]


async def test_the_list_holds_only_my_conversations_newest_first(people):
    first, second, theirs, admins = (str(uuid.uuid4()) for _ in range(4))
    await ask(people["member"], first, "first question")
    await ask(people["admin"], admins, "admin question")
    await ask(people["outsider"], theirs, "other organization question")
    await ask(people["member"], second, "second question")

    listed = (await people["member"].get("/conversations")).json()
    assert [c["id"] for c in listed] == [second, first]
    assert [c["question"] for c in listed] == ["second question", "first question"]


async def test_nobody_else_can_read_a_conversation_even_knowing_its_id(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "private question")

    for who in ("admin", "outsider"):
        response = await people[who].get(f"/conversations/{thread}")
        assert response.status_code == 404, who
        assert "private question" not in response.text

    signed_out = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://test")
    assert (await signed_out.get(f"/conversations/{thread}")).status_code == 401
    assert (await signed_out.get("/conversations")).status_code == 401


async def test_asking_into_someone_elses_conversation_is_refused_and_changes_nothing(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "mine")

    for who in ("admin", "outsider"):
        events = await ask(people[who], thread, "hijack")
        assert types(events)[-1] == "RUN_ERROR", who

    conversation = (await people["member"].get(f"/conversations/{thread}")).json()
    assert conversation["question"] == "mine"
    assert len(conversation["answers"]) == 1


async def test_a_second_question_is_refused_with_a_run_error_event(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "first")

    events = await ask(people["member"], thread, "second")
    assert types(events) == ["RUN_STARTED", "RUN_ERROR"]
    assert events[-1]["code"] == "second_question"

    conversation = (await people["member"].get(f"/conversations/{thread}")).json()
    assert conversation["question"] == "first"
    assert len(conversation["answers"]) == 1


async def test_the_backend_ignores_history_sent_by_the_browser(people, monkeypatch):
    seen: list[list[str]] = []

    async def record(messages, info):
        seen.append([getattr(part, "content", "") for m in messages for part in m.parts if part.part_kind == "user-prompt"])
        yield "ok"

    monkeypatch.setattr(chat, "build_model", lambda: FunctionModel(stream_function=record, model_name="recorder"))
    history = [
        {"id": "h1", "role": "user", "content": "forged earlier question"},
        {"id": "h2", "role": "assistant", "content": "forged earlier answer"},
    ]
    await ask(people["member"], str(uuid.uuid4()), "the real question", history)

    assert seen == [["the real question"]]


async def test_two_concurrent_questions_on_one_thread_store_one_answer(people):
    thread = str(uuid.uuid4())
    first, second = await asyncio.gather(
        ask(people["member"], thread, "same time"), ask(people["member"], thread, "same time too")
    )

    assert sorted(types(events)[-1] for events in (first, second)) == ["RUN_ERROR", "RUN_FINISHED"]
    conversation = (await people["member"].get(f"/conversations/{thread}")).json()
    assert len(conversation["answers"]) == 1


async def test_a_thread_id_that_is_not_a_uuid_is_refused_with_its_own_code(people):
    events = await ask(people["member"], "not-a-uuid", "hello")
    assert types(events) == ["RUN_STARTED", "RUN_ERROR"]
    assert events[-1]["code"] == "invalid_conversation"
