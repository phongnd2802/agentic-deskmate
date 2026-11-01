"""The HTTP routes. main.py only builds the app and includes this router."""

from fastapi import APIRouter, Request
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.agent.chat import build_agent

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/agent")
async def agent(request: Request):
    return await AGUIAdapter.dispatch_request(request, agent=build_agent())
