"""THROWAWAY spike backend. Scripted FunctionModel behind AGUIAdapter. See ../README.md."""
import asyncio
import json
import re
import time
import uuid
from pathlib import Path

from ag_ui.core import EventType, RunErrorEvent
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic_ai import Agent, CancellationToken
from pydantic_ai.capabilities import PrepareTools
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.ui.ag_ui import AGUIAdapter

from script import scenario

LOG = Path(__file__).parent.parent / "evidence" / "backend-log.jsonl"
LOG.parent.mkdir(exist_ok=True)
RENDER_TOOLS = {"generateSandboxedUi", "render_a2ui"}
ALLOWED = {"ogui": {"generateSandboxedUi"}, "a2ui": {"render_a2ui"}, "none": set()}

app = FastAPI()
ANSWERS: dict[str, list[dict]] = {}  # shortcut: process memory, real product uses Postgres (ADR-0002)
SETTINGS = {"single_turn": False, "reject_mode": "event", "cancel": "listen"}


def log(kind: str, **data):
    with LOG.open("a") as f:
        f.write(json.dumps({"t": round(time.time(), 3), "kind": kind, **data}, default=str) + "\n")


def last_user_text(messages) -> str:
    for m in reversed(messages):
        if isinstance(m, ModelRequest):
            for p in reversed(m.parts):
                if isinstance(p, UserPromptPart):
                    return p.content if isinstance(p.content, str) else str(p.content)
    return ""


async def stream_function(messages, info: AgentInfo):
    prompt = last_user_text(messages)
    tools = [t.name for t in info.function_tools]
    log("model_called", prompt=prompt, tools=tools, instructions=info.instructions, allow_text=info.allow_text_output)
    # A frontend tool result in history means this is CopilotKit's automatic follow-up run.
    if isinstance(messages[-1], ModelRequest) and any(isinstance(p, ToolReturnPart) for p in messages[-1].parts):
        yield "(follow-up after tool result)"
        return
    if any(isinstance(m, ModelResponse) for m in messages):  # Pydantic AI retried after a rejected tool call
        yield "(recovered as text after retry)"
        return
    chunks = 0
    try:
        for step in scenario(prompt, tools):
            if step["delay"]:
                await asyncio.sleep(step["delay"])
            chunks += 1
            if "text" in step:
                yield step["text"]
            else:
                yield {step["idx"]: DeltaToolCall(name=step.get("name"), json_args=step["args"], tool_call_id=step.get("id"))}
    except BaseException as e:
        log("model_stream_interrupted", exc=type(e).__name__, chunks_sent=chunks)
        raise
    log("model_stream_finished", chunks_sent=chunks)


agent = Agent(FunctionModel(stream_function=stream_function, model_name="scripted"))


def parts_from_messages(messages) -> list[dict]:
    """Stored Answer parts from Pydantic AI messages, in model order."""
    out = []
    for m in messages:
        if isinstance(m, ModelResponse):
            for p in m.parts:
                if isinstance(p, TextPart) and p.content:
                    out.append({"type": "text", "text": p.content})
                elif isinstance(p, ToolCallPart):
                    # args may be a truncated JSON string when the run was cancelled mid-call
                    out.append({"type": "tool", "name": p.tool_name, "args": p.args})
    return out


def save_answer(thread_id: str, run_id: str, model_id, status: str, source: str, parts: list[dict]):
    ANSWERS.setdefault(thread_id, []).append(
        {"id": str(uuid.uuid4()), "conversationId": thread_id, "runId": run_id, "status": status, "modelId": model_id, "source": source, "parts": parts}
    )


async def wrap_body(body_iter, thread_id: str, run_id: str, model_id):
    """Second capture path: tee the encoded SSE stream. Survives task cancellation via finally."""
    parts: list[dict] = []
    open_tools: dict[str, dict] = {}
    status = "disconnected"
    try:
        async for chunk in body_iter:
            yield chunk
            text = chunk.decode() if isinstance(chunk, bytes) else chunk
            for m in re.finditer(r"^data: (.*)$", text, re.M):
                e = json.loads(m.group(1))
                t = e.get("type")
                if t == "TEXT_MESSAGE_CONTENT":
                    if parts and parts[-1]["type"] == "text":
                        parts[-1]["text"] += e["delta"]
                    else:
                        parts.append({"type": "text", "text": e["delta"]})
                elif t == "TOOL_CALL_START":
                    open_tools[e["toolCallId"]] = {"type": "tool", "name": e["toolCallName"], "args": ""}
                    parts.append(open_tools[e["toolCallId"]])
                elif t == "TOOL_CALL_ARGS":
                    open_tools[e["toolCallId"]]["args"] += e["delta"]
                elif t == "RUN_FINISHED":
                    status = "finished"
                elif t == "RUN_ERROR":
                    status = "error"
    finally:
        log("stream_tee_closed", thread=thread_id, run=run_id, status=status, parts=parts)
        if status == "disconnected" and not any(a["runId"] == run_id for a in ANSWERS.get(thread_id, [])):
            save_answer(thread_id, run_id, model_id, "stopped", "stream_tee", parts)


@app.post("/debug/settings")
async def settings(request: Request):
    SETTINGS.update(await request.json())
    return SETTINGS


@app.post("/debug/clone/{src}/{dst}")
async def clone(src: str, dst: str):
    """Copies stored Answers to an id the CopilotRuntime in-memory runner has never seen."""
    ANSWERS[dst] = ANSWERS.get(src, [])
    return {"ok": True}


@app.get("/answers/{thread_id}")
async def answers(thread_id: str):
    return ANSWERS.get(thread_id, [])


@app.get("/evil/{rest:path}")
async def evil(rest: str, request: Request):
    """Stand-in for an attacker host: any hit here means Generative UI reached the network."""
    log("evil_hit", path=rest, query=str(request.url.query), origin=request.headers.get("origin"), referer=request.headers.get("referer"))
    return PlainTextResponse("exfiltrated", headers={"Access-Control-Allow-Origin": "*"})


def extract_tool_result_run(body: dict) -> bool:
    """True when this run is the automatic follow-up carrying a frontend tool result."""
    msgs = body.get("messages") or []
    return bool(msgs) and msgs[-1].get("role") == "tool"


@app.post("/agent")
async def run(request: Request):
    body = await request.json()  # Starlette caches it, dispatch_request can read it again
    thread_id, run_id = body["threadId"], body["runId"]
    props = body.get("forwardedProps") or {}
    model_id = props.get("modelId")
    prompt = next((m.get("content") for m in reversed(body.get("messages") or []) if m.get("role") == "user"), "")
    prompt = prompt if isinstance(prompt, str) else json.dumps(prompt)
    route = (re.search(r"route:(\w+)", prompt) or [None, None])[1]
    follow_up = extract_tool_result_run(body)
    log(
        "run_request",
        thread=thread_id,
        run=run_id,
        follow_up=follow_up,
        model_id=model_id,
        props=props,
        cookie=request.headers.get("cookie"),
        auth=request.headers.get("authorization"),
        x_custom=request.headers.get("x-deskmate-test"),
        tools=[t["name"] for t in body.get("tools") or []],
        context=[{"description": c["description"], "chars": len(c["value"])} for c in body.get("context") or []],
        roles=[m.get("role") for m in body.get("messages") or []],
    )

    # Single-turn rule: a Conversation already holding an Answer rejects a new user turn.
    if SETTINGS["single_turn"] and ANSWERS.get(thread_id) and not follow_up:
        msg = "This Conversation already has an Answer. Start a new Conversation."
        log("run_rejected", thread=thread_id, mode=SETTINGS["reject_mode"])
        if SETTINGS["reject_mode"] == "http":
            return JSONResponse({"detail": msg}, status_code=409)

        async def rejected():
            e = RunErrorEvent(type=EventType.RUN_ERROR, message=msg, code="SINGLE_TURN")
            yield f"data: {e.model_dump_json(by_alias=True, exclude_none=True)}\n\n"

        return StreamingResponse(rejected(), media_type="text/event-stream")

    allowed = ALLOWED.get(route)

    async def only_routed(ctx, tool_defs):
        if allowed is None:
            return tool_defs
        return [t for t in tool_defs if t.name not in RENDER_TOOLS - allowed]

    instructions = f"route={route}; model={model_id}"
    schema = next((c["value"] for c in body.get("context") or [] if c["description"].startswith("A2UI Component Schema")), None)
    if schema:  # AGUIAdapter drops RunAgentInput.context; a real model needs this appended by hand
        instructions += f"\nA2UI catalog schema: {schema}"

    async def on_complete(result):
        parts = parts_from_messages(result.new_messages())
        log("on_complete", thread=thread_id, run=run_id, parts=parts)
        save_answer(thread_id, run_id, model_id, "complete", "on_complete", parts)

    async def on_cancel(cancelled):
        parts = parts_from_messages(cancelled.new_messages())
        log("on_cancel", thread=thread_id, run=run_id, exc=str(cancelled), usage=cancelled.usage(), parts=parts)
        save_answer(thread_id, run_id, model_id, "stopped", "on_cancel", parts)

    token = CancellationToken()

    async def listen(receive):
        # Starlette cancels the stream task on disconnect, which skips on_cancel. Turn it into a first-party cancel.
        while (await receive())["type"] != "http.disconnect":
            pass
        log("client_disconnected", thread=thread_id, run=run_id)
        token.cancel()
        await asyncio.Event().wait()  # stream_response ends the task group once the run has wound down

    response = await AGUIAdapter.dispatch_request(
        request,
        agent=agent,
        instructions=instructions,
        capabilities=[PrepareTools(only_routed)],
        cancellation_token=token,
        on_complete=on_complete,
        on_cancel=on_cancel,
    )
    response.body_iterator = wrap_body(response.body_iterator, thread_id, run_id, model_id)
    if SETTINGS["cancel"] == "listen":
        response.listen_for_disconnect = listen
    return response
