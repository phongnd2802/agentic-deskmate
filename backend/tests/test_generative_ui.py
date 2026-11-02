"""Seam 1: Generative UI over the real AG-UI endpoint. The scripted Model writes the render tool call; no browser."""

import asyncio
import json
import uuid

import pytest
from ag_ui.core import ToolCallArgsEvent, ToolCallStartEvent
from pydantic_ai.models.function import FunctionModel

import app.agent.chat as chat

from app.agent.generative_ui import A2UI_TOOL, RENDER_TOOL
from tests.conftest import PROVIDER
from app.agent import generative_ui
from tests.test_conversations import _body, answers, start_run, stored, types

BROWSER_TOOL = {"name": RENDER_TOOL, "description": "Render", "parameters": {"type": "object", "properties": {}}}
TABLE_TOOL = {**BROWSER_TOOL, "name": A2UI_TOOL}  # the runtime injects this one into every run


@pytest.fixture
async def gui_model(people):
    """A Model with the Generative UI flag on, next to the Organization's flag-off `model-a`."""
    response = await people["admin"].post(
        "/providers", json={**PROVIDER, "name": "With UI", "models": [{"model_id": "model-ui", "generative_ui": True}]}
    )
    assert response.status_code == 201, response.text
    return response.json()["models"][0]["id"]


async def ask_with_tool(client, model_id: str, thread_id: str, question: str) -> list[dict]:
    """The browser always sends the render tool; the backend decides whether the Model is offered it."""
    body = {**_body(thread_id, question, props={"modelId": model_id}), "tools": [BROWSER_TOOL, TABLE_TOOL]}
    async with client.stream("POST", "/agent", json=body) as response:
        lines = [line async for line in response.aiter_lines()]
    return [json.loads(line.removeprefix("data: ")) for line in lines if line.startswith("data: ")]


async def test_a_render_call_reaches_the_browser_whole_and_is_stored(people, gui_model):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], gui_model, thread, "[gui] show a slider")

    kinds = types(events)
    assert kinds[-1] == "RUN_FINISHED"
    # A placeholder first, then the call in one piece: html is never forwarded while it is still being written.
    assert kinds.index("ACTIVITY_SNAPSHOT") < kinds.index("TOOL_CALL_START")
    [args] = [e for e in events if e["type"] == "TOOL_CALL_ARGS"]
    assert json.loads(args["delta"])["html"].startswith("<head>")
    assert "TEXT_MESSAGE_CONTENT" in kinds[: kinds.index("TOOL_CALL_START")], "text streams before the interface"

    [answer] = await answers(people["member"], thread)
    assert answer["status"] == "complete"
    tool = answer["parts"][-1]
    assert tool["type"] == "tool" and tool["name"] == RENDER_TOOL
    assert json.loads(tool["args"])["html"] == json.loads(args["delta"])["html"]


async def test_a_model_with_the_flag_off_is_not_offered_the_tool_and_answers_in_text(people):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], people["member"].model_id, thread, "[gui] show a slider")

    assert types(events)[-1] == "RUN_FINISHED"
    assert not [e for e in events if e["type"].startswith("TOOL_CALL")]
    [answer] = await answers(people["member"], thread)
    assert [p["type"] for p in answer["parts"]] == ["text"]
    assert "Scripted Answer" in answer["parts"][0]["text"]


async def test_a_model_calling_a_tool_it_was_not_offered_fails_the_answer_and_nothing_is_forwarded(people):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], people["member"].model_id, thread, "[gui-rogue] sneaky")

    assert types(events)[-1] == "RUN_ERROR" and events[-1]["code"] == "model_failed"
    assert not [e for e in events if e["type"].startswith("TOOL_CALL")]
    [answer] = await answers(people["member"], thread)
    assert answer["status"] == "failed"
    assert answer["parts"] == [{"type": "text", "text": "Calling a tool I was not offered. "}], "text is kept, the call is not"

    body = {**_body(thread, "ignored", props={"modelId": people["member"].model_id, "retry": True}), "tools": [BROWSER_TOOL]}
    async with people["member"].stream("POST", "/agent", json=body) as response:
        [line async for line in response.aiter_lines()]
    assert [a["status"] for a in await answers(people["member"], thread)] == ["failed", "complete"]


async def test_invalid_render_arguments_fail_the_answer_and_a_retry_adds_another(people, gui_model):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], gui_model, thread, "[gui-bad] no html")

    assert types(events)[-1] == "RUN_ERROR" and events[-1]["code"] == "model_failed"
    assert not [e for e in events if e["type"] == "TOOL_CALL_ARGS"], "invalid arguments are never forwarded"
    [failed] = await answers(people["member"], thread)
    assert failed["status"] == "failed"
    assert [p["type"] for p in failed["parts"]] == ["text"]

    body = {**_body(thread, "ignored", props={"modelId": gui_model, "retry": True}), "tools": [BROWSER_TOOL]}
    async with people["member"].stream("POST", "/agent", json=body) as response:
        [line async for line in response.aiter_lines()]
    stored = await answers(people["member"], thread)
    assert [a["status"] for a in stored] == ["failed", "complete"]
    assert stored[1]["parts"][-1]["name"] == RENDER_TOOL


@pytest.mark.parametrize(
    "args",
    [
        '{"html":"   "}',
        '{"html":"<b>x</b>","css":null}',
        '{"html":"<b>x</b>","initialHeight":"120"}',
        '{"html":"<b>x</b>","jsExpressions":"alert(1)"}',
        '{"html":"<b>trunc',
        '{"html":"<b>x</b>","initialHeight":NaN}',
        '{"html":"<b>x</b>","initialHeight":Infinity}',
        "[]",
    ],
)
async def test_arguments_that_would_not_render_on_reopen_fail_the_answer_live(people, gui_model, args):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], gui_model, thread, f"[gui-raw {RENDER_TOOL} {args}]")

    assert types(events)[-1] == "RUN_ERROR" and events[-1]["code"] == "model_failed"
    assert not [e for e in events if e["type"] == "TOOL_CALL_ARGS"]
    [answer] = await answers(people["member"], thread)
    assert answer["status"] == "failed" and all(p["type"] == "text" for p in answer["parts"])


async def test_a_tool_that_is_not_the_render_tool_fails_the_answer_even_with_the_flag_on(people, gui_model):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], gui_model, thread, '[gui-raw other_tool {"html":"<b>x</b>"}]')

    assert types(events)[-1] == "RUN_ERROR"
    assert not [e for e in events if e["type"].startswith("TOOL_CALL")]
    [answer] = await answers(people["member"], thread)
    assert answer["status"] == "failed" and all(p["type"] == "text" for p in answer["parts"])


async def test_two_render_calls_in_one_run_are_each_validated_and_stored(people, gui_model):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], gui_model, thread, "[gui-two] two sliders")

    assert types(events)[-1] == "RUN_FINISHED"
    assert len([e for e in events if e["type"] == "TOOL_CALL_ARGS"]) == 2
    [answer] = await answers(people["member"], thread)
    assert [p.get("name") for p in answer["parts"] if p["type"] == "tool"] == [RENDER_TOOL, RENDER_TOOL]


async def test_stopping_mid_call_stores_the_text_and_drops_the_held_arguments(people, gui_model):
    thread = str(uuid.uuid4())
    first_text, hang_up, run = start_run(people["member"], thread, "[gui-stall] stop me", {"modelId": gui_model}, [BROWSER_TOOL])
    await asyncio.wait_for(first_text.wait(), 10)
    await asyncio.sleep(0.5)  # until the call has started
    hang_up.set()
    await asyncio.wait_for(run, 10)

    [answer] = await stored(people["member"], thread, 1)
    assert answer["status"] == "stopped"
    assert answer["parts"] == [{"type": "text", "text": "Started writing. "}]


async def test_a_stream_that_ends_inside_a_call_is_invalid():
    async def events():
        yield ToolCallStartEvent(tool_call_id="c", tool_call_name=RENDER_TOOL)
        yield ToolCallArgsEvent(tool_call_id="c", delta='{"html":"<b>')

    with pytest.raises(generative_ui.InvalidRender):
        [e async for e in generative_ui.hold_render_calls(events(), True)]


async def test_only_a_model_with_the_flag_is_told_about_openlink(people, gui_model, monkeypatch):
    seen: list[str] = []

    async def record(messages, info):
        seen.append(info.instructions or "")
        yield "ok"

    monkeypatch.setattr(chat, "build_model", lambda choice: FunctionModel(stream_function=record, model_name="recorder"))
    await ask_with_tool(people["member"], gui_model, str(uuid.uuid4()), "hello")
    await ask_with_tool(people["member"], people["member"].model_id, str(uuid.uuid4()), "hello")

    assert "openLink" in seen[0] and "openLink" not in seen[1]


# A2UI tables (issue #11): the same held and validated render path, with a catalog of one Table and no actions.
GOOD_TABLE = {"surfaceId": "t", "components": [{"id": "root", "component": "Table", "title": "T", "columns": ["a", "b"], "rows": [["1", "2"]]}]}


async def test_a_table_reaches_the_browser_whole_and_is_stored(people, gui_model):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], gui_model, thread, "[table] compare regions")

    assert types(events)[-1] == "RUN_FINISHED"
    [args] = [e for e in events if e["type"] == "TOOL_CALL_ARGS"]
    [component] = json.loads(args["delta"])["components"]
    assert component["component"] == "Table" and component["columns"] == ["Region", "Sales"]
    [answer] = await answers(people["member"], thread)
    assert answer["status"] == "complete"
    assert answer["parts"][-1]["name"] == A2UI_TOOL and json.loads(answer["parts"][-1]["args"]) == json.loads(args["delta"])


async def test_a_model_with_the_flag_off_is_not_offered_the_table_tool(people):
    events = await ask_with_tool(people["member"], people["member"].model_id, str(uuid.uuid4()), "[table] compare regions")

    assert types(events)[-1] == "RUN_FINISHED" and not [e for e in events if e["type"].startswith("TOOL_CALL")]


async def test_an_unknown_component_fails_the_answer_and_a_retry_adds_another(people, gui_model):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], gui_model, thread, "[table-bad] compare regions")

    assert types(events)[-1] == "RUN_ERROR" and events[-1]["code"] == "model_failed"
    assert not [e for e in events if e["type"] == "TOOL_CALL_ARGS"]

    body = {**_body(thread, "ignored", props={"modelId": gui_model, "retry": True}), "tools": [BROWSER_TOOL, TABLE_TOOL]}
    async with people["member"].stream("POST", "/agent", json=body) as response:
        [line async for line in response.aiter_lines()]
    stored = await answers(people["member"], thread)
    assert [a["status"] for a in stored] == ["failed", "complete"]
    assert stored[1]["parts"][-1]["name"] == A2UI_TOOL


def _with(**changes) -> str:
    return json.dumps({**GOOD_TABLE, **changes})


def _table(**changes) -> list[dict]:
    return [{**GOOD_TABLE["components"][0], **changes}]


@pytest.mark.parametrize(
    "args",
    [
        _with(components=[{"id": "root", "component": "Button", "label": "Run", "action": {"event": {"name": "go"}}}]),
        _with(components=_table(action={"event": {"name": "go"}})),
        _with(components=_table(component="Nope")),
        _with(components=_table(columns=[])),
        _with(components=_table(rows=[["1"]])),
        _with(components=_table(rows=[["1", 2]])),
        _with(components=_table(rows=[["North", 120]])),
        _with(components=_table(title="")),
        _with(components=_table(id="other")),
        _with(components=_table() * 2),
        _with(components=[]),
        _with(surfaceId=""),
        _with(data={"x": 1}),
        '{"surfaceId":"t","components":[{"id":"root","comp',
    ],
)
async def test_table_arguments_that_would_not_render_fail_the_answer(people, gui_model, args):
    thread = str(uuid.uuid4())
    events = await ask_with_tool(people["member"], gui_model, thread, f"[gui-raw {A2UI_TOOL} {args}]")

    assert types(events)[-1] == "RUN_ERROR" and events[-1]["code"] == "model_failed"
    assert not [e for e in events if e["type"] == "TOOL_CALL_ARGS"]
    [answer] = await answers(people["member"], thread)
    assert answer["status"] == "failed" and all(p["type"] == "text" for p in answer["parts"])


async def test_only_a_model_with_the_flag_gets_the_table_schema_in_its_instructions(people, gui_model, monkeypatch):
    # AGUIAdapter drops RunAgentInput.context, so the instructions carry the schema.
    seen: list[str] = []

    async def record(messages, info):
        seen.append(info.instructions or "")
        yield "ok"

    monkeypatch.setattr(chat, "build_model", lambda choice: FunctionModel(stream_function=record, model_name="recorder"))
    await ask_with_tool(people["member"], gui_model, str(uuid.uuid4()), "hello")
    await ask_with_tool(people["member"], people["member"].model_id, str(uuid.uuid4()), "hello")

    assert A2UI_TOOL in seen[0] and '"Table"' in seen[0] and "columns" in seen[0]
    assert A2UI_TOOL not in seen[1]
