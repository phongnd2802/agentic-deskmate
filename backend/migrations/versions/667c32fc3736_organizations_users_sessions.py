"""Create organizations, users and sessions with RLS.

Revision ID: 667c32fc3736
Revises:
Create Date: 2026-11-01
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import make_url

from app.settings import settings

revision = "667c32fc3736"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create the non-superuser runtime role if it does not exist yet, with the
    # password from DATABASE_URL (passed through a transaction-local setting so it
    # is never spliced into SQL).
    password = make_url(settings.database_url).password
    if not password:
        raise RuntimeError("DATABASE_URL must carry the deskmate_app password")
    op.get_bind().execute(sa.text("SELECT set_config('deskmate.app_password', :pw, true)"), {"pw": password})
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'deskmate_app') THEN
                EXECUTE format('CREATE ROLE deskmate_app LOGIN PASSWORD %L', current_setting('deskmate.app_password'));
            END IF;
            EXECUTE format('GRANT CONNECT ON DATABASE %I TO deskmate_app', current_database());
        END $$;
        """
    )

    op.execute("GRANT USAGE ON SCHEMA public TO deskmate_app")

    op.execute(
        """
        CREATE TABLE organizations (
            id uuid PRIMARY KEY,
            name varchar(200) NOT NULL UNIQUE,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE users (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            email varchar(320) NOT NULL UNIQUE,
            password_hash text NOT NULL,
            role varchar(10) NOT NULL CHECK (role IN ('admin', 'member')),
            locale varchar(5) NOT NULL DEFAULT 'en',
            created_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE sessions (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash varchar(64) NOT NULL UNIQUE,
            expires_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )

    # Default privileges for any future tables created by the owner.
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO deskmate_app"
    )

    # Row-Level Security. FORCE subjects the table owner to RLS, but a superuser
    # always bypasses it. The owner role `deskmate` is POSTGRES_USER, a superuser,
    # so isolation holds only for the runtime role `deskmate_app`.
    for table in ("organizations", "users", "sessions"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    op.execute(
        """
        CREATE POLICY organizations_isolation ON organizations
            USING (id = current_setting('app.organization_id', true)::uuid)
            WITH CHECK (id = current_setting('app.organization_id', true)::uuid);
        """
    )
    op.execute(
        """
        CREATE POLICY users_isolation ON users
            USING (organization_id = current_setting('app.organization_id', true)::uuid)
            WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);
        """
    )
    op.execute(
        """
        CREATE POLICY sessions_isolation ON sessions
            USING (organization_id = current_setting('app.organization_id', true)::uuid)
            WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);
        """
    )

    # Grants for the runtime role.
    for table in ("organizations", "users", "sessions"):
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO deskmate_app")

    # SECURITY DEFINER lookups used during sign-in, before the Organization is known.
    op.execute(
        """
        CREATE FUNCTION auth_lookup_user(p_email text)
        RETURNS TABLE (user_id uuid, organization_id uuid, password_hash text, role text, locale text, email text)
        LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
            SELECT id, organization_id, password_hash, role, locale, email
            FROM users
            WHERE email = lower(p_email)
            LIMIT 1
        $$;
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO deskmate_app")

    op.execute(
        """
        CREATE FUNCTION auth_lookup_session(p_token_hash text)
        RETURNS TABLE (user_id uuid, organization_id uuid, role text, email text, locale text)
        LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
            SELECT s.user_id, s.organization_id, u.role, u.email, u.locale
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = p_token_hash AND s.expires_at > now()
            LIMIT 1
        $$;
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION auth_lookup_session(text) TO deskmate_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS auth_lookup_session(text)")
    op.execute("DROP FUNCTION IF EXISTS auth_lookup_user(text)")
    for table in ("sessions", "users", "organizations"):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
