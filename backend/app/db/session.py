"""Engines and the tenant-scoped transaction every request uses.

The runtime role is not a superuser and the tables force Row-Level Security, so a
transaction sees only the Organization named in `app.organization_id`. The owner
engine is for migrations and the Operator CLI, which act outside any tenant.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.settings import settings

engine = create_async_engine(settings.database_url)
session_factory = async_sessionmaker(engine, expire_on_commit=False)

owner_engine = create_async_engine(settings.owner_database_url)
owner_session_factory = async_sessionmaker(owner_engine, expire_on_commit=False)


async def set_organization(db: AsyncSession, organization_id: uuid.UUID) -> None:
    """Scope the current transaction to one Organization. Transaction-local."""
    await db.execute(text("SELECT set_config('app.organization_id', :id, true)"), {"id": str(organization_id)})


@asynccontextmanager
async def tenant_session(organization_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    async with session_factory() as db, db.begin():
        await set_organization(db, organization_id)
        yield db
