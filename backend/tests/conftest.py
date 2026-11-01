"""Shared test fixtures: a fresh Postgres database per session, migrated."""

import asyncio
import os

# The test client talks plain HTTP, which would drop a Secure cookie.
os.environ.setdefault("SESSION_COOKIE_SECURE", "false")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://deskmate_app:deskmate_app@localhost:5432/deskmate_test")
os.environ.setdefault("MIGRATION_DATABASE_URL", "postgresql+asyncpg://deskmate:deskmate@localhost:5432/deskmate_test")

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import create_async_engine

# Point the app at a dedicated test database on the Postgres service.
TEST_DB = "deskmate_test"


def _owner_url() -> str:
    return os.environ["MIGRATION_DATABASE_URL"]


def _app_url() -> str:
    return os.environ["DATABASE_URL"]


async def _reset_test_db() -> None:
    owner = _owner_url().replace("+asyncpg", "")
    # Derive the maintenance database URL.
    base = owner.rsplit("/", 1)[0] + "/postgres"
    # Keep the same credentials.
    conn = await asyncpg.connect(base)
    await conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB}")
    await conn.execute(f"CREATE DATABASE {TEST_DB}")
    await conn.close()

    # Run migrations against the test database.
    migration_url = _owner_url().rsplit("/", 1)[0] + f"/{TEST_DB}"
    app_url = _app_url().rsplit("/", 1)[0] + f"/{TEST_DB}"
    os.environ["MIGRATION_DATABASE_URL"] = migration_url
    os.environ["DATABASE_URL"] = app_url

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", migration_url)

    def _upgrade():
        command.upgrade(cfg, "head")

    await asyncio.to_thread(_upgrade)


@pytest.fixture(scope="session", autouse=True)
async def _database():
    await _reset_test_db()
    yield


@pytest.fixture
async def owner_conn():
    import asyncpg

    url = os.environ["MIGRATION_DATABASE_URL"].replace("+asyncpg", "")
    conn = await asyncpg.connect(url)
    yield conn
    await conn.close()


@pytest.fixture
async def app_conn():
    url = os.environ["DATABASE_URL"].replace("+asyncpg", "")
    conn = await asyncpg.connect(url)
    yield conn
    await conn.close()


@pytest.fixture
async def admin_credentials():
    import uuid

    from argon2 import PasswordHasher

    hasher = PasswordHasher()
    email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    password = "secret1234"
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    owner_url = os.environ["MIGRATION_DATABASE_URL"].replace("+asyncpg", "")
    conn = await asyncpg.connect(owner_url)
    await conn.execute(
        "INSERT INTO organizations (id, name) VALUES ($1, $2)", org_id, f"Org {org_id}"
    )
    await conn.execute(
        "INSERT INTO users (id, organization_id, email, password_hash, role) VALUES ($1,$2,$3,$4,'admin')",
        user_id,
        org_id,
        email,
        hasher.hash(password),
    )
    await conn.close()
    return email, password
