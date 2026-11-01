"""Create providers and models with RLS.

Revision ID: c7e3a1f05b92
Revises: a41c9d2e7b10
Create Date: 2026-11-01
"""

from alembic import op

revision = "c7e3a1f05b92"
down_revision = "a41c9d2e7b10"
branch_labels = None
depends_on = None

TABLES = ("providers", "models")


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE providers (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name varchar(200) NOT NULL,
            api_type varchar(10) NOT NULL CONSTRAINT providers_api_type_check CHECK (api_type IN ('openai', 'anthropic')),
            base_url text NOT NULL,
            api_key_encrypted text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (organization_id, name)
        );
        """
    )
    op.execute("CREATE INDEX ix_providers_organization_id ON providers (organization_id)")
    # Answers keep Provider and Model names as text and reference neither table, so deleting a Provider leaves history alone.
    op.execute(
        """
        CREATE TABLE models (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            model_id varchar(200) NOT NULL,
            generative_ui boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (provider_id, model_id)
        );
        """
    )
    op.execute("CREATE INDEX ix_models_organization_id ON models (organization_id)")
    op.execute("CREATE INDEX ix_models_provider_id ON models (provider_id)")

    # Which Model row wrote an Answer, for retry. Deliberately not a foreign key, and null for any Answer stored before this.
    op.execute("ALTER TABLE answers ADD COLUMN model_row_id uuid")

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table}_isolation ON {table}
                USING (organization_id = current_setting('app.organization_id', true)::uuid)
                WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);
            """
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO deskmate_app")


def downgrade() -> None:
    op.execute("ALTER TABLE answers DROP COLUMN IF EXISTS model_row_id")
    for table in reversed(TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
