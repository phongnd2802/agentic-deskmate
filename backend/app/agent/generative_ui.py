"""Generative UI (ADR-0004) and A2UI tables: which Models are offered the render tools, and the check on what a Model sends through them.

Neither the renderer nor the run reports a bad render, so the backend holds the tool call's arguments until they are
complete and valid. That also means html reaches the browser only once it is whole.
"""

import json
from collections.abc import AsyncIterator
from typing import Literal

from ag_ui.core import ActivitySnapshotEvent, ToolCallArgsEvent, ToolCallEndEvent, ToolCallStartEvent
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RENDER_TOOL = "generateSandboxedUi"
A2UI_TOOL = "render_a2ui"  # injected by the runtime; renders a table from the custom catalog

PROMPT = (
    f"You can answer with an interactive interface by calling {RENDER_TOOL}, when it serves the question better than text. "
    "It runs in a sandbox with no network: do not fetch, and use only data: or blob: images. Chart.js may be loaded from "
    "https://cdn.jsdelivr.net. Put the data in the code. Write short text around it, not a repeat of what the interface shows. "
    "The only function the sandbox gives the code is `await Websandbox.connection.remote.openLink({url})`, which opens an "
    "https link after the User confirms the address and resolves to {ok: boolean}. Nothing in the interface can ask you a "
    "new question or start another Answer."
)

# AGUIAdapter ignores RunAgentInput.context, so the catalog schema the browser would send never reaches the Model;
# it is built here from the same model that validates the call.
A2UI_PROMPT = (
    f"You can present exact values or a simple comparison as a table by calling {A2UI_TOOL}, instead of writing it in text. "
    "The catalog has one component, Table, and nothing that acts: no buttons, no data model. Pass a surfaceId and "
    'components holding exactly one Table with id "root", whose rows each have one string per column. Do not pass a '
    "catalogId or data. Write short text around the table, not a repeat of it. Component schema: "
)


class InvalidRender(Exception):
    pass


class RenderArgs(BaseModel):
    """The arguments the browser registers for the tool, with html required: without it the User gets an empty box.

    Strict, no NaN or Infinity (browser JSON.parse rejects them), and an absent field is absent, never null: the page
    that reopens an Answer validates the same way, so what passes here also renders there.
    """

    model_config = ConfigDict(strict=True, allow_inf_nan=False)

    html: str
    initialHeight: float = 200
    css: str = ""
    jsFunctions: str = ""
    jsExpressions: list[str] = []

    @field_validator("html")
    @classmethod
    def not_blank(cls, html: str) -> str:
        if not html.strip():
            raise ValueError("html is blank")
        return html


class Table(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    id: Literal["root"]
    component: Literal["Table"]
    title: str = Field(min_length=1)
    columns: list[str] = Field(min_length=1)
    rows: list[list[str]]

    @model_validator(mode="after")
    def rows_match_columns(self) -> "Table":
        if any(len(row) != len(self.columns) for row in self.rows):
            raise ValueError("a row does not match the columns")
        return self


class A2uiArgs(BaseModel):
    """The catalog: one Table and no action, because an A2UI action starts a run. Anything else would show the User raw
    'Unknown component' text or an empty surface, and neither the renderer nor the run reports it."""

    model_config = ConfigDict(strict=True, extra="forbid")

    surfaceId: str = Field(min_length=1)
    components: list[Table] = Field(min_length=1, max_length=1)


ARGS: dict[str, type[BaseModel]] = {RENDER_TOOL: RenderArgs, A2UI_TOOL: A2uiArgs}


def a2ui_prompt() -> str:
    return A2UI_PROMPT + json.dumps(Table.model_json_schema())


def offered(tools: list, enabled: bool) -> list:
    """The browser sends its tools, but a Model gets the render tools only when its Generative UI flag is on, and no other."""
    return [t for t in tools if enabled and t.name in ARGS]


async def hold_render_calls(events: AsyncIterator, enabled: bool) -> AsyncIterator:
    """Forward the stream, except that a render tool call is held and sent whole once valid.

    Raises InvalidRender for invalid arguments and for any tool call the Model was not offered. A run that is stopped
    mid-call drops the held arguments instead of storing them truncated, which the parent spec describes: html that was
    never validated stays on the backend.
    """
    held: dict[str, list] = {}  # tool call ID to its start event and the arguments so far
    async for event in events:
        if isinstance(event, ToolCallStartEvent):
            if not enabled or event.tool_call_name not in ARGS:
                raise InvalidRender(f"The Model called {event.tool_call_name}, which it was not offered")
            held[event.tool_call_id] = [event, ""]
            if event.tool_call_name == RENDER_TOOL:
                # The renderer shows a placeholder while generating, under the ID the runtime gives its own activity.
                yield ActivitySnapshotEvent(
                    message_id=f"{event.tool_call_id}-activity", activity_type="open-generative-ui", content={"generating": True}
                )
        elif isinstance(event, ToolCallArgsEvent) and event.tool_call_id in held:
            held[event.tool_call_id][1] += event.delta
        elif isinstance(event, ToolCallEndEvent) and event.tool_call_id in held:
            start, args = held.pop(event.tool_call_id)
            try:
                ARGS[start.tool_call_name].model_validate(json.loads(args))
            except ValueError as error:
                raise InvalidRender(f"Invalid {start.tool_call_name} arguments: {error}") from error
            yield start
            yield ToolCallArgsEvent(tool_call_id=event.tool_call_id, delta=args)
            yield event
        else:
            yield event
    if held:
        raise InvalidRender(f"The stream ended inside a {RENDER_TOOL} call")
