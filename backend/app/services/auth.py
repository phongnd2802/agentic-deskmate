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

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import HTTPException, Request
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
    id: str
    email: str
    role: str
    locale: str
    organization_id: str
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


async def sign_in(email: str, password: str) -> tuple[str, CurrentUser]:
    normalized = email.strip().lower()
    async with session_factory() as db:
        async with db.begin():
            user = await _lookup_user(db, normalized)
            if user is None or not _verify_password(password, user["password_hash"]):
                raise InvalidCredentials

            await set_organization(db, user["organization_id"])
            token = secrets.token_urlsafe(32)
            db.add(
                Session(
                    organization_id=user["organization_id"],
                    user_id=user["user_id"],
                    token_hash=hash_token(token),
                    expires_at=datetime.now(UTC) + timedelta(days=settings.session_ttl_days),
                )
            )
            name = await db.scalar(select(Organization.name).where(Organization.id == user["organization_id"]))

    return token, CurrentUser(
        id=str(user["user_id"]),
        email=user["email"],
        role=user["role"],
        locale=user["locale"],
        organization_id=str(user["organization_id"]),
        organization_name=name,
    )


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
            await set_organization(db, found["organization_id"])
            name = await db.scalar(select(Organization.name).where(Organization.id == found["organization_id"]))

    return CurrentUser(
        id=str(found["user_id"]),
        email=found["email"],
        role=found["role"],
        locale=found["locale"],
        organization_id=str(found["organization_id"]),
        organization_name=name,
    )
