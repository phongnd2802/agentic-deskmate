"""Response bodies for Conversations and their Answers."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class TextPartOut(BaseModel):
    type: Literal["text"]
    text: str


class ToolPartOut(BaseModel):
    type: Literal["tool"]
    name: str
    # The raw JSON string; it may be truncated on a stopped Answer.
    args: str


AnswerStatus = Literal["complete", "stopped", "failed"]


class AnswerOut(BaseModel):
    id: UUID
    run_id: str
    status: AnswerStatus
    provider_name: str | None
    model_id: str
    parts: list[TextPartOut | ToolPartOut]
    created_at: datetime


class ConversationSummaryOut(BaseModel):
    id: UUID
    question: str
    created_at: datetime


class ConversationOut(ConversationSummaryOut):
    answers: list[AnswerOut]
