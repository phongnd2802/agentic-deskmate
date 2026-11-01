"""Server configuration, read from the environment."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Runtime connection: the non-superuser role that Row-Level Security applies to.
    database_url: str = "postgresql+asyncpg://deskmate_app:deskmate_app@localhost:5432/deskmate"
    # Owner connection for migrations and the Operator CLI; it bypasses RLS.
    migration_database_url: str | None = None
    session_ttl_days: int = 30

    @property
    def owner_database_url(self) -> str:
        return self.migration_database_url or self.database_url


settings = Settings()

SESSION_COOKIE = "session"
