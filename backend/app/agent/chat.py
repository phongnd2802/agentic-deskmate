"""The Agent that serves Chat: a Model plus the system prompt."""

from pydantic_ai import Agent

from app.agent.factory import build_model
from app.agent.generative_ui import PROMPT as GENERATIVE_UI_PROMPT, a2ui_prompt
from app.agent.prompts import SYSTEM_PROMPT
from app.services.providers import ModelChoice


def build_agent(choice: ModelChoice | None = None) -> Agent:
    """Without a choice the Agent has no Model yet; the route sets one once it has checked the Model is the User's."""
    instructions = f"{SYSTEM_PROMPT}\n{GENERATIVE_UI_PROMPT}\n{a2ui_prompt()}" if choice and choice.generative_ui else SYSTEM_PROMPT
    return Agent(build_model(choice) if choice else None, instructions=instructions)
