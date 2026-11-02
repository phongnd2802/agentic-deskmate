"""A User's language is unset until they choose one.

Revision ID: f1a7c3d9b208
Revises: e5b82d4c9a31
Create Date: 2026-11-02
"""

from alembic import op

revision = "f1a7c3d9b208"
down_revision = "e5b82d4c9a31"
branch_labels = None
depends_on = None


def _without_rls(statement: str) -> None:
    # FORCE ROW LEVEL SECURITY applies to the owner too, and no Organization is set here.
    op.execute("ALTER TABLE users NO FORCE ROW LEVEL SECURITY")
    op.execute(statement)
    op.execute("ALTER TABLE users FORCE ROW LEVEL SECURITY")


def upgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN locale DROP NOT NULL, ALTER COLUMN locale DROP DEFAULT")
    # Nobody could choose before, so every stored 'en' was only the default.
    _without_rls("UPDATE users SET locale = NULL")
    op.execute("ALTER TABLE users ADD CONSTRAINT users_locale_check CHECK (locale IN ('en', 'vi'))")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT users_locale_check")
    _without_rls("UPDATE users SET locale = 'en' WHERE locale IS NULL")
    op.execute("ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'en', ALTER COLUMN locale SET NOT NULL")
