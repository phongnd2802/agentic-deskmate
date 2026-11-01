"""The Agent that serves Chat: a Model plus the system prompt."""

from pydantic_ai import Agent

from app.agent.factory import build_model
from app.agent.prompts import SYSTEM_PROMPT
from app.services.providers import ModelChoice


def build_agent(choice: ModelChoice | None = None) -> Agent:
    """Without a choice the Agent has no Model yet; the route sets one once it has checked the Model is the User's."""
    return Agent(build_model(choice) if choice else None, instructions=SYSTEM_PROMPT)
