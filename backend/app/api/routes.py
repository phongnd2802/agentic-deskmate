"""The HTTP routes. main.py only builds the app and includes this router."""

from uuid import UUID

from ag_ui.core import RunErrorEvent, RunStartedEvent
from ag_ui.encoder import EventEncoder
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.agent.chat import build_agent
from app.services import conversations
from app.services.auth import CurrentUser, current_user

router = APIRouter()

# Stable codes: the Chat page translates them. The English message is only a fallback for other clients.
SECOND_QUESTION = ("second_question", "A Conversation holds one question. Start a new Conversation to ask something else.")
NO_QUESTION = ("no_question", "Send a question to start a Conversation.")
INVALID_CONVERSATION = ("invalid_conversation", "The Conversation ID is not valid.")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _refusal(adapter: AGUIAdapter, refusal: tuple[str, str]) -> StreamingResponse:
    """Refuse inside the AG-UI stream, not with an HTTP error, so the Chat page can show the message."""
    encoder = EventEncoder(accept=adapter.accept)
    run = adapter.run_input
    events = [
        RunStartedEvent(thread_id=run.thread_id, run_id=run.run_id),
        RunErrorEvent(code=refusal[0], message=refusal[1]),
    ]

    async def stream():
        for event in events:
            yield encoder.encode(event)

    return StreamingResponse(stream(), media_type=encoder.get_content_type())


def _last_user_messages(adapter: AGUIAdapter) -> list:
    return [m for m in adapter.run_input.messages if m.role == "user"][-1:]


def _question(adapter: AGUIAdapter) -> str | None:
    [message] = _last_user_messages(adapter) or [None]
    content = message.content if message else None
    return content if isinstance(content, str) and content.strip() else None


def _parts(response: ModelResponse) -> list[dict]:
    parts = []
    for part in response.parts:
        if isinstance(part, TextPart):
            parts.append({"type": "text", "text": part.content})
        elif isinstance(part, ToolCallPart):
            parts.append({"type": "tool", "name": part.tool_name, "args": part.args_as_json_str()})
    return parts


@router.post("/agent")
async def agent(request: Request, user: CurrentUser = Depends(current_user)):
    agent = build_agent()
    adapter = await AGUIAdapter.from_request(request, agent=agent)
    run = adapter.run_input

    question = _question(adapter)
    if question is None:
        return _refusal(adapter, NO_QUESTION)
    try:
        conversation_id = UUID(run.thread_id)
    except ValueError:
        return _refusal(adapter, INVALID_CONVERSATION)
    question_id = await conversations.start_conversation(user, conversation_id, question)
    if question_id is None:
        return _refusal(adapter, SECOND_QUESTION)

    # The browser's history is never trusted: the run sees only this question.
    adapter.run_input = run.model_copy(update={"messages": _last_user_messages(adapter)})

    async def on_complete(result) -> None:
        responses = [m for m in result.new_messages() if isinstance(m, ModelResponse)]
        await conversations.save_answer(
            user, conversation_id, question_id, run.run_id, agent.model.model_name, [p for r in responses for p in _parts(r)]
        )

    return adapter.streaming_response(adapter.run_stream(on_complete=on_complete))
