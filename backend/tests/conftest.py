"""Shared test fixtures: a fresh Postgres database per session, migrated."""

import asyncio
import os

# The test client talks plain HTTP, which would drop a Secure cookie.
os.environ.setdefault("SESSION_COOKIE_SECURE", "false")
# A throwaway Fernet key, and the scripted Model in place of a real LLM.
os.environ.setdefault("ENCRYPTION_KEY", "Zm9yLXRlc3RzLW9ubHktMzItYnl0ZXMta2V5LTAwMDA=")
os.environ.setdefault("SCRIPTED_MODEL", "true")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://deskmate_app:deskmate_app@localhost:5432/deskmate_test")
os.environ.setdefault("MIGRATION_DATABASE_URL", "postgresql+asyncpg://deskmate:deskmate@localhost:5432/deskmate_test")

import uuid

import asyncpg
import httpx2
import pytest
from argon2 import PasswordHasher
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


@pytest.fixture(autouse=True)
async def _fresh_pool():
    """Each test has its own event loop, so pooled connections from an earlier test cannot be reused."""
    yield
    from app.db.session import engine

    await engine.dispose()


PASSWORD = "secret1234"
PROVIDER = {
    "name": "Acme",
    "api_type": "openai",
    # A public literal, so saving needs no DNS.
    "base_url": "https://8.8.8.8/v1",
    "api_key": "sk-secret-key",
    "models": [{"model_id": "model-a"}],
}


async def make_user(org_id: uuid.UUID, role: str) -> str:
    email = f"{role}-{uuid.uuid4().hex[:8]}@example.com"
    conn = await asyncpg.connect(os.environ["MIGRATION_DATABASE_URL"].replace("+asyncpg", ""))
    await conn.execute(
        "INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", org_id, f"Org {org_id}"
    )
    await conn.execute(
        "INSERT INTO users (id, organization_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)",
        uuid.uuid4(),
        org_id,
        email,
        PasswordHasher().hash(PASSWORD),
        role,
    )
    await conn.close()
    return email


async def make_client(email: str) -> httpx2.AsyncClient:
    from app.main import app

    client = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://test")
    response = await client.post("/auth/sign-in", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return client


@pytest.fixture
async def people():
    """A Member and an Admin in one Organization, and a Member of another. Each Organization has a Provider.

    `client.model_id` is the ID of that Organization's Model "model-a", the one a browser would send.
    """
    org, other = uuid.uuid4(), uuid.uuid4()
    clients = {
        "member": await make_client(await make_user(org, "member")),
        "admin": await make_client(await make_user(org, "admin")),
        "outsider": await make_client(await make_user(other, "member")),
        "outsider_admin": await make_client(await make_user(other, "admin")),
    }
    for admin, members in (("admin", ["member"]), ("outsider_admin", ["outsider"])):
        response = await clients[admin].post("/providers", json=PROVIDER)
        assert response.status_code == 201, response.text
        for who in (admin, *members):
            clients[who].model_id = response.json()["models"][0]["id"]
    yield clients
    for client in clients.values():
        await client.aclose()
