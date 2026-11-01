from fastapi import FastAPI

from app.api.routes import router

app = FastAPI(title="Agentic DeskMate")
app.include_router(router)
