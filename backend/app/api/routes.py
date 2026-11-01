"""The HTTP routes. main.py only builds the app and includes this router."""

import asyncio
import logging
from uuid import UUID

from ag_ui.core import (
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    ToolCallArgsEvent,
    ToolCallStartEvent,
    UserMessage,
)
from ag_ui.encoder import EventEncoder
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.agent.chat import build_agent
from app.services import conversations
from app.schemas.conversations import AnswerStatus
from app.services.auth import CurrentUser, current_user

router = APIRouter()

# Stable codes: the Chat page translates them. The English message is only a fallback for other clients.
SECOND_QUESTION = ("second_question", "A Conversation holds one question. Start a new Conversation to ask something else.")
NO_QUESTION = ("no_question", "Send a question to start a Conversation.")
INVALID_CONVERSATION = ("invalid_conversation", "The Conversation ID is not valid.")
NOT_RETRYABLE = ("not_retryable", "Only a stopped or failed Answer can be retried.")
ANSWER_IN_PROGRESS = ("answer_in_progress", "An Answer is still being written.")
MODEL_FAILED = ("model_failed", "The Model could not finish the Answer.")
NOT_SAVED = ("answer_not_saved", "The Answer could not be saved.")

logger = logging.getLogger(__name__)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _refusal_events(adapter: AGUIAdapter, refusal: tuple[str, str]) -> list:
    run = adapter.run_input
    return [
        RunStartedEvent(thread_id=run.thread_id, run_id=run.run_id),
        RunErrorEvent(code=refusal[0], message=refusal[1]),
    ]


def _refusal(adapter: AGUIAdapter, refusal: tuple[str, str]) -> StreamingResponse:
    """Refuse inside the AG-UI stream, not with an HTTP error, so the Chat page can show the message."""
    encoder = EventEncoder(accept=adapter.accept)
    events = _refusal_events(adapter, refusal)

    async def stream():
        for event in events:
            yield encoder.encode(event)

    return StreamingResponse(stream(), media_type=encoder.get_content_type())


def _question(adapter: AGUIAdapter) -> str | None:
    [message] = [m for m in adapter.run_input.messages if m.role == "user"][-1:] or [None]
    content = message.content if message else None
    return content if isinstance(content, str) and content.strip() else None


def _track(parts: list[dict], event) -> None:
    """Build the stored parts from the stream, because a stopped or failed run gives no result to read them from."""
    if isinstance(event, TextMessageContentEvent):
        if parts and parts[-1]["type"] == "text":
            parts[-1]["text"] += event.delta
        else:
            parts.append({"type": "text", "text": event.delta})
    elif isinstance(event, ToolCallStartEvent):
        parts.append({"type": "tool", "id": event.tool_call_id, "name": event.tool_call_name, "args": ""})
    elif isinstance(event, ToolCallArgsEvent):
        next(p for p in parts if p.get("id") == event.tool_call_id)["args"] += event.delta


# Persisting must outlive a cancelled request, and the loop only keeps weak references to tasks.
_saving: set[asyncio.Task] = set()


def _saved(task: asyncio.Task) -> None:
    _saving.discard(task)
    if not task.cancelled() and task.exception():
        logger.error("Could not save an Answer", exc_info=task.exception())


def _save(user: CurrentUser, conversation_id: UUID, question_id: UUID, run_id: str, model_id: str, parts: list[dict], status: AnswerStatus):
    async def save() -> None:
        try:
            await conversations.save_answer(
                user, conversation_id, question_id, run_id, model_id, [{k: v for k, v in p.items() if k != "id"} for p in parts], status
            )
        finally:
            conversations.release(conversation_id)

    # A task of its own, so cancelling the request cannot cancel the write (a cancelled scope would fail every await).
    task = asyncio.create_task(save())
    _saving.add(task)
    task.add_done_callback(_saved)
    return task


@router.post("/agent")
async def agent(request: Request, user: CurrentUser = Depends(current_user)):
    adapter = await AGUIAdapter.from_request(request, agent=build_agent())
    run = adapter.run_input
    props = run.forwarded_props
    retrying = isinstance(props, dict) and props.get("retry") is True

    question = None if retrying else _question(adapter)
    if question is None and not retrying:
        return _refusal(adapter, NO_QUESTION)
    try:
        conversation_id = UUID(run.thread_id)
    except ValueError:
        return _refusal(adapter, INVALID_CONVERSATION)

    model_id = None
    if retrying:
        # Ownership and retryability are checked before anything reveals a run in progress, so a stranger learns nothing.
        # The question and Model come from storage, never the browser.
        found = await conversations.start_retry(user, conversation_id)
        if found is None:
            return _refusal(adapter, NOT_RETRYABLE)
        question_id, question, model_id = found
    else:
        question_id = await conversations.start_conversation(user, conversation_id, question)
        if question_id is None:
            return _refusal(adapter, SECOND_QUESTION)

    if model_id is not None:
        adapter.agent = build_agent(model_id)
    model_id = adapter.agent.model.model_name
    # The browser's history is never trusted: the run sees only this question.
    adapter.run_input = run.model_copy(update={"messages": [UserMessage(id=str(question_id), content=question)]})

    async def stream():
        # Claimed here, not earlier, so a response that is never iterated holds nothing. Two retries that both passed the
        # check above meet here, and the second is refused.
        if not conversations.claim(conversation_id):
            for event in _refusal_events(adapter, ANSWER_IN_PROGRESS):
                yield event
            return
        parts: list[dict] = []
        saved = False
        try:
            async for event in adapter.run_stream():
                _track(parts, event)
                if isinstance(event, RunErrorEvent):
                    logger.warning("Model failed in Conversation %s: %s", conversation_id, event.message)
                    event = RunErrorEvent(code=MODEL_FAILED[0], message=MODEL_FAILED[1])
                if isinstance(event, RunErrorEvent | RunFinishedEvent):
                    status = "failed" if isinstance(event, RunErrorEvent) else "complete"
                    saved = True
                    # Stored before the browser sees the end, so a reload right after always finds the Answer.
                    await asyncio.shield(_save(user, conversation_id, question_id, run.run_id, model_id, parts, status))
                yield event
        except Exception:
            # Cancellation is a BaseException and goes to `finally` as a stop. Anything else is a failure of this run.
            if saved:
                yield RunErrorEvent(code=NOT_SAVED[0], message=NOT_SAVED[1])
            else:
                logger.exception("Run failed in Conversation %s", conversation_id)
                saved = True
                await asyncio.shield(_save(user, conversation_id, question_id, run.run_id, model_id, parts, "failed"))
                yield RunErrorEvent(code=MODEL_FAILED[0], message=MODEL_FAILED[1])
        finally:
            # Neither finished nor failed: the runner aborted its fetch, which is how Stop reaches us.
            if not saved:
                _save(user, conversation_id, question_id, run.run_id, model_id, parts, "stopped")

    return adapter.streaming_response(stream())
