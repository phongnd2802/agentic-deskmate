"""Operator CLI: create Organizations and their first Admin."""

import argparse
import asyncio
import getpass
import os

from sqlalchemy import select

from app.db.models import Organization, User
from app.db.session import owner_session_factory
from app.services.auth import hash_password


async def _create_organization(name: str, email: str, password: str) -> str:
    email = email.strip().lower()
    async with owner_session_factory() as db, db.begin():
        if await db.scalar(select(User.id).where(User.email == email)) is not None:
            raise SystemExit(f"Email already in use: {email}")
        if await db.scalar(select(Organization.id).where(Organization.name == name)) is not None:
            raise SystemExit(f"Organization name already in use: {name}")
        org = Organization(name=name)
        db.add(org)
        await db.flush()
        db.add(User(organization_id=org.id, email=email, password_hash=hash_password(password), role="admin"))
    return str(org.id)


def main() -> None:
    parser = argparse.ArgumentParser(prog="deskmate-cli")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-organization", help="Create an Organization and its first Admin")
    create.add_argument("--name", required=True)
    create.add_argument("--admin-email", required=True)
    args = parser.parse_args()

    if args.command == "create-organization":
        # Never a flag: command-line arguments are visible in `ps`.
        password = os.environ.get("DESKMATE_ADMIN_PASSWORD")
        if not password:
            password = getpass.getpass("Admin password: ")
            confirm = getpass.getpass("Confirm password: ")
            if password != confirm:
                raise SystemExit("Passwords do not match")
        if len(password) < 8:
            raise SystemExit("Password must be at least 8 characters")
        org_id = asyncio.run(_create_organization(args.name, args.admin_email, password))
        print(f"Created Organization {org_id} with Admin {args.admin_email.strip().lower()}")


if __name__ == "__main__":
    main()
