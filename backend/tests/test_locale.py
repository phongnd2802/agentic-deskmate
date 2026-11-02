"""Seam 1: the interface language saved on the User."""

import httpx2

from app.main import app


async def locale_of(client) -> str | None:
    return (await client.get("/auth/me")).json()["locale"]


async def test_a_new_user_has_not_chosen_a_language(people):
    assert await locale_of(people["member"]) is None


async def test_the_choice_is_saved_on_the_user_and_only_for_that_user(people):
    assert (await people["member"].put("/auth/locale", json={"locale": "vi"})).status_code == 204

    assert await locale_of(people["member"]) == "vi"
    assert await locale_of(people["admin"]) is None
    assert await locale_of(people["outsider"]) is None


async def test_only_english_and_vietnamese_are_accepted(people):
    for locale in ("fr", "", "VI"):
        assert (await people["member"].put("/auth/locale", json={"locale": locale})).status_code == 422
    assert await locale_of(people["member"]) is None


async def test_changing_language_needs_a_session():
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.put("/auth/locale", json={"locale": "vi"})).status_code == 401
