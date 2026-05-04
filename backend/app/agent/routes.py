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


# ---------- routes ----------


@router.post("", response_model=CreateConversationResponse)
async def create_conversation() -> CreateConversationResponse:
    conv = get_store().create()
    log.info("created conversation %s", conv.conv_id)
    return CreateConversationResponse(conv_id=conv.conv_id, started_at=conv.started_at)


@router.get("", response_model=list[ConversationDTO])
async def list_conversations() -> list[ConversationDTO]:
    return [_to_dto(c) for c in get_store().list_all()]


@router.get("/{conv_id}", response_model=ConversationDTO)
async def get_conversation(conv_id: str) -> ConversationDTO:
    conv = get_store().get(conv_id)
    if conv is None:
        raise HTTPException(404, f"conversation {conv_id} not found")
    return _to_dto(conv)


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


@router.post("/{conv_id}/end", response_model=ConversationDTO)
async def end_conversation(conv_id: str, body: EndRequest) -> ConversationDTO:
    conv = get_store().end(conv_id, ended_by=body.ended_by)
    if conv is None:
        raise HTTPException(404, f"conversation {conv_id} not found")
    log.info("ended conversation %s by=%s", conv_id, body.ended_by)
    return _to_dto(conv)
