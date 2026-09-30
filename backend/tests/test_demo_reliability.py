"""Offline regressions for session recovery, opt-outs, and repeated call closes."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.agent.conversation import ConversationStore
from app.agent.opt_out import is_opt_out
from app.agent.settings import AgentSettings
from app.db.repo import init_db, persist_conversation, save_session_settings
from app.scoring.evidence import extract_evidence
from app.scoring.schemas import Discovery
from tests.test_persistence import _sample_handoff

pytest_plugins = ["tests.test_persistence"]


@pytest.mark.parametrize("text", ["Remove my number", "Don't call me again", "call mat karo", "mera number hata do", "कॉल मत करो"])
def test_explicit_opt_out(text):
    assert is_opt_out(text)


@pytest.mark.parametrize("text", ["I'll think about it", "Call me later", "I need to compare the plans"])
def test_deferral_is_not_opt_out(text):
    assert not is_opt_out(text)


def test_conversation_restores_settings_and_messages(isolated_db):
    init_db()
    original = ConversationStore().create()
    original.add("user", "Tell me about your course")
    persist_conversation(original)
    settings = AgentSettings(business_name="Example Academy", knowledge="Course costs 500 rupees.")
    save_session_settings(original.conv_id, settings.model_dump_json())
    restored = ConversationStore().get(original.conv_id)
    assert restored.messages[0].text == original.messages[0].text
    assert restored.settings.business_name == "Example Academy"


def test_repeated_end_classifies_and_sends_once(isolated_db, monkeypatch):
    from app.agent import conversation, routes
    from app.main import app
    from app.whatsapp import sender

    init_db()
    store = ConversationStore()
    monkeypatch.setattr(conversation, "_store", store)
    conv = store.create()
    conv.add("user", "Please send the signup link")
    calls = {"classify": 0, "send": 0}

    async def handoff(**kwargs):
        calls["classify"] += 1
        await asyncio.sleep(0)
        return _sample_handoff(conv.conv_id)

    class Sender:
        async def send(self, record):
            calls["send"] += 1

    monkeypatch.setattr(routes, "build_handoff", handoff)
    monkeypatch.setattr(sender, "get_sender", lambda: Sender())
    client = TestClient(app)
    for _ in range(2):
        response = client.post(f"/api/conversations/{conv.conv_id}/end", json={"ended_by": "lead"})
        assert response.status_code == 200
    assert calls == {"classify": 1, "send": 1}


def test_evidence_never_quotes_assistant_or_invents_numbers():
    messages = [
        {"role": "assistant", "text": "You have 20 clients and want to sign up"},
        {"role": "user", "text": "I have 15 clients; send a brochure"},
    ]
    evidence = extract_evidence(messages, Discovery(estimated_clients=20))
    assert [item.field for item in evidence] == ["information_request"]
    assert all(item.turn == 1 and item.quote == messages[1]["text"] for item in evidence)


def test_custom_business_prompt_does_not_include_rupeezy_terms():
    settings = AgentSettings(business_name="Example Academy", knowledge="We teach Python.")
    assert "Rupeezy" not in settings.instruction()
    assert "We teach Python" in settings.instruction()


def test_configured_conversation_survives_restart_at_api_level(isolated_db, monkeypatch):
    from app.agent import conversation
    from app.main import app

    init_db()
    monkeypatch.setattr(conversation, "_store", ConversationStore())
    client = TestClient(app)
    created = client.post("/api/conversations", json={"settings": {
        "business_name": "Example Academy", "program_name": "Python course",
        "knowledge": "The course takes six weeks.", "language": "hinglish",
    }})
    assert created.status_code == 200
    cid = created.json()["conv_id"]
    monkeypatch.setattr(conversation, "_store", ConversationStore())
    opener = client.post(f"/api/conversations/{cid}/opener", json={})
    assert opener.status_code == 200
    assert "Example Academy" in opener.json()["text"]
    assert "Namaste" in opener.json()["text"]
    assert client.get(f"/api/conversations/{cid}").status_code == 200


def test_queue_restores_and_marks_interrupted_work_failed(isolated_db):
    from app.agent.dialer import QueuedLead, enqueue, get_queue, reset_queue, restore_queue

    init_db()
    reset_queue()
    enqueue(QueuedLead(lead_id="restart-job", name="Example", phone="", status="contacting"))
    reset_queue()
    restore_queue()
    assert get_queue()[0].status == "failed"
    assert "restarted" in get_queue()[0].error
    reset_queue()


def test_review_preserves_ai_classification_and_requires_reason(isolated_db):
    from app.db.repo import persist_handoff
    from app.agent.conversation import Conversation
    from app.main import app

    init_db()
    conv = Conversation(conv_id="review-test")
    persist_conversation(conv)
    original = _sample_handoff(conv.conv_id)
    persist_handoff(original)
    client = TestClient(app)
    rejected = client.patch(f"/api/dashboard/leads/{conv.conv_id}/review", json={"bucket": "cold"})
    assert rejected.status_code == 422
    saved = client.patch(f"/api/dashboard/leads/{conv.conv_id}/review", json={
        "bucket": "cold", "reason": "The lead asked for information only", "notes": "Demo review",
    })
    assert saved.status_code == 200
    assert saved.json()["classification"]["bucket"] == original.classification.bucket
    assert saved.json()["review"]["bucket"] == "cold"
    assert client.get(f"/api/conversations/{conv.conv_id}/handoff").json()["review"]["notes"] == "Demo review"
