"""Request and response bodies for the auth routes."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


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
    locale: str
    organization: OrganizationOut
