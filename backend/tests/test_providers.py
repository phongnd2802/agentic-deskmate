"""Seam 1: Providers and Models over HTTP, and the run that uses them, with the scripted Model."""

import asyncio
import json
import logging
import uuid

import pytest
from pydantic_ai.models.function import FunctionModel

import app.agent.chat as chat
from app.net import BlockedAddress, checked_http_client
from app.settings import settings
from tests.conftest import PROVIDER
from tests.test_conversations import answers, ask, start_run, stop, stored, types

KEY = PROVIDER["api_key"]


async def stored_key(owner_conn, name: str) -> str:
    return await owner_conn.fetchval("SELECT api_key_encrypted FROM providers WHERE name = $1", name)


async def test_an_admin_adds_edits_and_deletes_a_provider_of_either_api_type(people):
    admin = people["admin"]
    created = await admin.post("/providers", json={**PROVIDER, "name": "Claude", "api_type": "anthropic", "models": [{"model_id": "m1"}, {"model_id": "m2", "generative_ui": True}]})
    assert created.status_code == 201, created.text
    provider = created.json()
    assert (provider["api_type"], provider["base_url"]) == ("anthropic", PROVIDER["base_url"])
    # The Generative UI flag defaults to off.
    assert [(m["model_id"], m["generative_ui"]) for m in provider["models"]] == [("m1", False), ("m2", True)]

    edited = await admin.put(
        f"/providers/{provider['id']}",
        json={"name": "Claude 2", "api_type": "openai", "base_url": "https://1.1.1.1/v1", "api_key": "", "models": [{"model_id": "m2", "generative_ui": False}, {"model_id": "m3"}]},
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert (body["name"], body["api_type"], body["base_url"]) == ("Claude 2", "openai", "https://1.1.1.1/v1")
    by_id = {m["model_id"]: m for m in body["models"]}
    assert set(by_id) == {"m2", "m3"}
    assert by_id["m2"]["id"] == next(m["id"] for m in provider["models"] if m["model_id"] == "m2"), "an existing Model keeps its ID"
    assert by_id["m2"]["generative_ui"] is False

    listed = (await admin.get("/providers")).json()
    assert {p["name"] for p in listed} == {"Acme", "Claude 2"}

    assert (await admin.delete(f"/providers/{provider['id']}")).status_code == 204
    assert {p["name"] for p in (await admin.get("/providers")).json()} == {"Acme"}


async def test_the_api_key_is_encrypted_never_returned_and_an_empty_key_keeps_it(people, owner_conn):
    admin = people["admin"]
    created = await admin.post("/providers", json={**PROVIDER, "name": "Secretive"})
    provider = created.json()
    for response in (created, await admin.get("/providers"), await admin.get("/models")):
        assert KEY not in response.text and "api_key" not in response.text

    first = await stored_key(owner_conn, "Secretive")
    assert KEY not in first, "the key must not be stored as plain text"

    await admin.put(f"/providers/{provider['id']}", json={**PROVIDER, "name": "Secretive", "api_key": ""})
    assert await stored_key(owner_conn, "Secretive") == first

    await admin.put(f"/providers/{provider['id']}", json={**PROVIDER, "name": "Secretive", "api_key": "sk-rotated"})
    assert await stored_key(owner_conn, "Secretive") != first


async def test_a_new_provider_needs_a_key_and_a_unique_name(people):
    admin = people["admin"]
    assert (await admin.post("/providers", json={**PROVIDER, "name": "No key", "api_key": ""})).status_code == 422
    assert (await admin.post("/providers", json=PROVIDER)).status_code == 409


async def test_a_member_cannot_reach_provider_configuration(people):
    member = people["member"]
    provider_id = (await people["admin"].get("/providers")).json()[0]["id"]
    calls = [
        member.get("/providers"),
        member.post("/providers", json=PROVIDER),
        member.put(f"/providers/{provider_id}", json=PROVIDER),
        member.delete(f"/providers/{provider_id}"),
    ]
    assert [r.status_code for r in await asyncio.gather(*calls)] == [403, 403, 403, 403]
    assert len((await people["admin"].get("/providers")).json()) == 1


async def test_another_organizations_provider_behaves_as_not_found(people):
    theirs = (await people["outsider_admin"].get("/providers")).json()[0]["id"]
    admin = people["admin"]
    assert (await admin.put(f"/providers/{theirs}", json=PROVIDER)).status_code == 404
    assert (await admin.delete(f"/providers/{theirs}")).status_code == 404
    assert len((await people["outsider_admin"].get("/providers")).json()) == 1
    assert theirs not in (await admin.get("/providers")).text


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/v1",
        "http://localhost:11434/v1",  # a hostname that resolves to loopback
        "http://10.0.0.5/v1",
        "http://192.168.1.1/v1",
        "http://172.16.0.1/v1",
        "http://169.254.169.254/latest/meta-data",  # cloud metadata
        "http://[::1]/v1",
        "http://[::ffff:127.0.0.1]/v1",  # IPv4-mapped IPv6
        "http://[fe80::1]/v1",
        "http://[fd00::1]/v1",
        "http://0.0.0.0/v1",
        "http://224.0.0.1/v1",  # multicast
        "http://240.0.0.1/v1",  # reserved
        "http://[ff02::1]/v1",
        "http://[::7f00:1]/v1",  # IPv4-compatible 127.0.0.1
        "http://[64:ff9b::a9fe:a9fe]/v1",  # NAT64 of 169.254.169.254
        "http://[2002:7f00:1::]/v1",  # 6to4 of 127.0.0.1
        "ftp://8.8.8.8/v1",
    ],
)
async def test_private_and_loopback_addresses_are_refused_with_a_clear_message(people, url):
    response = await people["admin"].post("/providers", json={**PROVIDER, "name": "Bad", "base_url": url})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] in ("blocked_address", "invalid_base_url") and detail["message"]
    assert "Bad" not in {p["name"] for p in (await people["admin"].get("/providers")).json()}


async def test_an_allowlisted_network_is_accepted(people, monkeypatch):
    monkeypatch.setattr(settings, "provider_allowed_networks", "127.0.0.0/8, 10.0.0.0/8")
    for url in ("http://127.0.0.1:11434/v1", "http://10.1.2.3/v1", "http://localhost/v1", "http://[::ffff:127.0.0.1]/v1"):
        response = await people["admin"].post("/providers", json={**PROVIDER, "name": url, "base_url": url})
        assert response.status_code == 201, (url, response.text)
    # Only the listed networks: the metadata address stays blocked.
    response = await people["admin"].post("/providers", json={**PROVIDER, "name": "meta", "base_url": "http://169.254.169.254/"})
    assert response.status_code == 422


async def test_users_see_only_their_organizations_models(people):
    mine = (await people["member"].get("/models")).json()
    theirs = (await people["outsider"].get("/models")).json()
    assert [(m["provider_name"], m["model_id"]) for m in mine] == [("Acme", "model-a")]
    assert "generative_ui" not in mine[0]
    assert mine[0]["id"] == people["member"].model_id != people["outsider"].model_id
    assert [m["id"] for m in theirs] == [people["outsider"].model_id]
    assert (await people["admin"].get("/providers")).status_code == 200


async def test_the_backend_rejects_a_model_outside_the_users_organization(people):
    for sent in (people["outsider"].model_id, str(uuid.uuid4()), "model-a", None):
        thread = str(uuid.uuid4())
        events = await ask(people["member"], thread, "hello", props={"modelId": sent})
        assert types(events) == ["RUN_STARTED", "RUN_ERROR"], sent
        assert events[-1]["code"] == "model_not_found"
        assert (await people["member"].get(f"/conversations/{thread}")).status_code == 404, "a refused question starts nothing"


async def test_an_organization_with_no_provider_has_no_models_and_cannot_ask(people):
    admin = people["admin"]
    for provider in (await admin.get("/providers")).json():
        await admin.delete(f"/providers/{provider['id']}")
    assert (await people["member"].get("/models")).json() == []
    events = await ask(people["member"], str(uuid.uuid4()), "hello")
    assert events[-1]["code"] == "model_not_found"


async def test_an_answer_names_its_provider_and_model_and_survives_deleting_the_provider(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "what is this?")
    provider_id = (await people["admin"].get("/providers")).json()[0]["id"]

    assert (await people["admin"].delete(f"/providers/{provider_id}")).status_code == 204

    [answer] = await answers(people["member"], thread)
    assert (answer["status"], answer["provider_name"], answer["model_id"]) == ("complete", "Acme", "model-a")
    assert "Scripted Answer" in answer["parts"][0]["text"]


async def test_retrying_after_the_provider_is_deleted_is_refused_cleanly(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "[fail] retry me")
    provider_id = (await people["admin"].get("/providers")).json()[0]["id"]
    await people["admin"].delete(f"/providers/{provider_id}")

    events = await ask(people["member"], thread, "ignored", props={"retry": True})

    assert types(events) == ["RUN_STARTED", "RUN_ERROR"]
    assert events[-1]["code"] == "model_unavailable"
    [only] = await answers(people["member"], thread)
    assert only["status"] == "failed"


async def test_a_retry_follows_the_model_through_a_rename_but_not_to_a_new_provider_with_the_same_name(people):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "[fail] rename")
    provider = (await people["admin"].get("/providers")).json()[0]

    renamed = await people["admin"].put(f"/providers/{provider['id']}", json={**PROVIDER, "name": "Renamed", "api_key": ""})
    assert renamed.status_code == 200
    assert "RUN_FINISHED" in types(await ask(people["member"], thread, "ignored", props={"retry": True}))
    [_, second] = await answers(people["member"], thread)
    assert (second["provider_name"], second["model_id"]) == ("Renamed", "model-a")

    # A different Provider that reuses the old name and Model ID is not the Model that wrote the Answer.
    other = str(uuid.uuid4())
    await ask(people["member"], other, "[fail] reuse")
    await people["admin"].delete(f"/providers/{provider['id']}")
    assert (await people["admin"].post("/providers", json={**PROVIDER, "name": "Renamed", "base_url": "https://1.1.1.1/v1"})).status_code == 201
    events = await ask(people["member"], other, "ignored", props={"retry": True})
    assert events[-1]["code"] == "model_unavailable"


async def test_a_retry_of_an_answer_with_no_stored_model_is_refused(people, owner_conn):
    thread = str(uuid.uuid4())
    await ask(people["member"], thread, "[fail] old row")
    await owner_conn.execute("UPDATE answers SET model_row_id = NULL WHERE conversation_id = $1", uuid.UUID(thread))
    events = await ask(people["member"], thread, "ignored", props={"retry": True})
    assert events[-1]["code"] == "model_unavailable"


async def test_the_run_names_the_provider_and_model_it_uses_even_on_a_retry(people):
    thread = str(uuid.uuid4())
    events = await ask(people["member"], thread, "[fail] name me")
    [named] = [e for e in events if e["type"] == "CUSTOM"]
    assert (named["name"], named["value"]) == ("model", {"provider_name": "Acme", "model_id": "model-a"})
    assert types(events)[0] == "RUN_STARTED"

    await people["admin"].put(
        f"/providers/{(await people['admin'].get('/providers')).json()[0]['id']}", json={**PROVIDER, "name": "Renamed", "api_key": ""}
    )
    retried = await ask(people["member"], thread, "ignored", props={"retry": True})
    assert [e["value"] for e in retried if e["type"] == "CUSTOM"] == [{"provider_name": "Renamed", "model_id": "model-a"}]


async def test_a_run_in_flight_finishes_and_is_stored_when_its_provider_is_deleted(people):
    thread = str(uuid.uuid4())
    first_text, hang_up, run = start_run(people["member"], thread, "delete my provider mid-answer")
    await asyncio.wait_for(first_text.wait(), 10)

    provider_id = (await people["admin"].get("/providers")).json()[0]["id"]
    assert (await people["admin"].delete(f"/providers/{provider_id}")).status_code == 204
    await asyncio.wait_for(run, 10)
    hang_up.set()

    [answer] = await stored(people["member"], thread, 1)
    assert (answer["status"], answer["provider_name"]) == ("complete", "Acme")


@pytest.fixture
async def stub():
    """A loopback HTTP server standing in for an LLM service. It counts connections and answers 401, echoing the key."""
    connections: list[bytes] = []

    async def handle(reader, writer):
        connections.append(await reader.read(4096))
        body = json.dumps({"error": {"message": f"Incorrect API key provided: {KEY}"}}).encode()
        writer.write(b"HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: %d\r\n\r\n%s" % (len(body), body))
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    yield server.sockets[0].getsockname()[1], connections
    server.close()


@pytest.mark.parametrize("api_type", ["openai", "anthropic"])
async def test_a_real_call_goes_only_to_allowed_addresses_and_never_leaks_the_key(people, stub, monkeypatch, caplog, api_type):
    port, connections = stub
    monkeypatch.setattr(settings, "scripted_model", False)
    monkeypatch.setattr(settings, "provider_allowed_networks", "127.0.0.0/8")
    admin, member = people["admin"], people["member"]
    created = await admin.post("/providers", json={**PROVIDER, "name": "Local", "api_type": api_type, "base_url": f"http://localhost:{port}/v1", "models": [{"model_id": "local-model"}]})
    assert created.status_code == 201, created.text
    local = created.json()["models"][0]["id"]

    # The address is allowlisted, so the call reaches the service, which refuses the key.
    with caplog.at_level(logging.DEBUG):
        events = await ask(member, str(uuid.uuid4()), "hello", props={"modelId": local})
    assert types(events)[-1] == "RUN_ERROR" and events[-1]["code"] == "model_failed"
    assert len(connections) == 1
    assert KEY not in json.dumps(events) and KEY not in caplog.text

    # The allowlist is gone (or the name now resolves somewhere forbidden): the Admin is told before any connection.
    monkeypatch.setattr(settings, "provider_allowed_networks", "")
    thread = str(uuid.uuid4())
    events = await ask(member, thread, "hello", props={"modelId": local})
    assert types(events) == ["RUN_STARTED", "RUN_ERROR"] and events[-1]["code"] == "blocked_address"
    assert "Admin" in events[-1]["message"]
    assert len(connections) == 1
    assert (await member.get(f"/conversations/{thread}")).status_code == 404, "a refused question starts nothing"


async def test_a_connection_is_checked_again_when_it_is_opened(stub, monkeypatch):
    """The pinned guard: even if the preflight is skipped or the name changes meaning, no socket opens to a forbidden address."""
    port, connections = stub
    monkeypatch.setattr(settings, "provider_allowed_networks", "")
    with pytest.raises(BlockedAddress):
        await checked_http_client().get(f"http://localhost:{port}/")
    assert connections == []
