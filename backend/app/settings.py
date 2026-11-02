"""Server configuration, read from the environment."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Runtime connection: the non-superuser role that Row-Level Security applies to.
    database_url: str = "postgresql+asyncpg://deskmate_app:deskmate_app@localhost:5432/deskmate"
    # Owner connection for migrations and the Operator CLI; it bypasses RLS.
    migration_database_url: str | None = None
    session_ttl_days: int = 30
    # How long an Invitation or a password reset link works.
    invitation_ttl_days: int = 7
    password_reset_ttl_hours: int = 24
    # Secure cookie: on everywhere except local development over plain HTTP.
    session_cookie_secure: bool = True

    # Fernet key that encrypts Provider API keys at rest: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    encryption_key: str = ""
    # Comma-separated networks (CIDR) a Provider may live in although they are private, such as a local Ollama: "127.0.0.0/8,10.0.0.0/8".
    provider_allowed_networks: str = ""
    # Answer with the scripted Model instead of calling a Provider. For tests and the browser tests only.
    scripted_model: bool = False

    @property
    def owner_database_url(self) -> str:
        return self.migration_database_url or self.database_url


settings = Settings()

SESSION_COOKIE = "session"
