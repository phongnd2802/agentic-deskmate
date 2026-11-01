"""Request and response bodies for Providers and Models. No response ever carries the API key."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ApiType = Literal["openai", "anthropic"]


class ModelIn(BaseModel):
    model_id: str = Field(min_length=1, max_length=200)
    generative_ui: bool = False


class ProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    api_type: ApiType
    base_url: str = Field(min_length=1)
    # Required to add a Provider; empty on an edit keeps the stored key.
    api_key: str = ""
    models: list[ModelIn] = Field(min_length=1)

    @field_validator("models")
    @classmethod
    def _unique(cls, models: list[ModelIn]) -> list[ModelIn]:
        if len({m.model_id for m in models}) != len(models):
            raise ValueError("Model IDs must be unique within a Provider")
        return models


class ModelOut(BaseModel):
    id: UUID
    model_id: str
    generative_ui: bool


class ProviderOut(BaseModel):
    id: UUID
    name: str
    api_type: ApiType
    base_url: str
    models: list[ModelOut]


class ChoosableModelOut(BaseModel):
    """A Model as the composer offers it."""

    id: UUID
    provider_name: str
    model_id: str
