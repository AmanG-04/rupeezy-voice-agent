"""Centralised settings, loaded from environment via pydantic-settings.

Load order:
  1. Environment variables
  2. backend/.env  (project-local override)
  3. ../.env       (repo-root .env, useful when running from scripts/)
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Gemini ---
    # gemini_chat_model is the *primary* model. If the request 429s
    # (rate-limit / daily-quota exhausted), the engine walks down
    # gemini_chat_model_fallbacks (comma-separated) in order. This means
    # the demo never goes dark mid-call when a single model's free-tier
    # quota is hit — we just transparently switch to the next model.
    #
    # Default chain (May 2026):
    #   1. gemini-3.1-flash-lite-preview  — newest, ~500/day free quota
    #   2. gemini-3-flash-preview         — broader feature set, separate quota pool
    #   3. gemini-2.5-flash-lite          — last-resort, smallest free quota
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_chat_model: str = Field(
        default="gemini-3.1-flash-lite-preview", alias="GEMINI_CHAT_MODEL"
    )
    gemini_chat_model_fallbacks: str = Field(
        default="gemini-3-flash-preview,gemini-2.5-flash-lite",
        alias="GEMINI_CHAT_MODEL_FALLBACKS",
    )
    gemini_reasoning_model: str = Field(
        default="gemini-3.1-flash-lite-preview", alias="GEMINI_REASONING_MODEL"
    )
    gemini_embedding_model: str = Field(
        default="gemini-embedding-2", alias="GEMINI_EMBEDDING_MODEL"
    )

    # --- Backend runtime ---
    backend_host: str = Field(default="0.0.0.0", alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")
    backend_log_level: str = Field(default="INFO", alias="BACKEND_LOG_LEVEL")
    backend_cors_origins: str = Field(
        default="http://localhost:5173", alias="BACKEND_CORS_ORIGINS"
    )

    # --- Storage ---
    database_url: str = Field(
        default="sqlite:///./backend/data/rupeezy.db", alias="DATABASE_URL"
    )

    # --- WhatsApp (mocked — Cloud API wiring stubbed but not invoked) ---
    whatsapp_mode: str = Field(default="mock", alias="WHATSAPP_MODE")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.backend_cors_origins.split(",") if o.strip()]

    @property
    def chat_model_chain(self) -> list[str]:
        """Primary model first, then each fallback in order. Empty entries
        and duplicates are dropped."""
        chain: list[str] = []
        seen: set[str] = set()
        for candidate in [self.gemini_chat_model, *self.gemini_chat_model_fallbacks.split(",")]:
            name = candidate.strip()
            if name and name not in seen:
                chain.append(name)
                seen.add(name)
        return chain


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
