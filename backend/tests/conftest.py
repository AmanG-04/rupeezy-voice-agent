"""Network tests are explicit opt-in; ordinary pytest never spends API quota."""

import pytest


def pytest_addoption(parser):
    parser.addoption("--live", action="store_true", default=False, help="Run external API tests (uses quota)")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--live"):
        return
    skip = pytest.mark.skip(reason="External API test: explicitly opt in with --live")
    for item in items:
        if item.path.name in {"test_agent.py", "test_retrieval.py", "test_live_pipeline.py"} or (
            item.path.name == "test_tts_smoke.py" and "voices_endpoint" not in item.name
        ):
            item.add_marker(skip)
