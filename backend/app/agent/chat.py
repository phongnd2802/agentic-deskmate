"""The Agent that serves Chat: a Model plus the system prompt."""

from pydantic_ai import Agent

from app.agent.factory import build_model
from app.agent.prompts import SYSTEM_PROMPT


def build_agent() -> Agent:
    return Agent(build_model(), instructions=SYSTEM_PROMPT)
