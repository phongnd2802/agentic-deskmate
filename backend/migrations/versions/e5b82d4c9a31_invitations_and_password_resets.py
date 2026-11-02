"""Create access links (Invitations and password resets) with RLS.

Revision ID: e5b82d4c9a31
Revises: c7e3a1f05b92
Create Date: 2026-11-02
"""

from alembic import op

revision = "e5b82d4c9a31"
down_revision = "c7e3a1f05b92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only the hash of the link token is stored. An Invitation carries the email to register, a reset the User.
    op.execute(
        """
        CREATE TABLE access_links (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            kind varchar(10) NOT NULL CONSTRAINT access_links_kind_check CHECK (kind IN ('invitation', 'reset')),
            token_hash varchar(64) NOT NULL UNIQUE,
            email varchar(320),
            user_id uuid REFERENCES users(id) ON DELETE CASCADE,
            expires_at timestamptz NOT NULL,
            used_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ix_access_links_organization_id ON access_links (organization_id)")
    op.execute("ALTER TABLE access_links ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE access_links FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY access_links_isolation ON access_links
            USING (organization_id = current_setting('app.organization_id', true)::uuid)
            WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE access_links TO deskmate_app")

    # The person holding a link is signed out, so the Organization is found from the token hash. SECURITY DEFINER,
    # like the sign-in lookups, and each takes the hash of one link only.
    op.execute(
        """
        CREATE FUNCTION auth_peek_link(p_token_hash text, p_kind text)
        RETURNS TABLE (organization_name text, email text, expires_at timestamptz, used_at timestamptz)
        LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
            SELECT o.name, COALESCE(l.email, u.email), l.expires_at, l.used_at
            FROM access_links l
            JOIN organizations o ON o.id = l.organization_id
            LEFT JOIN users u ON u.id = l.user_id
            WHERE l.token_hash = p_token_hash AND l.kind = p_kind
        $$;
        """
    )
    # One UPDATE both checks and uses the link, so two simultaneous uses cannot both get a row.
    op.execute(
        """
        CREATE FUNCTION auth_consume_link(p_token_hash text, p_kind text)
        RETURNS TABLE (organization_id uuid, email text, user_id uuid)
        LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
            UPDATE access_links SET used_at = now()
            WHERE token_hash = p_token_hash AND kind = p_kind AND used_at IS NULL AND expires_at > now()
            RETURNING organization_id, email, user_id
        $$;
        """
    )
    for fn in ("auth_peek_link(text, text)", "auth_consume_link(text, text)"):
        op.execute(f"GRANT EXECUTE ON FUNCTION {fn} TO deskmate_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS auth_consume_link(text, text)")
    op.execute("DROP FUNCTION IF EXISTS auth_peek_link(text, text)")
    op.execute("DROP TABLE IF EXISTS access_links CASCADE")
