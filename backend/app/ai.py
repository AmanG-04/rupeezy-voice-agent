"""Supported Gemini client, shared by conversation and classification."""

from functools import lru_cache
import asyncio
import time
from collections import deque

from google import genai

from app.config import get_settings


class DemoBusyError(RuntimeError):
    pass


class QuotaGuard:
    """Single-worker pacing. Provider billing must remain disabled for zero spend."""

    def __init__(self):
        self.requests = deque()
        self.daily = {}
        self.lock = asyncio.Lock()

    async def acquire(self, model: str) -> None:
        settings = get_settings()
        async with self.lock:
            now = time.monotonic()
            day = time.strftime("%Y-%m-%d", time.gmtime())
            count = self.daily.get((day, model), 0)
            limit = settings.gemini_daily_request_limit
            if count >= limit:
                raise DemoBusyError("Local daily API budget reached. Open the sample tour.")
            recent = [stamp for name, stamp in self.requests if name == model and now - stamp < 60]
            if len(recent) >= settings.gemini_rpm_limit:
                raise DemoBusyError("Demo is busy. Wait a minute or open the sample tour.")
            while self.requests and now - self.requests[0][1] >= 60:
                self.requests.popleft()
            self.requests.append((model, now))
            self.daily[(day, model)] = count + 1
            self.daily = {key: value for key, value in self.daily.items() if key[0] == day}


quota_guard = QuotaGuard()


async def generate_stream(*, model: str, contents, config):
    """Retry transient provider overload only before any output is delivered."""
    for attempt in range(3):
        emitted = False
        try:
            await quota_guard.acquire(model)
            stream = await get_client().aio.models.generate_content_stream(
                model=model, contents=contents, config=config,
            )
            async for chunk in stream:
                if getattr(chunk, "text", None):
                    emitted = True
                yield chunk
            return
        except genai.errors.ServerError as error:
            if emitted or error.code not in (500, 502, 503, 504) or attempt == 2:
                raise
            await asyncio.sleep(2 ** (attempt + 1))


async def generate_content(*, model: str, contents, config):
    for attempt in range(3):
        try:
            await quota_guard.acquire(model)
            return await get_client().aio.models.generate_content(
                model=model, contents=contents, config=config,
            )
        except genai.errors.ServerError as error:
            if error.code not in (500, 502, 503, 504) or attempt == 2:
                raise
            await asyncio.sleep(2 ** (attempt + 1))


@lru_cache(maxsize=1)
def get_client() -> genai.Client:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured. Use the sample demo instead.")
    return genai.Client(api_key=settings.gemini_api_key)
