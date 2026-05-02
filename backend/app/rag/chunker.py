"""Markdown chunker — splits Appendix A by H2 (`##`) headings.

Why H2: each rebuttal, hard-fact table, edge-case, and CTA template lives under its
own H2 in APPENDIX_A.md. Splitting any finer breaks the rebuttal mid-thought; any
coarser and the LLM gets the wrong section retrieved.

Special handling:
  - The intro paragraph (everything before the first H2) is preserved as a
    standalone "_preamble" chunk so retrieval over "what is this document" works.
  - H3 (`###`) subsections inside a single H2 stay together (e.g., the three
    variants of an objection rebuttal are one chunk, retrieved together).
  - YAML frontmatter (if any) is stripped.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass


@dataclass(slots=True)
class Chunk:
    """One retrievable section of Appendix A."""

    chunk_id: str        # stable hash of section path + text — survives re-runs
    section: str         # e.g. "4.1", "3", "10.8". Empty for preamble.
    heading: str         # the full H2 heading text without leading hashes
    text: str            # the chunk body (heading included for context in prompt)
    char_count: int      # length of text — used for budgeting prompt tokens


_H2 = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
_H3 = re.compile(r"^###\s+(.+?)\s*$", re.MULTILINE)
_SECTION_NUM = re.compile(r"^(\d+(?:\.\d+)*)\b")
_FRONTMATTER = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)

# Sections that get further split on H3, because their H3 subsections are each
# a self-contained retrieval target (e.g., one objection rebuttal).
# Exact match on the H2 section number.
_SPLIT_H3_SECTIONS = {"4", "10"}
# Soft limit — anything bigger than this we try to split on H3 even if not in
# the explicit list above. Keeps any future giant sections searchable.
_H3_SPLIT_THRESHOLD_CHARS = 6000


def _hash_id(section: str, text: str) -> str:
    h = hashlib.sha256()
    h.update(section.encode("utf-8"))
    h.update(b"\x00")
    h.update(text.encode("utf-8"))
    return h.hexdigest()[:16]


def _extract_section_number(heading: str) -> str:
    """`'4.1 Objection: "I'm already with another broker"'` → `'4.1'`. Empty if none."""
    m = _SECTION_NUM.match(heading.strip())
    return m.group(1) if m else ""


def _should_split_on_h3(section: str, char_count: int) -> bool:
    """Decide whether an H2 section gets further split into H3 chunks."""
    if section in _SPLIT_H3_SECTIONS:
        return True
    return char_count > _H3_SPLIT_THRESHOLD_CHARS


def _split_h3(parent_section: str, parent_heading: str, body: str) -> list[Chunk]:
    """Split an H2 body into H3-keyed chunks, prefixing each with the parent
    heading so the LLM still has top-of-section context when only one H3 is
    retrieved. The H2 intro (text before the first H3) becomes its own chunk
    if non-trivial."""
    h3_matches = list(_H3.finditer(body))
    chunks: list[Chunk] = []

    # Strip the H2 heading line itself, keep what follows.
    after_h2 = body.split("\n", 1)[1] if "\n" in body else ""

    if not h3_matches:
        return [
            Chunk(
                chunk_id=_hash_id(parent_section, body),
                section=parent_section,
                heading=parent_heading,
                text=body,
                char_count=len(body),
            )
        ]

    # H2 → first H3: intro paragraph (kept if non-trivial).
    first_h3_in_after = _H3.search(after_h2)
    if first_h3_in_after:
        intro = after_h2[: first_h3_in_after.start()].strip()
        if len(intro) > 200:
            intro_text = f"## {parent_heading}\n\n{intro}"
            chunks.append(
                Chunk(
                    chunk_id=_hash_id(f"{parent_section}#intro", intro_text),
                    section=parent_section,
                    heading=f"{parent_heading} — intro",
                    text=intro_text,
                    char_count=len(intro_text),
                )
            )

    for i, m in enumerate(h3_matches):
        sub_heading = m.group(1).strip()
        sub_section = _extract_section_number(sub_heading) or parent_section
        sub_start = m.start()
        sub_end = h3_matches[i + 1].start() if i + 1 < len(h3_matches) else len(body)
        sub_body = body[sub_start:sub_end].strip()
        if not sub_body:
            continue
        # Prefix with parent heading so retrieved chunk carries context.
        full_text = f"## {parent_heading}\n\n{sub_body}"
        chunks.append(
            Chunk(
                chunk_id=_hash_id(sub_section, full_text),
                section=sub_section,
                heading=sub_heading,
                text=full_text,
                char_count=len(full_text),
            )
        )

    return chunks


def chunk_markdown(md: str) -> list[Chunk]:
    """Split a markdown document by H2 sections.

    Returns chunks in document order. The preamble (text before the first H2)
    becomes a chunk with section="" and heading="_preamble".
    """
    md = _FRONTMATTER.sub("", md, count=1).strip()

    # Find all H2 boundaries: list of (start_index, heading_text).
    matches = list(_H2.finditer(md))
    chunks: list[Chunk] = []

    # Preamble: everything before the first H2.
    if matches:
        preamble = md[: matches[0].start()].strip()
    else:
        preamble = md.strip()
    if preamble:
        chunks.append(
            Chunk(
                chunk_id=_hash_id("", preamble),
                section="",
                heading="_preamble",
                text=preamble,
                char_count=len(preamble),
            )
        )

    # Body: each H2 → next H2 (or EOF).
    for i, m in enumerate(matches):
        heading_text = m.group(1).strip()
        body_start = m.start()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(md)
        body = md[body_start:body_end].strip()
        if not body:
            continue
        section = _extract_section_number(heading_text)

        if _should_split_on_h3(section, len(body)):
            chunks.extend(_split_h3(section, heading_text, body))
        else:
            chunks.append(
                Chunk(
                    chunk_id=_hash_id(section or heading_text, body),
                    section=section,
                    heading=heading_text,
                    text=body,
                    char_count=len(body),
                )
            )

    return chunks
