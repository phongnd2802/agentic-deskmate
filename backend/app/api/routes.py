"""The HTTP routes. main.py only builds the app and includes this router."""

from fastapi import APIRouter, Depends, Request
from pydantic_ai.ui.ag_ui import AGUIAdapter

from app.agent.chat import build_agent
from app.services.auth import current_user

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/agent")
async def agent(request: Request, _user=Depends(current_user)):
    return await AGUIAdapter.dispatch_request(request, agent=build_agent())
