"""Sign-in, sessions and the current User.

Email and password are checked through `auth_lookup_user`, and a cookie token
through `auth_lookup_session`. Both are SECURITY DEFINER functions because the
runtime role cannot see across Organizations, and sign-in must find the User
before its Organization is known.
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Organization, Session
from app.db.session import session_factory, set_organization
from app.settings import SESSION_COOKIE, settings

_hasher = PasswordHasher()


class InvalidCredentials(Exception):
    pass


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    email: str
    role: Literal["admin", "member"]
    locale: str
    organization_id: UUID
    organization_name: str


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


async def _lookup_user(db: AsyncSession, email: str) -> dict | None:
    row = (await db.execute(text("SELECT * FROM auth_lookup_user(:email)"), {"email": email})).mappings().first()
    return dict(row) if row else None


async def _lookup_session(db: AsyncSession, token_hash: str) -> dict | None:
    row = (await db.execute(text("SELECT * FROM auth_lookup_session(:token_hash)"), {"token_hash": token_hash})).mappings().first()
    return dict(row) if row else None


async def _scoped_user(db: AsyncSession, row: dict) -> CurrentUser:
    """Scope the transaction to the row's Organization and build the User."""
    await set_organization(db, row["organization_id"])
    name = await db.scalar(select(Organization.name).where(Organization.id == row["organization_id"]))
    return CurrentUser(
        id=row["user_id"],
        email=row["email"],
        role=row["role"],
        locale=row["locale"],
        organization_id=row["organization_id"],
        organization_name=name,
    )


async def sign_in(email: str, password: str) -> tuple[str, CurrentUser]:
    normalized = email.strip().lower()
    async with session_factory() as db:
        async with db.begin():
            user = await _lookup_user(db, normalized)
            if user is None or not _verify_password(password, user["password_hash"]):
                raise InvalidCredentials

            current = await _scoped_user(db, user)
            token = secrets.token_urlsafe(32)
            db.add(
                Session(
                    organization_id=user["organization_id"],
                    user_id=user["user_id"],
                    token_hash=hash_token(token),
                    expires_at=datetime.now(UTC) + timedelta(days=settings.session_ttl_days),
                )
            )

    return token, current


async def sign_out(token: str) -> None:
    async with session_factory() as db:
        async with db.begin():
            found = await _lookup_session(db, hash_token(token))
            if found is None:
                return
            await set_organization(db, found["organization_id"])
            await db.execute(delete(Session).where(Session.token_hash == hash_token(token)))


async def current_user(request: Request) -> CurrentUser:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")

    async with session_factory() as db:
        async with db.begin():
            found = await _lookup_session(db, hash_token(token))
            if found is None:
                raise HTTPException(status_code=401, detail="Not signed in")
            return await _scoped_user(db, found)


async def admin_user(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return user
