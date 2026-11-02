"""Request and response bodies for the auth routes."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


Locale = Literal["en", "vi"]


class LocaleRequest(BaseModel):
    locale: Locale


class SignInRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class OrganizationOut(BaseModel):
    id: UUID
    name: str


class CurrentUserOut(BaseModel):
    id: UUID
    email: EmailStr
    role: Literal["admin", "member"]
    locale: Locale | None
    organization: OrganizationOut
