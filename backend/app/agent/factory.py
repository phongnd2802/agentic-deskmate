"""The single Model factory: the only place a Model is built from configuration.

Every later ticket builds real Models from a Provider here. Until then, and for
both test seams, it returns the scripted Model.
"""

from pydantic_ai.models import Model
from pydantic_ai.models.function import FunctionModel

from app.agent.scripted import stream_answer

DEFAULT_MODEL_ID = "scripted"


def build_model(model_id: str | None = None) -> Model:
    return FunctionModel(stream_function=stream_answer, model_name=model_id or DEFAULT_MODEL_ID)
