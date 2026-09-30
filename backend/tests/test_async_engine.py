"""The streaming engine must yield to other work and preserve interrupted turns."""

import asyncio
from types import SimpleNamespace

import pytest

from app.agent.conversation import ConversationStore, stream_user_turn
from app.agent.settings import AgentSettings
from app.db.repo import get_conversation_row, init_db, persist_conversation

pytest_plugins = ["tests.test_persistence"]


@pytest.mark.asyncio
async def test_cancelled_stream_preserves_partial_response(isolated_db, monkeypatch):
    from app.agent import conversation

    init_db()
    store = ConversationStore()
    monkeypatch.setattr(conversation, "_store", store)
    monkeypatch.setattr(conversation, "_ensure_genai", lambda: None)
    conv = store.create()
    conv.settings = AgentSettings(business_name="Example", knowledge="An example offer.")
    persist_conversation(conv)
    first_token = asyncio.Event()

    async def generate(**kwargs):
        async def chunks():
            yield SimpleNamespace(text="Hello there.")
            first_token.set()
            await asyncio.sleep(60)
        return chunks()

    async def acquire(model):
        return None

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=generate)))
    monkeypatch.setattr("app.ai.get_client", lambda: client)
    monkeypatch.setattr("app.ai.quota_guard.acquire", acquire)

    async def drain():
        async for _ in stream_user_turn(conv.conv_id, "hello"):
            pass

    task = asyncio.create_task(drain())
    await asyncio.wait_for(first_token.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    row = get_conversation_row(conv.conv_id)
    assert [message.text for message in row.messages] == ["hello", "Hello there."]


@pytest.mark.asyncio
async def test_optout_does_not_call_model(isolated_db, monkeypatch):
    from app.agent import conversation
    from app.db.repo import get_lead, upsert_lead

    init_db()
    upsert_lead(lead_id="optout-lead", name="Example")
    store = ConversationStore()
    monkeypatch.setattr(conversation, "_store", store)
    monkeypatch.setattr(conversation, "_ensure_genai", lambda: None)
    conv = store.create_for_lead("optout-lead")

    def forbidden():
        raise AssertionError("Opt-out must not invoke a model")

    monkeypatch.setattr(conversation, "get_client", forbidden)
    response = "".join([piece async for piece in stream_user_turn(conv.conv_id, "Remove my number")])
    assert "won't be contacted" in response
    assert get_lead("optout-lead").dnd


@pytest.mark.asyncio
async def test_quota_guard_rejects_before_another_request(monkeypatch):
    from app.ai import DemoBusyError, QuotaGuard

    settings = SimpleNamespace(gemini_rpm_limit=1, gemini_daily_request_limit=2)
    monkeypatch.setattr("app.ai.get_settings", lambda: settings)
    guard = QuotaGuard()
    await guard.acquire("example-model")
    with pytest.raises(DemoBusyError, match="busy"):
        await guard.acquire("example-model")


@pytest.mark.asyncio
async def test_conversation_lock_serializes_mutations():
    from app.agent.locks import conversation_lock

    order = []

    async def mutation(name):
        async with conversation_lock("same-session"):
            order.append(f"{name}-start")
            await asyncio.sleep(0)
            order.append(f"{name}-end")

    await asyncio.gather(mutation("one"), mutation("two"))
    assert order == ["one-start", "one-end", "two-start", "two-end"]


@pytest.mark.asyncio
async def test_provider_overload_retries_before_streaming(monkeypatch):
    from app import ai
    from google.genai.errors import ServerError

    attempts = []

    async def generate(**kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise ServerError(503, {"error": {"message": "busy", "code": 503}})

        async def chunks():
            yield SimpleNamespace(text="Recovered")
        return chunks()

    async def noop(*args):
        pass

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=generate)))
    monkeypatch.setattr(ai, "get_client", lambda: client)
    monkeypatch.setattr(ai.quota_guard, "acquire", noop)
    monkeypatch.setattr(ai.asyncio, "sleep", noop)
    result = [chunk.text async for chunk in ai.generate_stream(model="example", contents=[], config=None)]
    assert result == ["Recovered"]
    assert len(attempts) == 2


@pytest.mark.asyncio
async def test_provider_failure_after_output_never_restarts_stream(monkeypatch):
    from app import ai
    from google.genai.errors import ServerError

    attempts = []

    async def generate(**kwargs):
        attempts.append(1)

        async def chunks():
            yield SimpleNamespace(text="Partial")
            raise ServerError(503, {"error": {"message": "busy", "code": 503}})
        return chunks()

    async def noop(*args):
        pass

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=generate)))
    monkeypatch.setattr(ai, "get_client", lambda: client)
    monkeypatch.setattr(ai.quota_guard, "acquire", noop)
    with pytest.raises(ServerError):
        async for _ in ai.generate_stream(model="example", contents=[], config=None):
            pass
    assert len(attempts) == 1
