"""Conversation routes: the User's list and a single Conversation to reopen."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.conversations import AnswerOut, ConversationOut, ConversationSummaryOut
from app.services import conversations
from app.services.auth import CurrentUser, current_user

router = APIRouter()


@router.get("/conversations", response_model=list[ConversationSummaryOut])
async def list_conversations(user: CurrentUser = Depends(current_user)):
    return [
        ConversationSummaryOut(id=c.id, question=question, created_at=c.created_at)
        for c, question in await conversations.list_conversations(user)
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
async def get_conversation(conversation_id: UUID, user: CurrentUser = Depends(current_user)):
    found = await conversations.get_conversation(user, conversation_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation, question, answers = found
    return ConversationOut(
        id=conversation.id,
        question=question,
        created_at=conversation.created_at,
        answers=[AnswerOut.model_validate(a, from_attributes=True) for a in answers],
    )
