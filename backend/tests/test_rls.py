"""Seam 1: Row-Level Security blocks a query that omits the application filter."""

import uuid

import asyncpg
import pytest


@pytest.mark.asyncio
async def test_rls_blocks_a_query_missing_the_application_filter(owner_conn, app_conn):
    # Seed two Organizations and a User in each, as the owner.
    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    await owner_conn.execute("INSERT INTO organizations (id, name) VALUES ($1, $2)", org_a, "Org A")
    await owner_conn.execute("INSERT INTO organizations (id, name) VALUES ($1, $2)", org_b, "Org B")
    await owner_conn.execute(
        "INSERT INTO users (id, organization_id, email, password_hash, role) VALUES ($1,$2,$3,$4,'member')",
        uuid.uuid4(),
        org_a,
        f"a-{org_a}@example.com",
        "x",
    )
    await owner_conn.execute(
        "INSERT INTO users (id, organization_id, email, password_hash, role) VALUES ($1,$2,$3,$4,'member')",
        uuid.uuid4(),
        org_b,
        f"b-{org_b}@example.com",
        "x",
    )

    # As the runtime role, scope a transaction to Organization A: a plain
    # SELECT with no WHERE returns only A's row, thanks to Row-Level Security.
    async with app_conn.transaction():
        await app_conn.execute("SELECT set_config('app.organization_id', $1, true)", str(org_a))
        rows = await app_conn.fetch("SELECT email FROM users")
        assert [r["email"] for r in rows] == [f"a-{org_a}@example.com"]

    # Scoped to Organization B: never A's row.
    async with app_conn.transaction():
        await app_conn.execute("SELECT set_config('app.organization_id', $1, true)", str(org_b))
        rows = await app_conn.fetch("SELECT email FROM users")
        assert [r["email"] for r in rows] == [f"b-{org_b}@example.com"]


@pytest.mark.asyncio
async def test_rls_blocks_a_query_with_no_organization_set(app_conn):
    async with app_conn.transaction():
        rows = await app_conn.fetch("SELECT email FROM users")
        assert rows == []
