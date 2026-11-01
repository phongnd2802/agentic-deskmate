"""Create conversations, questions and answers with RLS.

Revision ID: a41c9d2e7b10
Revises: 667c32fc3736
Create Date: 2026-11-01
"""

from alembic import op

revision = "a41c9d2e7b10"
down_revision = "667c32fc3736"
branch_labels = None
depends_on = None

TABLES = ("conversations", "questions", "answers")


def upgrade() -> None:
    # The Conversation ID is the AG-UI threadId, so the browser picks it and it has no default.
    op.execute(
        """
        CREATE TABLE conversations (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ix_conversations_organization_id ON conversations (organization_id)")
    op.execute("CREATE INDEX ix_conversations_user_id ON conversations (user_id)")
    # No unique constraint on conversation_id: multi-turn will add more questions (issue #4).
    op.execute(
        """
        CREATE TABLE questions (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            text text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ix_questions_organization_id ON questions (organization_id)")
    op.execute("CREATE INDEX ix_questions_conversation_id ON questions (conversation_id)")
    op.execute(
        """
        CREATE TABLE answers (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            run_id varchar(200) NOT NULL,
            status varchar(10) NOT NULL CONSTRAINT answers_status_check CHECK (status IN ('complete', 'stopped', 'failed')),
            provider_name varchar(200),
            model_id varchar(200) NOT NULL,
            parts jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ix_answers_organization_id ON answers (organization_id)")
    op.execute("CREATE INDEX ix_answers_conversation_id ON answers (conversation_id)")

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
    for table in reversed(TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
