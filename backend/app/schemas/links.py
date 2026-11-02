"""Request and response bodies for Invitations, password resets and the user list."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class InvitationIn(BaseModel):
    email: EmailStr


class LinkOut(BaseModel):
    """The raw token is shown once, here; only its hash is stored."""

    token: str
    expires_at: datetime


class LinkPreviewOut(BaseModel):
    organization_name: str
    email: EmailStr


class AcceptIn(BaseModel):
    password: str = Field(min_length=8, max_length=1024)


class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    role: Literal["admin", "member"]
