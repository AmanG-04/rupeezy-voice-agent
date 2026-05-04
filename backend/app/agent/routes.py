"""HTTP routes for the conversation engine.

Phase 2 surface:
  POST /api/conversations            -> create a new conversation
  GET  /api/conversations/{id}       -> read transcript + status
  POST /api/conversations/{id}/turn  -> SSE stream of agent reply tokens
  POST /api/conversations/{id}/end   -> mark conversation ended
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.agent.conversation import (
    Conversation,
    get_store,
    stream_user_turn,
)
from app.scoring.handoff import build_handoff
from app.scoring.schemas import HandoffRecord

# Per-process cache of handoff records, keyed by conv_id. Phase 4 moves this
# to Supabase. Phase 3 keeps it in-memory so the dashboard mock works.
_handoff_cache: dict[str, HandoffRecord] = {}

log = logging.getLogger("rupeezy.agent.routes")

router = APIRouter(prefix="/api/conversations", tags=["agent"])


# ---------- DTOs ----------


class CreateConversationResponse(BaseModel):
    conv_id: str
    started_at: str


class TurnRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class EndRequest(BaseModel):
    ended_by: str = Field(default="agent", pattern="^(agent|lead|dropped)$")


class MessageDTO(BaseModel):
    role: str
    text: str
    created_at: str


class ConversationDTO(BaseModel):
    conv_id: str
    started_at: str
    ended_at: str | None
    ended_by: str | None
    language: str
    messages: list[MessageDTO]


def _to_dto(conv: Conversation) -> ConversationDTO:
    return ConversationDTO(
        conv_id=conv.conv_id,
        started_at=conv.started_at,
        ended_at=conv.ended_at,
        ended_by=conv.ended_by,
        language=conv.language,
        messages=[MessageDTO(role=m.role, text=m.text, created_at=m.created_at) for m in conv.messages],
    )


def _row_to_dto(row) -> ConversationDTO:  # type: ignore[no-untyped-def]
    """Convert a SQLAlchemy ConversationRow to the wire DTO."""
    return ConversationDTO(
        conv_id=row.id,
        started_at=row.started_at.isoformat() if row.started_at else "",
        ended_at=row.ended_at.isoformat() if row.ended_at else None,
        ended_by=row.ended_by,
        language=row.language_used,
        messages=[
            MessageDTO(
                role=m.role,
                text=m.text,
                created_at=m.created_at.isoformat() if m.created_at else "",
            )
            for m in row.messages
        ],
    )


# ---------- routes ----------


@router.post("", response_model=CreateConversationResponse)
async def create_conversation() -> CreateConversationResponse:
    conv = get_store().create()
    log.info("created conversation %s", conv.conv_id)
    return CreateConversationResponse(conv_id=conv.conv_id, started_at=conv.started_at)


@router.get("", response_model=list[ConversationDTO])
async def list_conversations(bucket: str | None = None, limit: int = 200) -> list[ConversationDTO]:
    """Persistent list — survives restarts. Optional bucket filter joins on handoff."""
    from app.db.repo import list_conversation_rows

    rows = list_conversation_rows(bucket=bucket, limit=limit)
    return [_row_to_dto(r) for r in rows]


@router.get("/{conv_id}", response_model=ConversationDTO)
async def get_conversation(conv_id: str) -> ConversationDTO:
    # Hot path: in-memory store (current process).
    conv = get_store().get(conv_id)
    if conv is not None:
        return _to_dto(conv)
    # Cold path: rehydrate from DB.
    from app.db.repo import get_conversation_row

    row = get_conversation_row(conv_id)
    if row is None:
        raise HTTPException(404, f"conversation {conv_id} not found")
    return _row_to_dto(row)


@router.post("/{conv_id}/turn")
async def turn(conv_id: str, body: TurnRequest):
    """SSE stream of agent reply tokens.

    Frontend connects via EventSource; consumes events of type 'token' and 'done'.
    """
    conv = get_store().get(conv_id)
    if conv is None:
        raise HTTPException(404, f"conversation {conv_id} not found")
    if conv.ended_at:
        raise HTTPException(409, f"conversation {conv_id} already ended")

    user_text = body.text.strip()
    if not user_text:
        raise HTTPException(400, "empty text")

    async def gen() -> AsyncIterator[dict[str, str]]:
        try:
            async for chunk in stream_user_turn(conv_id, user_text):
                # Each event is JSON-encoded so newlines / quotes don't break SSE framing.
                yield {"event": "token", "data": json.dumps({"text": chunk})}
        except ValueError as e:
            yield {"event": "error", "data": json.dumps({"message": str(e)})}
            return
        except Exception as e:  # noqa: BLE001
            log.exception("turn failed")
            yield {"event": "error", "data": json.dumps({"message": f"agent error: {e}"})}
            return
        yield {"event": "done", "data": "{}"}

    return EventSourceResponse(gen())


class EndConversationResponse(BaseModel):
    conversation: ConversationDTO
    handoff: HandoffRecord | None = None
    handoff_error: str | None = None


@router.post("/{conv_id}/end", response_model=EndConversationResponse)
async def end_conversation(conv_id: str, body: EndRequest) -> EndConversationResponse:
    """End the conversation AND run the post-call pipeline.

    The pipeline is best-effort — if scoring fails (rate limit, model error),
    the conversation still ends cleanly and the handoff_error field surfaces
    the reason. Frontend should render the handoff if present, fallback to
    a "scoring pending" state if not.
    """
    conv = get_store().end(conv_id, ended_by=body.ended_by)
    if conv is None:
        raise HTTPException(404, f"conversation {conv_id} not found")

    # Always persist the (now-ended) conversation, even if scoring fails below.
    try:
        from app.db.repo import persist_conversation

        persist_conversation(conv, channel="text")
    except Exception:  # noqa: BLE001
        log.exception("failed to persist conversation %s on /end", conv_id)

    handoff: HandoffRecord | None = None
    handoff_error: str | None = None
    if conv.messages:
        try:
            handoff = await build_handoff(conversation=conv)
            _handoff_cache[conv_id] = handoff
            try:
                from app.db.repo import persist_handoff

                persist_handoff(handoff)
            except Exception:  # noqa: BLE001
                log.exception("failed to persist handoff for %s", conv_id)
            log.info(
                "ended %s by=%s | bucket=%s confidence=%.2f next=%s",
                conv_id,
                body.ended_by,
                handoff.classification.bucket,
                handoff.classification.confidence,
                handoff.next_action.type,
            )
        except Exception as e:  # noqa: BLE001
            handoff_error = f"{type(e).__name__}: {e}"
            log.exception("handoff scoring failed for %s", conv_id)
    else:
        log.info("ended empty conversation %s — no handoff", conv_id)

    return EndConversationResponse(
        conversation=_to_dto(conv),
        handoff=handoff,
        handoff_error=handoff_error,
    )


@router.get("/{conv_id}/handoff", response_model=HandoffRecord)
async def get_handoff(conv_id: str) -> HandoffRecord:
    # Hot path: in-memory cache from the same process that scored the call.
    cached = _handoff_cache.get(conv_id)
    if cached is not None:
        return cached
    # Cold path: rehydrate from the DB. Survives restarts.
    from app.db.repo import get_handoff_row

    row = get_handoff_row(conv_id)
    if row is None:
        raise HTTPException(404, f"no handoff for conversation {conv_id}")
    handoff = HandoffRecord.model_validate_json(row.payload_json)
    _handoff_cache[conv_id] = handoff  # warm the cache for subsequent reads
    return handoff
