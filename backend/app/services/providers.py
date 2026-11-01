"""Providers and their Models, scoped to the User's Organization (RLS).

A Provider of another Organization is indistinguishable from one that does not exist.
"""

from dataclasses import dataclass, field
from uuid import UUID

from cryptography.fernet import Fernet
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.db.models import Model, Provider
from app.db.session import scoped
from app.net import check_base_url
from app.schemas.providers import ProviderIn
from app.services.auth import CurrentUser
from app.settings import settings


class NameTaken(Exception):
    pass


@dataclass(frozen=True)
class ModelChoice:
    """Everything needed to call one Model. The key is decrypted, so it stays out of repr and logs."""

    id: UUID
    provider_name: str
    api_type: str
    base_url: str
    api_key: str = field(repr=False)
    model_id: str
    generative_ui: bool


def _fernet() -> Fernet:
    if not settings.encryption_key:
        raise RuntimeError("ENCRYPTION_KEY is not set")
    return Fernet(settings.encryption_key)


def _encrypt(key: str) -> str:
    return _fernet().encrypt(key.encode()).decode()


async def _models(db, provider_id: UUID) -> list[Model]:
    return list((await db.scalars(select(Model).where(Model.provider_id == provider_id).order_by(Model.created_at, Model.model_id))).all())


async def list_providers(user: CurrentUser) -> list[tuple[Provider, list[Model]]]:
    async with scoped(user.organization_id) as db:
        providers = (await db.scalars(select(Provider).where(Provider.organization_id == user.organization_id).order_by(Provider.created_at, Provider.name))).all()
        return [(p, await _models(db, p.id)) for p in providers]


async def create_provider(user: CurrentUser, data: ProviderIn) -> tuple[Provider, list[Model]]:
    await check_base_url(data.base_url)
    provider = Provider(
        organization_id=user.organization_id,
        name=data.name,
        api_type=data.api_type,
        base_url=data.base_url,
        api_key_encrypted=_encrypt(data.api_key),
    )
    models = [Model(organization_id=user.organization_id, model_id=m.model_id, generative_ui=m.generative_ui) for m in data.models]
    try:
        async with scoped(user.organization_id) as db:
            db.add(provider)
            await db.flush()
            for model in models:
                model.provider_id = provider.id
            db.add_all(models)
    except IntegrityError:
        raise NameTaken from None
    return provider, models


async def update_provider(user: CurrentUser, provider_id: UUID, data: ProviderIn) -> tuple[Provider, list[Model]] | None:
    await check_base_url(data.base_url)
    try:
        async with scoped(user.organization_id) as db:
            provider = await db.scalar(select(Provider).where(Provider.id == provider_id, Provider.organization_id == user.organization_id))
            if provider is None:
                return None
            provider.name, provider.api_type, provider.base_url = data.name, data.api_type, data.base_url
            if data.api_key:
                provider.api_key_encrypted = _encrypt(data.api_key)
            existing = {m.model_id: m for m in await _models(db, provider_id)}
            wanted = {m.model_id for m in data.models}
            # Models that stay keep their ID, so a User's open picker still points at them.
            await db.execute(delete(Model).where(Model.provider_id == provider_id, Model.model_id.not_in(wanted)))
            for m in data.models:
                if m.model_id in existing:
                    existing[m.model_id].generative_ui = m.generative_ui
                else:
                    db.add(Model(organization_id=user.organization_id, provider_id=provider_id, model_id=m.model_id, generative_ui=m.generative_ui))
            await db.flush()
            return provider, await _models(db, provider_id)
    except IntegrityError:
        raise NameTaken from None


async def delete_provider(user: CurrentUser, provider_id: UUID) -> bool:
    async with scoped(user.organization_id) as db:
        return (await db.execute(delete(Provider).where(Provider.id == provider_id, Provider.organization_id == user.organization_id))).rowcount > 0


async def list_models(user: CurrentUser) -> list[tuple[Model, str]]:
    async with scoped(user.organization_id) as db:
        rows = await db.execute(
            select(Model, Provider.name)
            .join(Provider, Provider.id == Model.provider_id)
            .where(Model.organization_id == user.organization_id, Provider.organization_id == user.organization_id)
            .order_by(Provider.name, Model.model_id)
        )
        return [(m, name) for m, name in rows]


async def _choose(user: CurrentUser, *conditions) -> ModelChoice | None:
    async with scoped(user.organization_id) as db:
        row = (
            await db.execute(
                select(Provider, Model)
                .join(Model, Model.provider_id == Provider.id)
                .where(Model.organization_id == user.organization_id, Provider.organization_id == user.organization_id, *conditions)
            )
        ).first()
    if row is None:
        return None
    provider, model = row
    return ModelChoice(model.id, provider.name, provider.api_type, provider.base_url, _fernet().decrypt(provider.api_key_encrypted.encode()).decode(), model.model_id, model.generative_ui)


async def choose_model(user: CurrentUser, model_pk: UUID) -> ModelChoice | None:
    """The Model with this ID if it belongs to the User's Organization, whatever the client claims. Also how a retry finds the Model that wrote an Answer."""
    return await _choose(user, Model.id == model_pk)
