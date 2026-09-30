"""Transcript references use exact lead quotes, never generated quotations."""

import re

from app.scoring.schemas import Discovery, Evidence

_INTENT = re.compile(r"sign.?up|signup|register|let'?s start|onboard|start kar|join kar", re.I)
_MATERIAL = re.compile(r"link|brochure|comparison|information|details|bhej", re.I)


def extract_evidence(messages: list[dict[str, str]], discovery: Discovery) -> list[Evidence]:
    evidence: list[Evidence] = []
    for turn, message in enumerate(messages):
        if message["role"] != "user":
            continue
        text = message["text"]
        fields = []
        if _INTENT.search(text):
            fields.append("signup_intent")
        elif _MATERIAL.search(text):
            fields.append("information_request")
        if discovery.estimated_clients is not None and re.search(
            rf"\b{discovery.estimated_clients}\b.*?\b(?:clients?|customers?|contacts?)\b", text, re.I
        ):
            fields.append("estimated_clients")
        if discovery.current_broker and discovery.current_broker.casefold() in text.casefold():
            fields.append("current_broker")
        for field in fields:
            evidence.append(Evidence(field=field, turn=turn, quote=text))
    return evidence
