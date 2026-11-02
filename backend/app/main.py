from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.conversations import router as conversations_router
from app.api.links import router as links_router
from app.api.providers import router as providers_router
from app.api.routes import router

app = FastAPI(title="Agentic DeskMate")
app.include_router(router)
app.include_router(auth_router)
app.include_router(conversations_router)
app.include_router(providers_router)
app.include_router(links_router)
