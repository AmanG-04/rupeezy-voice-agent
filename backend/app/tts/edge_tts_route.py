"""Edge-TTS route — Microsoft Edge's free neural TTS endpoint.

This gives every visitor (judges included) Microsoft's neural voices —
"Aria Online (Natural)", "Neerja Online (Natural)", etc. — without any
API key or quota. The frontend POSTs a sentence + language and we stream
back MP3 bytes, which the browser plays via an <audio> element / AudioContext.

Why this exists:
  Web Speech API's SpeechSynthesis falls back to whatever voices the user's
  OS has installed. On a vanilla Windows / Chrome combo that's "Google UK
  English Female" (sounds robotic) and no Hindi voice at all (Devanagari
  text is read by an English voice → unintelligible). edge-tts ships
  identical neural quality to anyone who can reach the public Edge endpoint.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

import edge_tts
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

log = logging.getLogger("rupeezy.tts.edge")

router = APIRouter(prefix="/api/tts", tags=["tts"])


# Map our language codes (en-IN, hi-IN, ta-IN, ...) to the closest
# Edge-TTS neural voice. Female voices throughout — Aria's persona.
# Voice list reference: edge-tts --list-voices
_VOICE_BY_LANG: dict[str, str] = {
    "en-IN": "en-IN-NeerjaNeural",      # Indian-English, female, warm
    "en-US": "en-US-AriaNeural",        # the original "Aria"
    "en-GB": "en-GB-SoniaNeural",
    "hi-IN": "hi-IN-SwaraNeural",       # Hindi female, very natural
    "ta-IN": "ta-IN-PallaviNeural",
    "te-IN": "te-IN-ShrutiNeural",
    "mr-IN": "mr-IN-AarohiNeural",
    "gu-IN": "gu-IN-DhwaniNeural",
    "bn-IN": "bn-IN-TanishaaNeural",
    "kn-IN": "kn-IN-SapnaNeural",
    "ml-IN": "ml-IN-SobhanaNeural",
}

_DEFAULT_VOICE = "en-IN-NeerjaNeural"


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    lang: str = Field(default="en-IN")
    # Edge-TTS prosody knobs. Strings like "+10%", "-5%", "0%".
    rate: str = Field(default="+0%")
    pitch: str = Field(default="+0Hz")


def _voice_for(lang: str) -> str:
    if lang in _VOICE_BY_LANG:
        return _VOICE_BY_LANG[lang]
    # Fall back on language-family match (e.g. en-AU -> en-IN-Neerja)
    prefix = lang.split("-")[0]
    for code, voice in _VOICE_BY_LANG.items():
        if code.startswith(f"{prefix}-"):
            return voice
    return _DEFAULT_VOICE


async def _stream_mp3(text: str, voice: str, rate: str, pitch: str) -> AsyncIterator[bytes]:
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            yield chunk["data"]


@router.post("/synthesize")
async def synthesize(req: SynthesizeRequest) -> StreamingResponse:
    """Synthesize a sentence and stream the MP3 bytes back as audio/mpeg.

    The frontend can either:
      - feed the response into an <audio> element (set src to a Blob URL), or
      - decode each chunk and play via AudioContext for tighter latency.
    """
    voice = _voice_for(req.lang)
    log.info("tts: %d chars, lang=%s -> voice=%s", len(req.text), req.lang, voice)

    try:
        # Validate by running one round-trip; we drain into a buffer so any
        # network error surfaces as a 502 rather than mid-stream truncation.
        buffer = bytearray()
        async for piece in _stream_mp3(req.text, voice, req.rate, req.pitch):
            buffer.extend(piece)
        if not buffer:
            raise RuntimeError("edge-tts returned no audio bytes")
    except Exception as e:  # noqa: BLE001
        log.exception("edge-tts synth failed")
        raise HTTPException(status_code=502, detail=f"tts upstream error: {e}") from e

    async def _emit() -> AsyncIterator[bytes]:
        # Yield in 4KB frames so the browser can start playback immediately.
        view = memoryview(bytes(buffer))
        for i in range(0, len(view), 4096):
            yield bytes(view[i : i + 4096])
            # Yield to the loop so streaming feels real to the client.
            await asyncio.sleep(0)

    return StreamingResponse(
        _emit(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-store",
            "X-TTS-Voice": voice,
        },
    )


@router.get("/voices")
async def voices() -> dict:
    """List the language → voice map so the frontend can show what's
    available without poking edge-tts directly."""
    return {"voices": _VOICE_BY_LANG, "default": _DEFAULT_VOICE}
