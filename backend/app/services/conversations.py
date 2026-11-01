"""Conversations and Answers, always scoped to the User's Organization (RLS) and owned by the User.

A Conversation that another User created is indistinguishable from one that does not exist.
"""

from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models import Answer, Conversation, Question
from app.db.session import session_factory, set_organization
from app.services.auth import CurrentUser


@asynccontextmanager
async def _scoped(user: CurrentUser):
    async with session_factory() as db, db.begin():
        await set_organization(db, user.organization_id)
        yield db


async def start_conversation(user: CurrentUser, conversation_id: UUID, question: str) -> UUID | None:
    """Create the Conversation with its question and return the question's ID.

    Returns None when the ID is taken, by this User's earlier question (single-turn) or by anyone else's
    Conversation. Both look the same on purpose.
    """
    question_id = uuid4()
    try:
        async with _scoped(user) as db:
            db.add(Conversation(id=conversation_id, organization_id=user.organization_id, user_id=user.id))
            await db.flush()
            db.add(Question(id=question_id, organization_id=user.organization_id, conversation_id=conversation_id, text=question))
    except IntegrityError:
        return None
    return question_id


async def save_answer(
    user: CurrentUser,
    conversation_id: UUID,
    question_id: UUID,
    run_id: str,
    model_id: str,
    parts: list[dict],
) -> None:
    async with _scoped(user) as db:
        db.add(
            Answer(
                organization_id=user.organization_id,
                conversation_id=conversation_id,
                question_id=question_id,
                run_id=run_id,
                status="complete",
                model_id=model_id,
                parts=parts,
            )
        )


def _mine(user: CurrentUser):
    return Conversation.user_id == user.id


async def list_conversations(user: CurrentUser) -> list[tuple[Conversation, str]]:
    """The User's own Conversations with their question, newest first."""
    async with _scoped(user) as db:
        rows = await db.execute(
            select(Conversation, Question.text)
            .join(Question, Question.conversation_id == Conversation.id)
            .where(_mine(user))
            .order_by(Conversation.created_at.desc(), Question.created_at)
        )
    # shortcut: one question per Conversation today, so the first row per Conversation is its question, upgrade with multi-turn
    seen: dict[UUID, tuple[Conversation, str]] = {}
    for conversation, text in rows:
        seen.setdefault(conversation.id, (conversation, text))
    return list(seen.values())


async def get_conversation(user: CurrentUser, conversation_id: UUID) -> tuple[Conversation, str, list[Answer]] | None:
    async with _scoped(user) as db:
        conversation = await db.scalar(select(Conversation).where(Conversation.id == conversation_id, _mine(user)))
        if conversation is None:
            return None
        question = await db.scalar(
            select(Question.text).where(Question.conversation_id == conversation_id).order_by(Question.created_at).limit(1)
        )
        answers = (
            await db.scalars(select(Answer).where(Answer.conversation_id == conversation_id).order_by(Answer.created_at))
        ).all()
    return conversation, question, list(answers)
