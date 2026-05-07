"""Coverage for _detect_lang_from_text — every script range + every romanised
hint we ship in _ROMAN_LANG_HINTS. If any of these regress, the auto-language
switch (the "Bhalobashi -> Bengali" feature) silently breaks.
"""

from __future__ import annotations

import pytest

from app.agent.conversation import _ROMAN_LANG_HINTS, _detect_lang_from_text


# ---------- Script-range detection ----------
# One sample sentence per Indic script. Includes the §1.2 opener fragments
# we know already exist in the appendix so we cover real-world text.
_SCRIPT_CASES: list[tuple[str, str]] = [
    # Tamil  (U+0B80 - U+0BFF)
    ("வணக்கம், நான் ஏரியா பேசுகிறேன்", "ta-IN"),
    ("தமிழ்", "ta-IN"),
    # Telugu (U+0C00 - U+0C7F)
    ("నమస్కారం, నేను ఆరియా", "te-IN"),
    ("తెలుగు", "te-IN"),
    # Bengali (U+0980 - U+09FF)
    ("নমস্কার, আমি আরিয়া বলছি", "bn-IN"),
    ("বাংলা", "bn-IN"),
    # Gujarati (U+0A80 - U+0AFF)
    ("નમસ્તે, હું આરિયા છું", "gu-IN"),
    ("ગુજરાતી", "gu-IN"),
    # Devanagari -> Hindi (default)
    ("नमस्ते, मैं आरिया हूँ", "hi-IN"),
    ("हिंदी", "hi-IN"),
    # Devanagari -> Marathi (characteristic vocabulary)
    ("नमस्कार, मी आरिया बोलत आहे", "mr-IN"),
    ("तुम्ही काय करता", "mr-IN"),
]


@pytest.mark.parametrize("text,expected", _SCRIPT_CASES)
def test_script_range_detection(text: str, expected: str) -> None:
    assert _detect_lang_from_text(text) == expected, (
        f"text={text!r} -> got {_detect_lang_from_text(text)!r}, expected {expected!r}"
    )


# ---------- Romanised hint detection ----------
# Cover every word in the _ROMAN_LANG_HINTS dict so adding a new word
# without a matching test row triggers a flake.
@pytest.mark.parametrize("token,expected", list(_ROMAN_LANG_HINTS.items()))
def test_romanised_hint_in_isolation(token: str, expected: str) -> None:
    assert _detect_lang_from_text(token) == expected
    # Also case-insensitive
    assert _detect_lang_from_text(token.upper()) == expected
    assert _detect_lang_from_text(token.capitalize()) == expected


def test_romanised_hint_inside_sentence() -> None:
    """Hint words mid-sentence still detected."""
    cases: list[tuple[str, str]] = [
        ("hello bhalobashi friend", "bn-IN"),
        ("Vanakkam everyone, namma broker is good", "ta-IN"),
        ("kem chho today?", "gu-IN"),
        ("kasa ahat sir", "mr-IN"),
        ("ela meeru", "te-IN"),
    ]
    for text, expected in cases:
        assert _detect_lang_from_text(text) == expected, f"{text!r}"


# ---------- Negative cases ----------
@pytest.mark.parametrize(
    "text",
    [
        "",
        "Hi",
        "Hello there, this is a long English sentence with no regional words.",
        "I am interested in your partner program",
        "12345",
        "   ",
    ],
)
def test_no_detection_for_pure_english(text: str) -> None:
    assert _detect_lang_from_text(text) is None


# ---------- Tie-breaker: script wins over romanised ----------
def test_script_beats_romanised() -> None:
    """If a Tamil script char appears alongside a romanised Bengali hint,
    the script range wins because it's the stronger signal."""
    text = "vanakkam வணக்கம் bhalobashi"
    # Iterate in order: 'v' is Latin (no detect yet), then Tamil chars hit
    # the script branch which returns immediately.
    assert _detect_lang_from_text(text) == "ta-IN"


# ---------- Marathi vs Hindi disambiguation ----------
def test_marathi_specific_words_in_devanagari() -> None:
    # "नमस्कार" alone in Devanagari without Marathi-specific words
    # should still default to Hindi (it's a common Hindi greeting too).
    assert _detect_lang_from_text("नमस्कार") == "hi-IN"
    # But "नमस्कार" + Marathi-specific vocab -> Marathi
    assert _detect_lang_from_text("नमस्कार, तुम्ही कसे आहात?") == "mr-IN"
