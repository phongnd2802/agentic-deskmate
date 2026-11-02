"""Seam 1: Invitations, password resets, roles and Organization isolation over HTTP."""

import asyncio
import uuid

import httpx2
import pytest

from app.main import app
from tests.conftest import PASSWORD

NEW_PASSWORD = "brand-new-pass"


def anonymous() -> httpx2.AsyncClient:
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://test")


def new_email() -> str:
    return f"invited-{uuid.uuid4().hex[:8]}@example.com"


async def invite(admin, email: str | None = None) -> tuple[str, str]:
    email = email or new_email()
    response = await admin.post("/invitations", json={"email": email})
    assert response.status_code == 201, response.text
    return email, response.json()["token"]


async def accept(token: str, password: str = NEW_PASSWORD):
    async with anonymous() as client:
        return await client.post(f"/invitations/{token}/accept", json={"password": password})


async def sign_in(email: str, password: str):
    async with anonymous() as client:
        return await client.post("/auth/sign-in", json={"email": email, "password": password})


async def users_of(client) -> dict[str, dict]:
    return {u["email"]: u for u in (await client.get("/users")).json()}


async def test_an_invited_person_becomes_a_member_of_the_admins_organization(people):
    email, token = await invite(people["admin"])

    async with anonymous() as client:
        shown = await client.get(f"/invitations/{token}")
    assert shown.status_code == 200 and shown.json()["email"] == email

    assert (await accept(token)).status_code == 204
    signed_in = await sign_in(email, NEW_PASSWORD)
    assert signed_in.status_code == 200
    body = signed_in.json()
    assert body["role"] == "member"
    mine = (await people["admin"].get("/auth/me")).json()["organization"]
    assert body["organization"] == mine


async def test_an_invitation_works_once_and_a_second_use_says_it_was_used(people):
    email, token = await invite(people["admin"])
    assert (await accept(token)).status_code == 204

    again = await accept(token, "another-pass-1")
    assert again.status_code == 410 and again.json()["detail"]["code"] == "link_used"
    async with anonymous() as client:
        assert (await client.get(f"/invitations/{token}")).json()["detail"]["code"] == "link_used"
    assert (await sign_in(email, "another-pass-1")).status_code == 401


async def test_two_simultaneous_uses_create_one_user(people):
    _, token = await invite(people["admin"])
    results = await asyncio.gather(accept(token, "first-pass-12"), accept(token, "second-pass-12"))
    assert sorted(r.status_code for r in results) == [204, 410]


async def test_an_expired_invitation_is_refused_with_its_own_message(people, owner_conn):
    email, token = await invite(people["admin"])
    await owner_conn.execute("UPDATE access_links SET expires_at = now() - interval '1 second' WHERE email = $1", email)

    refused = await accept(token)
    assert refused.status_code == 410 and refused.json()["detail"]["code"] == "link_expired"
    assert (await sign_in(email, NEW_PASSWORD)).status_code == 401


async def test_an_unknown_link_is_refused(people):
    refused = await accept("not-a-real-token")
    assert refused.status_code == 404 and refused.json()["detail"]["code"] == "link_invalid"


async def test_a_short_password_is_refused_and_does_not_use_the_invitation(people):
    _, token = await invite(people["admin"])
    assert (await accept(token, "short")).status_code == 422
    assert (await accept(token)).status_code == 204


async def test_an_email_in_use_cannot_be_invited_or_registered_again(people):
    admin = people["admin"]
    taken = (await admin.get("/auth/me")).json()["email"]
    refused = await admin.post("/invitations", json={"email": taken.upper()})
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "email_taken"
    # Also when the email lives in another Organization.
    other = (await people["outsider"].get("/auth/me")).json()["email"]
    assert (await admin.post("/invitations", json={"email": other})).status_code == 409

    # Two invitations to one email: the second person to accept is refused and the link stays usable.
    email, first = await invite(admin)
    _, second = await invite(admin, email)
    assert (await accept(first)).status_code == 204
    clash = await accept(second)
    assert clash.status_code == 409 and clash.json()["detail"]["code"] == "email_taken"


async def test_a_link_stays_unused_when_the_registration_fails(people, owner_conn):
    admin = people["admin"]
    email, token = await invite(admin)
    await owner_conn.execute(
        "INSERT INTO users (id, organization_id, email, password_hash, role) SELECT $1, organization_id, $2, 'x', 'member' FROM users LIMIT 1",
        uuid.uuid4(),
        email,
    )
    assert (await accept(token)).status_code == 409
    used = await owner_conn.fetchval("SELECT used_at FROM access_links WHERE email = $1", email)
    assert used is None


async def test_only_the_link_hash_is_stored(people, owner_conn):
    _, token = await invite(people["admin"])
    stored = await owner_conn.fetch("SELECT token_hash FROM access_links")
    assert token not in [r["token_hash"] for r in stored]
    assert all(len(r["token_hash"]) == 64 for r in stored)


async def test_an_admin_resets_a_password_once_and_old_sessions_end(people):
    admin, member = people["admin"], people["member"]
    target = (await member.get("/auth/me")).json()
    created = await admin.post(f"/users/{target['id']}/password-reset")
    assert created.status_code == 201, created.text
    token = created.json()["token"]

    async with anonymous() as client:
        shown = await client.get(f"/password-resets/{token}")
        assert shown.json()["email"] == target["email"]
        done = await client.post(f"/password-resets/{token}/accept", json={"password": NEW_PASSWORD})
        again = await client.post(f"/password-resets/{token}/accept", json={"password": "other-pass-99"})
    assert done.status_code == 204
    assert again.status_code == 410 and again.json()["detail"]["code"] == "link_used"

    assert (await member.get("/auth/me")).status_code == 401, "the old session ended"
    assert (await sign_in(target["email"], PASSWORD)).status_code == 401
    assert (await sign_in(target["email"], NEW_PASSWORD)).status_code == 200
    assert (await admin.get("/auth/me")).status_code == 200, "other Users keep their sessions"


async def test_an_expired_reset_link_is_refused(people, owner_conn):
    member_id = (await people["member"].get("/auth/me")).json()["id"]
    token = (await people["admin"].post(f"/users/{member_id}/password-reset")).json()["token"]
    await owner_conn.execute("UPDATE access_links SET expires_at = now() - interval '1 second' WHERE user_id = $1", uuid.UUID(member_id))
    async with anonymous() as client:
        refused = await client.post(f"/password-resets/{token}/accept", json={"password": NEW_PASSWORD})
    assert refused.status_code == 410 and refused.json()["detail"]["code"] == "link_expired"


async def test_an_invitation_token_is_not_a_reset_token(people):
    _, token = await invite(people["admin"])
    async with anonymous() as client:
        assert (await client.post(f"/password-resets/{token}/accept", json={"password": NEW_PASSWORD})).status_code == 404


async def test_an_admin_cannot_reset_a_user_of_another_organization(people):
    outsider_id = (await people["outsider"].get("/auth/me")).json()["id"]
    assert (await people["admin"].post(f"/users/{outsider_id}/password-reset")).status_code == 404
    assert (await people["admin"].post(f"/users/{uuid.uuid4()}/password-reset")).status_code == 404


async def test_an_admin_lists_only_their_own_organizations_users(people):
    listed = await users_of(people["admin"])
    mine = {(await people[who].get("/auth/me")).json()["email"] for who in ("admin", "member")}
    assert set(listed) == mine


async def test_a_member_is_refused_every_admin_action(people):
    member = people["member"]
    some_id = uuid.uuid4()
    calls = [
        member.get("/users"),
        member.post("/invitations", json={"email": new_email()}),
        member.post(f"/users/{some_id}/password-reset"),
    ]
    assert [r.status_code for r in await asyncio.gather(*calls)] == [403, 403, 403]


def test_every_route_but_the_listed_ones_requires_an_admin():
    from fastapi.routing import APIRoute

    from app.services.auth import admin_user, current_user

    signed_out = {"/health", "/auth/sign-in", "/auth/sign-out"}
    signed_out |= {p for p in (r.path for r in app.routes if isinstance(r, APIRoute)) if p.startswith(("/invitations/", "/password-resets/"))}
    any_user = {"/auth/me", "/models", "/agent", "/conversations", "/conversations/{conversation_id}"}

    def guards(route: APIRoute) -> set:
        found, stack = set(), list(route.dependant.dependencies)
        while stack:
            dep = stack.pop()
            found.add(dep.call)
            stack.extend(dep.dependencies)
        return found

    unguarded = []
    for route in (r for r in app.routes if isinstance(r, APIRoute)):
        if route.path in signed_out:
            continue
        needed = current_user if route.path in any_user else admin_user
        if needed not in guards(route):
            unguarded.append(route.path)
    assert unguarded == []
