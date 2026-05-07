"""Routing matrix: for every (picker_lang, user_utterance) pair, what's
the language we tell Gemini to reply in?

The contract:
  detected = _detect_lang_from_text(user_utterance)
  effective_lang = detected if detected else picker_lang

This test enumerates the full picker × utterance space so any future
edit to the resolution rule has to consciously update the table — no
silent regressions.
"""

from __future__ import annotations

import pytest

from app.agent.conversation import _LANG_LABELS, _detect_lang_from_text


# 8 picker values we expose in the frontend voice picker.
PICKERS: list[str] = [
    "en-IN", "en-US", "hi-IN", "ta-IN", "te-IN", "mr-IN", "gu-IN", "bn-IN",
]

# Utterance per language. Each one's detection result is fixed by the
# detector's logic — these are the "ground truth" inputs.
UTTERANCES: list[tuple[str, str | None]] = [
    # (text, expected_detection_or_None)
    ("Hello, I am interested",                None),     # pure English
    ("Hi",                                    None),     # too-short English
    ("Bhalobashi",                            "bn-IN"),  # romanised Bengali
    ("Vanakkam sir",                          "ta-IN"),  # romanised Tamil
    ("Kem chho",                              "gu-IN"),  # romanised Gujarati
    ("kasa ahat",                             "mr-IN"),  # romanised Marathi
    ("ela meeru",                             "te-IN"),  # romanised Telugu
    ("नमस्ते",                                  "hi-IN"),  # Devanagari Hindi
    ("नमस्कार, मी आरिया बोलत आहे",                "mr-IN"),  # Devanagari Marathi
    ("வணக்கம்",                                 "ta-IN"),  # Tamil script
    ("నమస్కారం",                                "te-IN"),  # Telugu script
    ("নমস্কার",                                "bn-IN"),  # Bengali script
    ("નમસ્તે",                                  "gu-IN"),  # Gujarati script
]


def _resolve(picker: str, utterance: str) -> str | None:
    """Mirror conversation.stream_user_turn()'s resolution rule. Detected
    language wins; falls back to picker."""
    detected = _detect_lang_from_text(utterance)
    return detected or picker


@pytest.mark.parametrize("picker", PICKERS)
@pytest.mark.parametrize("utterance,expected_detect", UTTERANCES)
def test_resolution_matrix(picker: str, utterance: str, expected_detect: str | None) -> None:
    """For every (picker, utterance) the resolved lang is:
       - the DETECTED lang when one is detected (regardless of picker)
       - the PICKER lang when no detection
    Matches the contract documented in stream_user_turn().
    """
    resolved = _resolve(picker, utterance)
    if expected_detect is not None:
        assert resolved == expected_detect, (
            f"picker={picker} utterance={utterance!r} resolved to "
            f"{resolved!r}, expected detection {expected_detect!r}"
        )
    else:
        assert resolved == picker, (
            f"picker={picker} utterance={utterance!r} resolved to "
            f"{resolved!r}, expected picker fallback {picker!r}"
        )


# ---------- Persona-prompt label mapping ----------
# Every BCP-47 code we expect resolution to produce must have a
# human-readable label so the prompt's THIS-TURN-LANGUAGE-OVERRIDE
# block doesn't crash for a missing key.
@pytest.mark.parametrize("picker", PICKERS)
def test_every_picker_has_label(picker: str) -> None:
    assert _LANG_LABELS.get(picker.lower()) is not None, (
        f"missing label for picker {picker!r}"
    )


@pytest.mark.parametrize("expected_detect", sorted({d for _, d in UTTERANCES if d}))
def test_every_detected_lang_has_label(expected_detect: str) -> None:
    assert _LANG_LABELS.get(expected_detect.lower()) is not None, (
        f"missing label for detection {expected_detect!r}"
    )


# ---------- Round-trip with the persona override ----------
def test_picker_to_resolved_combinations_count() -> None:
    """Sanity: 8 picker × 13 utterance = 104 cells in the matrix.
    If anyone shrinks this, they should know."""
    assert len(PICKERS) == 8
    assert len(UTTERANCES) == 13
    assert len(PICKERS) * len(UTTERANCES) == 104


# ---------- Mid-call switch scenarios ----------
def test_user_switches_from_english_to_bengali() -> None:
    """Picker says English, user types one Bengali word -> resolution
    flips to Bengali. The frontend uses this to update the picker for
    subsequent turns."""
    resolved = _resolve("en-IN", "Bhalobashi")
    assert resolved == "bn-IN"


def test_user_switches_back_to_english() -> None:
    """Picker is now Bengali (after the previous switch). User types
    pure English -> no detection -> falls back to picker (Bengali).

    NOTE: this is intentional — the agent stays in the most recent
    confirmed language. The user has to type something in English,
    Hindi, or click the picker to leave Bengali. A single English
    sentence after they've been speaking Bengali doesn't necessarily
    mean a switch (could be a brand name)."""
    resolved = _resolve("bn-IN", "Tell me more about the program")
    assert resolved == "bn-IN"


def test_user_switches_from_bengali_to_tamil_via_script() -> None:
    """Native Tamil script is unambiguous -> immediate switch."""
    resolved = _resolve("bn-IN", "வணக்கம், எனக்கு மேலும் சொல்லுங்கள்")
    assert resolved == "ta-IN"
