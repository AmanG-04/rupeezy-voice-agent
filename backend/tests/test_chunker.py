"""Chunker unit tests — no external services required."""

from pathlib import Path

from app.rag.chunker import chunk_markdown

REPO_ROOT = Path(__file__).resolve().parents[2]
APPENDIX = REPO_ROOT / "APPENDIX_A.md"


def test_chunks_appendix() -> None:
    md = APPENDIX.read_text(encoding="utf-8")
    chunks = chunk_markdown(md)
    # We expect at least the 14 H2s (preamble, 0..13). After H3 splits in §4
    # (intro + 6) and §10 (10 cases), we should land at ~31.
    assert len(chunks) >= 25, f"too few chunks: {len(chunks)}"

    sections = [c.section for c in chunks]
    # Spot-check that every objection landed as its own chunk.
    for obj in ("4.1", "4.2", "4.3", "4.4", "4.5", "4.6"):
        assert obj in sections, f"missing objection chunk §{obj}"
    # And every named edge case.
    for ec in ("10.1", "10.2", "10.5", "10.8", "10.10"):
        assert ec in sections, f"missing edge case §{ec}"


def test_chunk_ids_are_stable() -> None:
    md = APPENDIX.read_text(encoding="utf-8")
    a = chunk_markdown(md)
    b = chunk_markdown(md)
    ids_a = [c.chunk_id for c in a]
    ids_b = [c.chunk_id for c in b]
    assert ids_a == ids_b, "chunk_id should be deterministic for same input"


def test_no_chunk_too_large() -> None:
    """No chunk should exceed ~6.5k chars (else split-on-H3 should have fired)."""
    md = APPENDIX.read_text(encoding="utf-8")
    chunks = chunk_markdown(md)
    too_big = [(c.section, c.char_count) for c in chunks if c.char_count > 6500]
    assert not too_big, f"oversize chunks found: {too_big}"


def test_preamble_kept() -> None:
    md = APPENDIX.read_text(encoding="utf-8")
    chunks = chunk_markdown(md)
    preamble = next((c for c in chunks if c.heading == "_preamble"), None)
    assert preamble is not None, "preamble chunk missing"
    assert "canonical knowledge base" in preamble.text.lower()


def test_h3_chunks_carry_parent_heading() -> None:
    """An H3-split chunk should include its parent H2 heading at the top."""
    md = APPENDIX.read_text(encoding="utf-8")
    chunks = chunk_markdown(md)
    by_section = {c.section: c for c in chunks}
    obj_41 = by_section["4.1"]
    assert "## 4. The Five Core Objections" in obj_41.text, (
        "H3 chunk should be prefixed with parent H2 heading for context"
    )
