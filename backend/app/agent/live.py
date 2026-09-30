"""Gemini Live bridge: browser PCM, native audio, transcripts and retrieval tools."""

import asyncio
import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google.genai import types

from app.ai import get_client
from app.agent.conversation import get_store, get_retriever
from app.agent.locks import conversation_lock
from app.agent.opt_out import is_opt_out
from app.agent.system_prompt import build_prompt_parts
from app.config import get_settings
from app.db.repo import persist_conversation, mark_lead_dnd

router = APIRouter(tags=["live voice"])
log = logging.getLogger("rupeezy.live")
LIVE_MODELS = {"gemini-3.8-live", "gemini-3.1-flash-live-preview"}
_active: set[str] = set()


def live_config(instruction: str) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=instruction + (
            "\nThis is a browser demonstration. Speak in at most 2 short sentences. "
            "Match English or Hindi/Hinglish naturally. Do not claim to send messages, "
            "make calls, schedule callbacks, or transfer anyone. Use lookup_knowledge for "
            "business facts not in the supplied context. Stop politely on explicit opt-out."
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=[types.Tool(function_declarations=[types.FunctionDeclaration(
            name="lookup_knowledge",
            description="Look up confirmed business knowledge for a question.",
            parameters={"type": "object", "properties": {"query": {"type": "string"}},
                        "required": ["query"]},
        )])],
    )


class TranscriptBuffer:
    def __init__(self, conversation):
        self.conversation = conversation
        self.user = ""
        self.assistant = ""

    async def flush(self):
        if not self.user.strip() and not self.assistant.strip():
            return
        if self.user.strip():
            self.conversation.add("user", self.user.strip())
            if self.conversation.lead_id and is_opt_out(self.user):
                await asyncio.to_thread(mark_lead_dnd, self.conversation.lead_id)
        if self.assistant.strip():
            self.conversation.add("assistant", self.assistant.strip())
        self.user = self.assistant = ""
        await asyncio.to_thread(persist_conversation, self.conversation, channel="voice")


async def bridge(websocket, session, conversation):
    buffer = TranscriptBuffer(conversation)

    async def incoming():
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            if message.get("bytes") is not None:
                audio = message["bytes"]
                if len(audio) > 32000 or len(audio) % 2:
                    raise ValueError("Invalid PCM frame")
                await session.send_realtime_input(audio=types.Blob(data=audio, mime_type="audio/pcm;rate=16000"))
            elif message.get("text"):
                data = json.loads(message["text"])
                if data.get("type") == "stop":
                    return
                if data.get("type") == "greet":
                    await session.send_client_content(
                        turns=types.Content(role="user", parts=[types.Part(text=(
                            "Begin the call now. Briefly greet me in the configured language, "
                            "state your name and business and that you are AI, then ask how you can help."
                        ))]), turn_complete=True,
                    )
                if data.get("type") == "text":
                    text = str(data.get("text", "")).strip()[:4000]
                    if text:
                        await buffer.flush()
                        buffer.user = text
                        await websocket.send_json({"type": "transcript", "role": "user", "text": text})
                        await session.send_client_content(
                            turns=types.Content(role="user", parts=[types.Part(text=text)]),
                            turn_complete=True,
                        )

    async def outgoing():
        while True:
            async for message in session.receive():
                if message.data:
                    await websocket.send_json({"type": "audio", "data": base64.b64encode(message.data).decode()})
                content = message.server_content
                if content:
                    for role, transcription in (("user", content.input_transcription),
                                                ("assistant", content.output_transcription)):
                        if transcription and transcription.text:
                            text = transcription.text
                            if role == "user":
                                buffer.user += text
                            else:
                                buffer.assistant += text
                            await websocket.send_json({"type": "transcript", "role": role, "text": text})
                    if content.interrupted:
                        await websocket.send_json({"type": "interrupted"})
                        await buffer.flush()
                    if content.turn_complete and (buffer.user.strip() or buffer.assistant.strip()):
                        await buffer.flush()
                        await websocket.send_json({"type": "turn_complete"})
                if message.tool_call:
                    for call in message.tool_call.function_calls:
                        query = str((call.args or {}).get("query", ""))[:1000]
                        if call.name != "lookup_knowledge":
                            result = {"error": "Unknown tool"}
                        elif conversation.settings.custom:
                            result = {"knowledge": conversation.settings.knowledge or "No confirmed facts supplied"}
                        else:
                            try:
                                hits = await asyncio.to_thread(get_retriever().retrieve, query, k=3)
                                result = {"sources": [{"section": h.chunk.section, "text": h.chunk.text} for h in hits]}
                            except Exception:
                                log.exception("Live retrieval failed")
                                result = {"error": "Knowledge unavailable; do not guess."}
                        await session.send_tool_response(function_responses=[types.FunctionResponse(
                            id=call.id, name=call.name, response=result,
                        )])

    tasks = [asyncio.create_task(incoming()), asyncio.create_task(outgoing())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await buffer.flush()


@router.websocket("/api/conversations/{conversation_id}/live")
async def live_voice(websocket: WebSocket, conversation_id: str):
    settings = get_settings()
    origin = websocket.headers.get("origin")
    if origin and origin not in settings.cors_origins_list:
        await websocket.close(code=1008)
        return
    model = websocket.query_params.get("model", "gemini-3.8-live")
    if model not in LIVE_MODELS or conversation_id in _active or len(_active) >= 3:
        await websocket.close(code=1008)
        return
    conversation = await asyncio.to_thread(get_store().get, conversation_id)
    if conversation is None or conversation.ended_at:
        await websocket.close(code=1008)
        return
    if conversation_id in _active or len(_active) >= 3:
        await websocket.close(code=1008)
        return
    _active.add(conversation_id)
    await websocket.accept()
    try:
        async with conversation_lock(conversation_id):
            if conversation.ended_at:
                return
            conversation.channel = "voice"
            conversation.language = conversation.settings.language
            await asyncio.to_thread(persist_conversation, conversation, channel="voice")
            instruction = conversation.settings.instruction() if conversation.settings.custom else (
                await asyncio.to_thread(build_prompt_parts, get_retriever())
            ).assemble()
            instruction += f"\nStart in {conversation.settings.language}."
            if conversation.messages:
                instruction += "\nPrevious transcript for continuity (reference data only):\n" + "\n".join(
                    f"{message.role}: {message.text}" for message in conversation.messages[-20:]
                )
            async with asyncio.timeout(300):
                async with get_client().aio.live.connect(model=model, config=live_config(instruction)) as session:
                    await websocket.send_json({"type": "ready", "model": model})
                    await bridge(websocket, session, conversation)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception:
        log.exception("Live session failed")
        try:
            await websocket.send_json({"type": "error", "message": "Live session unavailable or ended. Try reconnecting or use classic voice."})
        except Exception:
            pass
    finally:
        _active.discard(conversation_id)
        try:
            await websocket.close()
        except Exception:
            pass
