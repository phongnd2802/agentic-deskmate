from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.routes import router

app = FastAPI(title="Agentic DeskMate")
app.include_router(router)
app.include_router(auth_router)
