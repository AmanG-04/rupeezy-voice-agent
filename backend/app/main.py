"""FastAPI entrypoint.

Phase 0 surface area:
  - GET /                health/landing
  - GET /health          liveness probe
  - GET /api/version     build info

Subsequent phases register their own routers under /api/*.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.agent.routes import router as agent_router
from app.config import get_settings
from app.dashboard.routes import router as dashboard_router
from app.tts.edge_tts_route import router as tts_router

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.backend_log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("rupeezy")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    log.info("Rupeezy backend starting — version %s", __version__)
    if not settings.gemini_api_key:
        log.warning("GEMINI_API_KEY is not set. RAG and chat will fail until configured.")
    # Create persistence tables if they don't exist.
    from app.db.repo import init_db

    init_db()
    log.info("DB initialised at %s", settings.database_url)
    yield


app = FastAPI(
    title="Rupeezy AI Voice Agent",
    version=__version__,
    description="Backend for the Rupeezy partner-program voice agent.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    return {
        "service": "rupeezy-voice-agent",
        "version": __version__,
        "status": "ok",
    }


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/version", tags=["meta"])
async def version() -> dict[str, str]:
    return {
        "version": __version__,
        "chat_model": settings.gemini_chat_model,
        "reasoning_model": settings.gemini_reasoning_model,
        "embedding_model": settings.gemini_embedding_model,
        # Hard-coded — TTS is wired to Microsoft Edge's free public neural
        # endpoint via the edge-tts package. See app.tts.edge_tts_route.
        "tts_engine": "edge-tts (neural)",
    }


app.include_router(agent_router)
app.include_router(dashboard_router)
app.include_router(tts_router)



