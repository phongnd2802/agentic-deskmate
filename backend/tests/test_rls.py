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


@pytest.mark.asyncio
async def test_rls_isolates_conversations_questions_and_answers(owner_conn, app_conn):
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    for org in (org_a, org_b):
        await owner_conn.execute("INSERT INTO organizations (id, name) VALUES ($1, $2)", org, f"Org {org}")
    seeded = {}
    for org in (org_a, org_b):
        user, conversation, question = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        seeded[org] = conversation
        await owner_conn.execute(
            "INSERT INTO users (id, organization_id, email, password_hash, role) VALUES ($1,$2,$3,'x','member')",
            user, org, f"u-{user}@example.com",
        )
        await owner_conn.execute("INSERT INTO conversations (id, organization_id, user_id) VALUES ($1,$2,$3)", conversation, org, user)
        await owner_conn.execute(
            "INSERT INTO questions (id, organization_id, conversation_id, text) VALUES ($1,$2,$3,'q')", question, org, conversation
        )
        await owner_conn.execute(
            "INSERT INTO answers (id, organization_id, conversation_id, question_id, run_id, status, model_id, parts)"
            " VALUES ($1,$2,$3,$4,'r','complete','m','[]')",
            uuid.uuid4(), org, conversation, question,
        )

    # No WHERE clause anywhere: only Row-Level Security separates the Organizations.
    for table in ("conversations", "questions", "answers"):
        async with app_conn.transaction():
            await app_conn.execute("SELECT set_config('app.organization_id', $1, true)", str(org_a))
            rows = await app_conn.fetch(f"SELECT organization_id FROM {table}")
            assert [r["organization_id"] for r in rows] == [org_a], table
        async with app_conn.transaction():
            await app_conn.execute("SELECT set_config('app.organization_id', $1, true)", str(uuid.uuid4()))
            assert await app_conn.fetch(f"SELECT 1 FROM {table}") == [], table

    # A write for another Organization is refused.
    async with app_conn.transaction():
        await app_conn.execute("SELECT set_config('app.organization_id', $1, true)", str(org_a))
        with pytest.raises(asyncpg.PostgresError):
            await app_conn.execute(
                "INSERT INTO questions (id, organization_id, conversation_id, text) VALUES ($1,$2,$3,'x')",
                uuid.uuid4(), org_b, seeded[org_b],
            )

    # FORCE keeps the table owner subject to the policy too.
    flags = await owner_conn.fetch(
        "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1)",
        ["conversations", "questions", "answers"],
    )
    assert len(flags) == 3 and all(r["relrowsecurity"] and r["relforcerowsecurity"] for r in flags)
