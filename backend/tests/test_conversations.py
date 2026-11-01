"""Seam 1: Conversations over HTTP against real Postgres with RLS on and the scripted Model."""

import asyncio
import json
import time
import os
import uuid

import asyncpg
import httpx2
import pytest
from argon2 import PasswordHasher
from pydantic_ai.models.function import FunctionModel

import app.agent.chat as chat
import app.api.routes as routes
from app.services import conversations
from app.agent import scripted
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


def _body(thread_id: str, question: str, history: list[dict] | None = None, props: dict | None = None) -> dict:
    return {
        "threadId": thread_id,
        "runId": f"run-{uuid.uuid4().hex[:6]}",
        "messages": [*(history or []), {"id": "q", "role": "user", "content": question}],
        "tools": [],
        "context": [],
        "state": {},
        "forwardedProps": props or {},
    }


async def ask(client: httpx2.AsyncClient, thread_id: str, question: str, history: list[dict] | None = None, props: dict | None = None) -> list[dict]:
    body = _body(thread_id, question, history, props)
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

    monkeypatch.setattr(chat, "build_model", lambda model_id=None: FunctionModel(stream_function=record, model_name="recorder"))
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


async def retry(client: httpx2.AsyncClient, thread_id: str) -> list[dict]:
    # The browser re-sends its history; the backend must take the question from storage, not from this.
    return await ask(client, thread_id, "ignored by a retry", props={"retry": True})


async def answers(client: httpx2.AsyncClient, thread_id: str) -> list[dict]:
    return (await client.get(f"/conversations/{thread_id}")).json()["answers"]


def start_run(client: httpx2.AsyncClient, thread_id: str, question: str, props: dict | None = None):
    """Run /agent straight through ASGI, so a test can hang up the way a runner aborting its fetch does.

    The test transport buffers a whole response, so it cannot disconnect mid-stream.
    """
    body = json.dumps(_body(thread_id, question, props=props)).encode()
    cookie = "; ".join(f"{name}={value}" for name, value in client.cookies.items())
    first_text, hang_up, sent = asyncio.Event(), asyncio.Event(), False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        await hang_up.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if b"TEXT_MESSAGE_CONTENT" in message.get("body", b""):
            first_text.set()

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "path": "/agent",
        "raw_path": b"/agent",
        "query_string": b"",
        "headers": [(b"content-type", b"application/json"), (b"cookie", cookie.encode())],
        "server": ("test", 80),
        "client": ("test", 1),
    }
    return first_text, hang_up, asyncio.create_task(app(scope, receive, send))


async def stop(first_text: asyncio.Event, hang_up: asyncio.Event, run: asyncio.Task) -> None:
    await asyncio.wait_for(first_text.wait(), 10)
    hang_up.set()
    await asyncio.wait_for(run, 10)


async def stored(client: httpx2.AsyncClient, thread_id: str, count: int) -> list[dict]:
    """The write after a hang-up runs on its own, so wait for it instead of assuming it is done."""
    deadline = time.monotonic() + 10
    while len(found := await answers(client, thread_id)) < count and time.monotonic() < deadline:
        await asyncio.sleep(0.1)
    return found


async def test_stopping_an_answer_stores_its_partial_text_as_stopped(people):
    thread = str(uuid.uuid4())
    await stop(*start_run(people["member"], thread, "[stall] stop me"))

    [answer] = await stored(people["member"], thread, 1)
    assert answer["status"] == "stopped"
    assert answer["parts"] == [{"type": "text", "text": "Started writing. "}]


async def test_a_model_failure_stores_the_partial_text_as_failed_and_reports_a_readable_error(people):
    thread = str(uuid.uuid4())
    events = await ask(people["member"], thread, "[fail] break")

    assert types(events)[-1] == "RUN_ERROR"
    assert events[-1]["code"] == "model_failed"
    assert "scripted failure" not in events[-1]["message"]
    [answer] = await answers(people["member"], thread)
    assert answer["status"] == "failed"
    assert answer["parts"] == [{"type": "text", "text": "Partial text before the failure. "}]


async def test_retrying_a_failed_answer_adds_an_answer_with_the_same_model(people, monkeypatch):
    built: list[str | None] = []

    def build(model_id=None):
        built.append(model_id)
        return FunctionModel(stream_function=scripted.stream_answer, model_name=model_id or "model-a")

    monkeypatch.setattr(chat, "build_model", build)
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "[fail] again")
    [failed] = await answers(people["member"], thread)

    events = await retry(people["member"], thread)

    assert "RUN_FINISHED" in types(events)
    first, second = await answers(people["member"], thread)
    assert first == failed
    assert (second["status"], second["model_id"]) == ("complete", "model-a")
    assert second["id"] != first["id"] and second["run_id"] != first["run_id"]
    assert built[-1] == "model-a"
    conversation = (await people["member"].get(f"/conversations/{thread}")).json()
    assert conversation["question"] == "[fail] again"


async def test_retrying_a_stopped_answer_adds_an_answer(people):
    thread = str(uuid.uuid4())
    await stop(*start_run(people["member"], thread, "[stall] stop then retry"))
    await stored(people["member"], thread, 1)

    await retry(people["member"], thread)

    assert [a["status"] for a in await answers(people["member"], thread)] == ["stopped", "complete"]


async def test_a_retry_on_a_complete_answer_is_refused(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "all fine")

    events = await retry(people["member"], thread)

    assert types(events) == ["RUN_STARTED", "RUN_ERROR"]
    assert events[-1]["code"] == "not_retryable"
    assert len(await answers(people["member"], thread)) == 1


async def test_nobody_else_can_retry_my_conversation(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "[fail] mine")

    for who in ("admin", "outsider"):
        events = await retry(people[who], thread)
        assert events[-1]["code"] == "not_retryable", who

    assert [a["status"] for a in await answers(people["member"], thread)] == ["failed"]


async def test_two_concurrent_retries_add_one_answer(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "[fail] twice")

    first, second = await asyncio.gather(retry(people["member"], thread), retry(people["member"], thread))

    assert sorted(types(events)[-1] for events in (first, second)) == ["RUN_ERROR", "RUN_FINISHED"]
    assert [a["status"] for a in await answers(people["member"], thread)] == ["failed", "complete"]


async def test_a_retry_while_an_answer_is_streaming_is_refused(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "[fail][stall] busy")
    running = start_run(people["member"], thread, "x", props={"retry": True})
    await asyncio.wait_for(running[0].wait(), 10)

    events = await retry(people["member"], thread)
    assert events[-1]["code"] == "answer_in_progress"

    # A stranger during the live run learns nothing about it.
    for who in ("admin", "outsider"):
        assert (await retry(people[who], thread))[-1]["code"] == "not_retryable", who

    await stop(*running)
    assert [a["status"] for a in await stored(people["member"], thread, 2)] == ["failed", "stopped"]


async def _boom(messages, info):
    yield "half "
    raise RuntimeError("always fails")


async def _silent(messages, info):
    await asyncio.sleep(3600)
    yield "never"


async def test_a_failed_retry_can_be_retried_again(people, monkeypatch):
    monkeypatch.setattr(chat, "build_model", lambda model_id=None: FunctionModel(stream_function=_boom, model_name="boom"))
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "never works")
    await retry(people["member"], thread)
    await retry(people["member"], thread)

    assert [a["status"] for a in await answers(people["member"], thread)] == ["failed"] * 3


async def test_an_answer_with_no_text_is_stored_with_its_status_and_can_be_retried(people, monkeypatch):
    thread = str(uuid.uuid4())
    with monkeypatch.context() as m:
        m.setattr(chat, "build_model", lambda model_id=None: FunctionModel(stream_function=_silent, model_name="silent"))
        _, hang_up, run = start_run(people["member"], thread, "say nothing")
        await asyncio.sleep(0.5)
        hang_up.set()
        await asyncio.wait_for(run, 10)
    [answer] = await stored(people["member"], thread, 1)
    assert (answer["status"], answer["parts"]) == ("stopped", [])

    await retry(people["member"], thread)

    assert [a["status"] for a in await answers(people["member"], thread)] == ["stopped", "complete"]


async def test_a_run_that_cannot_save_ends_with_an_error_and_its_question_can_be_retried(people, monkeypatch):
    thread = str(uuid.uuid4())
    with monkeypatch.context() as m:
        async def broken(*args, **kwargs):
            raise RuntimeError("database is down")

        m.setattr(conversations, "save_answer", broken)
        events = await ask(people["member"], thread, "lost answer")
    assert events[-1]["code"] == "answer_not_saved"
    assert await answers(people["member"], thread) == []

    events = await retry(people["member"], thread)

    assert "RUN_FINISHED" in types(events)
    assert [a["status"] for a in await answers(people["member"], thread)] == ["complete"]


async def test_an_unexpected_error_inside_the_run_stores_a_failed_answer(people, monkeypatch):
    seen, original = 0, routes._track

    def track(parts, event):
        nonlocal seen
        seen += 1
        if seen > 3:
            raise RuntimeError("bug")
        original(parts, event)

    monkeypatch.setattr(routes, "_track", track)
    thread = str(uuid.uuid4())
    events = await ask(people["member"], thread, "trip the run")

    assert events[-1]["code"] == "model_failed"
    [answer] = await answers(people["member"], thread)
    assert answer["status"] == "failed"
