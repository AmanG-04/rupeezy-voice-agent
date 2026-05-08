"""Gemini TTS — text -> WAV bytes via gemini-2.5-flash-preview-tts.

Returns a self-contained WAV (with 44-byte RIFF header) so the browser can
play it directly via the Audio API without any external decoder.

Voice catalog: Aoede (warm), Kore (firm), Puck (energetic), Charon (deep), etc.
We default to Aoede — breezy, warm, upbeat — best fit for a friendly partner-
program sales call.
"""

from __future__ import annotations

import io
import logging
import struct
import time
from functools import lru_cache

from google import genai
from google.genai import types

from app.config import get_settings

log = logging.getLogger("rupeezy.tts")

# 24kHz mono 16-bit PCM is what gemini-2.5-flash-preview-tts returns.
SAMPLE_RATE = 24_000
CHANNELS = 1
SAMPLE_WIDTH_BYTES = 2  # 16-bit

DEFAULT_VOICE = "Aoede"


@lru_cache(maxsize=1)
def _client() -> genai.Client:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not set; cannot call TTS.")
    return genai.Client(api_key=settings.gemini_api_key)


def _wav_header(num_bytes: int) -> bytes:
    """Build a standard 44-byte RIFF/WAVE header for 16-bit PCM."""
    byte_rate = SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH_BYTES
    block_align = CHANNELS * SAMPLE_WIDTH_BYTES
    bits_per_sample = SAMPLE_WIDTH_BYTES * 8
    data_size = num_bytes
    file_size = 36 + data_size

    return (
        b"RIFF"
        + struct.pack("<I", file_size)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<I", 16)              # PCM fmt chunk size
        + struct.pack("<H", 1)               # PCM format
        + struct.pack("<H", CHANNELS)
        + struct.pack("<I", SAMPLE_RATE)
        + struct.pack("<I", byte_rate)
        + struct.pack("<H", block_align)
        + struct.pack("<H", bits_per_sample)
        + b"data"
        + struct.pack("<I", data_size)
    )


async def synthesize(
    text: str,
    *,
    voice: str = DEFAULT_VOICE,
    style_prompt: str | None = None,
) -> bytes:
    """Synthesize `text` to a WAV-wrapped audio blob.

    `style_prompt` is prepended to the text in the form the TTS model expects:
        "Say in a warm, salesy tone: <text>"
    Per Google's docs, you can shape delivery this way without a full
    multi-speaker setup. We default to a salesy/friendly direction.
    """
    if not text.strip():
        return b""

    if style_prompt:
        contents = [f"{style_prompt}: {text}"]
    else:
        contents = [text]

    settings = get_settings()
    model_name = "gemini-2.5-flash-preview-tts"
    started = time.perf_counter()

    try:
        resp = await _client().aio.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
                    )
                ),
            ),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("TTS call failed: %s", e)
        raise

    if not resp.candidates or not resp.candidates[0].content.parts:
        log.warning("TTS returned no audio parts")
        return b""

    pcm = resp.candidates[0].content.parts[0].inline_data.data
    if not pcm:
        return b""

    # Wrap in WAV header so browser <audio> / Web Audio API can decode.
    out = io.BytesIO()
    out.write(_wav_header(len(pcm)))
    out.write(pcm)
    wav = out.getvalue()
    log.info(
        "latency | stage=gemini_tts model=%s voice=%s text_chars=%d wav_bytes=%d elapsed_ms=%.1f",
        model_name, voice, len(text), len(wav),
        (time.perf_counter() - started) * 1000,
    )
    _ = settings  # kept loaded for side effects
    return wav
