"""TTS coverage smoke test — every supported language returns real audio.

Why this exists: we hit a regression where Tamil produced text but no audio
because a single transient Edge-TTS failure latched the frontend into a
session-level "fall back to browser TTS" mode. The frontend fix is
elsewhere; this test guards the *backend* contract — that calling
/api/tts/synthesize for any of the 8 supported languages returns audio
bytes (not an empty body, not an HTTP error).

Network is hit live; this means the test goes red if Microsoft's public
edge-tts endpoint is down or if our server-side voice map drops a row.
That's the right behaviour for a pre-demo smoke check.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


# (lang_code, sample sentence in that language)
_LANG_SAMPLES: list[tuple[str, str]] = [
    ("en-IN", "Hi there, this is Aria from Rupeezy."),
    ("en-US", "Hi there, this is Aria from Rupeezy."),
    ("hi-IN", "Namaste, main Aria bol rahi hoon."),
    ("ta-IN", "வணக்கம், நான் ஏரியா பேசுகிறேன்."),
    ("te-IN", "నమస్కారం, నేను ఆరియా."),
    ("mr-IN", "नमस्कार, मी आरिया बोलत आहे."),
    ("gu-IN", "નમસ્તે, હું આરિયા છું."),
    ("bn-IN", "নমস্কার, আমি আরিয়া বলছি।"),
]


@pytest.mark.parametrize("lang,text", _LANG_SAMPLES)
def test_tts_synthesizes_audio(lang: str, text: str) -> None:
    """Each lang must return >= 1KB of MP3 bytes and the X-TTS-Voice header
    must name a Neural voice (the whole point of using edge-tts)."""
    r = client.post(
        "/api/tts/synthesize",
        json={"text": text, "lang": lang},
    )
    assert r.status_code == 200, f"{lang} returned {r.status_code}: {r.text[:200]}"
    assert r.headers.get("content-type") == "audio/mpeg"

    body = r.content
    assert len(body) >= 1024, f"{lang} returned suspiciously small audio: {len(body)} bytes"

    voice = r.headers.get("X-TTS-Voice", "")
    assert "Neural" in voice, f"{lang} picked non-Neural voice: {voice!r}"


def test_tts_unknown_lang_falls_back_to_default() -> None:
    """A made-up lang should still return audio (server picks the default
    en-IN-NeerjaNeural voice instead of erroring). Otherwise the frontend
    breaks on any future picker addition."""
    r = client.post(
        "/api/tts/synthesize",
        json={"text": "Hello.", "lang": "xx-XX"},
    )
    assert r.status_code == 200, f"unknown lang returned {r.status_code}"
    assert len(r.content) >= 1024


def test_tts_voices_endpoint_lists_neural_voices() -> None:
    """The /api/tts/voices map must contain a row for every language the
    frontend picker exposes. If a future PR adds a picker option without
    a voice mapping, this catches it."""
    r = client.get("/api/tts/voices")
    assert r.status_code == 200
    body = r.json()
    voices = body["voices"]
    required = ["en-IN", "hi-IN", "ta-IN", "te-IN", "mr-IN", "gu-IN", "bn-IN"]
    for code in required:
        assert code in voices, f"missing voice mapping for {code}"
        assert "Neural" in voices[code], f"{code} mapped to non-Neural: {voices[code]!r}"
