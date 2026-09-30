import asyncio
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.agent.conversation import ConversationStore
from app.agent.live import live_config
from app.db.repo import init_db, persist_conversation, get_conversation_row

pytest_plugins = ["tests.test_persistence"]


def test_live_config_supports_transcripts_and_retrieval():
    config = live_config("Example facts")
    assert config.input_audio_transcription is not None
    assert config.output_audio_transcription is not None
    assert config.tools[0].function_declarations[0].name == "lookup_knowledge"


def test_live_websocket_persists_typed_turn(isolated_db, monkeypatch):
    from app.agent import conversation, live
    from app.main import app

    init_db()
    store = ConversationStore()
    monkeypatch.setattr(conversation, "_store", store)
    conv = store.create()
    conv.settings.knowledge = "Example facts"
    persist_conversation(conv)

    class Session:
        async def send_client_content(self, **kwargs):
            assert kwargs["turn_complete"] is True

        async def receive(self):
            await asyncio.sleep(60)
            if False:
                yield None

    class Connection:
        async def __aenter__(self):
            return Session()

        async def __aexit__(self, *args):
            pass

    client = SimpleNamespace(aio=SimpleNamespace(live=SimpleNamespace(connect=lambda **kwargs: Connection())))
    monkeypatch.setattr(live, "get_client", lambda: client)
    with TestClient(app).websocket_connect(f"/api/conversations/{conv.conv_id}/live") as socket:
        assert socket.receive_json()["type"] == "ready"
        socket.send_json({"type": "greet"})
        socket.send_json({"type": "text", "text": "Hello"})
        assert socket.receive_json()["text"] == "Hello"
        socket.send_json({"type": "stop"})
        socket.receive()
    row = get_conversation_row(conv.conv_id)
    assert row.channel == "voice"
    assert row.messages[0].text == "Hello"


def test_unknown_live_model_is_rejected(isolated_db, monkeypatch):
    import pytest
    from starlette.websockets import WebSocketDisconnect
    from app.main import app

    init_db()
    with pytest.raises(WebSocketDisconnect):
        with TestClient(app).websocket_connect("/api/conversations/example/live?model=unapproved"):
            pass
