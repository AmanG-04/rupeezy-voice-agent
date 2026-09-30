"""Explicit opt-outs are independent of model-generated summaries."""

import re

_PATTERN = re.compile(
    r"\b(remove (?:my number|me)|stop (?:calling|contacting|messaging)|"
    r"do not (?:call|contact|message)|don't (?:call|contact|message)|"
    r"unsubscribe|dobara (?:call|phone) mat|call mat (?:karo|karna)|"
    r"number (?:hata|delete))\b|मेरा नंबर हट|फोन मत|कॉल मत",
    re.IGNORECASE,
)


def is_opt_out(text: str) -> bool:
    return bool(_PATTERN.search(text))
