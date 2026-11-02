"""Invitations and password resets: single-use, expiring links an Admin hands over.

A signed-out person reaches an Organization-scoped row only by the hash of the
token, through the SECURITY DEFINER functions `auth_peek_link` and
`auth_consume_link`. Using a link and registering happen in one transaction, so a
failed registration leaves the link unused.
"""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError

from app.db.models import AccessLink, Session, User
from app.db.session import scoped, session_factory, set_organization
from app.services.auth import CurrentUser, lookup_user, hash_password, hash_token
from app.settings import settings


Kind = Literal["invitation", "reset"]


class EmailTaken(Exception):
    pass


class UserNotFound(Exception):
    pass


class LinkRefused(Exception):
    """`reason` is link_invalid, link_used or link_expired."""

    def __init__(self, reason: str):
        self.reason = reason


async def _create(user: CurrentUser, kind: Kind, ttl: timedelta, email: str | None = None, user_id: UUID | None = None) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + ttl
    async with scoped(user.organization_id) as db:
        db.add(AccessLink(organization_id=user.organization_id, kind=kind, token_hash=hash_token(token), email=email, user_id=user_id, expires_at=expires_at))
    return token, expires_at


async def create_invitation(user: CurrentUser, email: str) -> tuple[str, datetime]:
    email = email.strip().lower()
    async with session_factory() as db, db.begin():
        # Across all Organizations: an email belongs to one User anywhere.
        if await lookup_user(db, email) is not None:
            raise EmailTaken
    return await _create(user, "invitation", timedelta(days=settings.invitation_ttl_days), email=email)


async def create_password_reset(user: CurrentUser, user_id: UUID) -> tuple[str, datetime]:
    async with scoped(user.organization_id) as db:
        # Another Organization's User is hidden by RLS and looks missing.
        if await db.scalar(select(User.id).where(User.id == user_id, User.organization_id == user.organization_id)) is None:
            raise UserNotFound
    return await _create(user, "reset", timedelta(hours=settings.password_reset_ttl_hours), user_id=user_id)


async def list_users(user: CurrentUser) -> list[User]:
    async with scoped(user.organization_id) as db:
        return list((await db.scalars(select(User).where(User.organization_id == user.organization_id).order_by(User.email))).all())


async def _refusal(db, token: str, kind: Kind) -> LinkRefused:
    row = (await db.execute(text("SELECT * FROM auth_peek_link(:h, :k)"), {"h": hash_token(token), "k": kind})).mappings().first()
    if row is None:
        return LinkRefused("link_invalid")
    return LinkRefused("link_used" if row["used_at"] is not None else "link_expired")


async def preview(token: str, kind: Kind) -> tuple[str, str]:
    """The Organization and email a link is for, or why it cannot be used."""
    async with session_factory() as db, db.begin():
        row = (await db.execute(text("SELECT * FROM auth_peek_link(:h, :k)"), {"h": hash_token(token), "k": kind})).mappings().first()
        if row is None or row["used_at"] is not None or row["expires_at"] <= datetime.now(UTC):
            raise await _refusal(db, token, kind)
        return row["organization_name"], row["email"]


async def accept(token: str, kind: Kind, password: str) -> None:
    """Use the link and set the password: register the invitee, or replace the password and end the User's sessions."""
    try:
        async with session_factory() as db, db.begin():
            row = (await db.execute(text("SELECT * FROM auth_consume_link(:h, :k)"), {"h": hash_token(token), "k": kind})).mappings().first()
            if row is None:
                raise await _refusal(db, token, kind)
            await set_organization(db, row["organization_id"])
            if kind == "invitation":
                db.add(User(organization_id=row["organization_id"], email=row["email"], password_hash=hash_password(password), role="member"))
                await db.flush()
            else:
                await db.execute(update(User).where(User.id == row["user_id"]).values(password_hash=hash_password(password)))
                await db.execute(delete(Session).where(Session.user_id == row["user_id"]))
                # Any other reset link for this User is void now.
                await db.execute(update(AccessLink).where(AccessLink.user_id == row["user_id"], AccessLink.kind == "reset", AccessLink.used_at.is_(None)).values(used_at=func.now()))
    except IntegrityError:
        # The whole transaction rolled back, so the link is still unused.
        raise EmailTaken from None
