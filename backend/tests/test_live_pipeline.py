"""Approved live smoke check, isolated from the deployed demo database."""

import time

import pytest

from app.agent.conversation import ConversationStore, stream_user_turn
from app.agent.settings import AgentSettings
from app.config import get_settings
from app.db.repo import init_db
from app.scoring.classifier import classify_conversation

pytest_plugins = ["tests.test_persistence"]


@pytest.mark.skipif(not get_settings().gemini_api_key, reason="Gemini key not configured")
@pytest.mark.asyncio
async def test_live_english_hinglish_and_classification(isolated_db, monkeypatch):
    from app.agent import conversation

    init_db()
    store = ConversationStore()
    monkeypatch.setattr(conversation, "_store", store)

    async def turn(conv, text, language):
        started = time.perf_counter()
        first = None
        pieces = []
        async for piece in stream_user_turn(conv.conv_id, text, lang_hint=language):
            if first is None:
                first = time.perf_counter() - started
            pieces.append(piece)
        reply = "".join(pieces)
        print(f"\n{language}: first token={first:.2f}s total={time.perf_counter() - started:.2f}s\n{reply}")
        assert len(reply) > 20
        assert not any(phrase in reply.lower() for phrase in (
            "lost the line", "reached its api quota", "could you say that again",
        )), "Provider fallback is not a successful model response"
        return reply

    custom = store.create()
    custom.settings = AgentSettings(
        business_name="Example Academy", program_name="Python course",
        knowledge="The Python course lasts six weeks and costs 500 rupees. No job guarantees.",
    )
    reply = await turn(custom, "How much does the Python course cost and how long is it?", "en-IN")
    assert "500" in reply and ("six" in reply.lower() or "6" in reply)
    assert "rupeezy" not in reply.lower()
    reply = await turn(custom, "Kya job guaranteed hai? Main pehle brochure dekhna chahta hoon.", "hinglish")
    assert "rupeezy" not in reply.lower()
    assert any(word in reply.lower() for word in ("nahi", "nahin", "guarantee"))

    cases = [
        ("hot", "I have reviewed the details and want to sign up now. Send the signup link."),
        ("warm", "Link bhej do taaki main pehle padh sakoon. Abhi join karne ka decision nahi liya."),
        ("cold", "Remove my number. Don't contact me again."),
    ]
    for expected, text in cases:
        result = await classify_conversation(messages=[{"role": "user", "text": text}], business_name="custom")
        print(f"classification expected={expected} actual={result[0].bucket}: {result[0].rationale}")
        assert result[0].bucket == expected

    sample = store.create()
    reply = await turn(sample, "Hi, are you an AI assistant?", "en-IN")
    assert "ai" in reply.lower()
    reply = await turn(sample, "Joining fees aur monthly subscription kya hai?", "hinglish")
    assert "2,499" in reply or "2499" in reply or "subscription" in reply.lower()


@pytest.mark.asyncio
async def test_live_native_audio_tool_and_transcript():
    from app.ai import get_client
    from app.agent.live import live_config
    from google.genai import types

    for model in ("gemini-3.8-live", "gemini-3.1-flash-live-preview"):
        config = live_config("You are Aria for Example Academy. No price is supplied. Use lookup_knowledge to answer price questions.")
        async with get_client().aio.live.connect(model=model, config=config) as session:
            await session.send_client_content(turns=types.Content(role="user", parts=[types.Part(text="What is the course price? Look up the confirmed price first.")]), turn_complete=True)
            audio_bytes = 0
            transcript = []
            tool_used = False
            import asyncio

            async with asyncio.timeout(45):
                complete = False
                while not complete:
                    async for message in session.receive():
                        if message.tool_call:
                            for call in message.tool_call.function_calls:
                                tool_used = True
                                await session.send_tool_response(function_responses=[types.FunctionResponse(
                                    id=call.id, name=call.name, response={"knowledge": "The confirmed course price is 500 rupees."},
                                )])
                        if message.data:
                            audio_bytes += len(message.data)
                        content = message.server_content
                        if content and content.output_transcription and content.output_transcription.text:
                            transcript.append(content.output_transcription.text)
                        if content and content.turn_complete and audio_bytes > 0:
                            complete = True
            print(f"\n{model} tool={tool_used} audio_bytes={audio_bytes} transcript={''.join(transcript)}")
            assert tool_used
            assert audio_bytes > 1000
            assert "500" in "".join(transcript)


def test_live_websocket_end_to_end(isolated_db, monkeypatch):
    from fastapi.testclient import TestClient
    from app.agent import conversation
    from app.main import app
    from app.db.repo import get_conversation_row

    init_db()
    monkeypatch.setattr(conversation, "_store", ConversationStore())
    client = TestClient(app)
    created = client.post("/api/conversations", json={"settings": {
        "business_name": "Example Academy", "knowledge": "The course costs 500 rupees.",
    }})
    assert created.status_code == 200
    cid = created.json()["conv_id"]
    audio = False
    transcript = ""
    with client.websocket_connect(f"/api/conversations/{cid}/live?model=gemini-3.8-live") as socket:
        assert socket.receive_json()["type"] == "ready"
        socket.send_json({"type": "greet"})
        greeting = ""
        greeting_audio = False
        for _ in range(1000):
            event = socket.receive_json()
            if event["type"] == "audio":
                greeting_audio = True
            if event["type"] == "transcript" and event["role"] == "assistant":
                greeting += event["text"]
            if event["type"] == "turn_complete":
                break
        assert greeting_audio
        assert "Example Academy" in greeting
        print(f"\nSpoken custom-agent greeting: {greeting}")
        socket.send_json({"type": "text", "text": "What is the course price?"})
        for _ in range(1000):
            event = socket.receive_json()
            if event["type"] == "audio":
                audio = True
            if event["type"] == "transcript" and event["role"] == "assistant":
                transcript += event["text"]
            if event["type"] == "error":
                raise AssertionError(event)
            if event["type"] == "turn_complete":
                break
        socket.send_json({"type": "stop"})
        socket.receive()
    row = get_conversation_row(cid)
    print(f"\nLive WebSocket: audio={audio} transcript={transcript} persisted_messages={len(row.messages)}")
    assert audio
    assert "500" in transcript
    assert row.channel == "voice"
    assert any("500" in message.text for message in row.messages if message.role == "assistant")
    ended = client.post(f"/api/conversations/{cid}/end", json={"ended_by": "lead"})
    assert ended.status_code == 200
    assert ended.json()["handoff"] is not None, ended.json().get("handoff_error")
    assert ended.json()["handoff"]["conversation_id"] == cid
