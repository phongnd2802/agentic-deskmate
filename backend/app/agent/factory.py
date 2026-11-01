"""The single Model factory: the only place a Model is built from configuration.

It is the substitution point for both test seams: with SCRIPTED_MODEL set, or when a test patches it,
no Provider is called.
"""

from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider

from app.agent.scripted import stream_answer
from app.net import checked_http_client
from app.services.providers import ModelChoice
from app.settings import settings


def build_model(choice: ModelChoice) -> Model:
    if settings.scripted_model:
        return FunctionModel(stream_function=stream_answer, model_name=choice.model_id)
    http_client = checked_http_client()
    if choice.api_type == "anthropic":
        return AnthropicModel(choice.model_id, provider=AnthropicProvider(api_key=choice.api_key, base_url=choice.base_url, http_client=http_client))
    return OpenAIChatModel(choice.model_id, provider=OpenAIProvider(api_key=choice.api_key, base_url=choice.base_url, http_client=http_client))
