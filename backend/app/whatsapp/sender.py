"""WhatsApp follow-up sender.

Phase 8 (mocked). Two implementations behind a single ``WhatsappSender``
interface so the Round-2 demo runs without any real Meta credentials, but
flipping ``WHATSAPP_MODE=cloud`` in env wires production with a one-class
swap.

Templates are rendered from Appendix A §9:

  - §9.1 (Hot)         : signup link + RM callback ETA + 3-bullet quick ref
  - §9.2 (Warm)        : signup link + summary link + comparison sheet +
                         scheduled callback
  - §9.3 (Cold/nurture): single nurture touch — only sent for cold leads
                         when ``next_action.type == "nurture_sequence"``.
                         DND leads are explicitly skipped.

Hot leads ALSO receive WhatsApp: the §9.1 template carries the signup link
that the warm-transferred RM needs to point at.
"""

from __future__ import annotations

import abc
import logging

from app.config import get_settings
from app.db.models import WhatsappLog
from app.scoring.schemas import HandoffRecord

log = logging.getLogger("rupeezy.whatsapp.sender")


# ---------- template rendering ----------

# Placeholders (kept literal in the rendered body so the demo dashboard
# obviously shows "this is the template the partner team would receive,
# unfilled for the live demo"). In prod the RM CRM would substitute these
# at send time.
_SIGNUP_LINK = "https://rupeezy.in/partner-signup?ref=[CONV]"
_SUMMARY_LINK = "https://rupeezy.in/partner-summary/[CONV]"
_COMPARE_LINK = "https://rupeezy.in/partner-compare-sheet"


def _name(handoff: HandoffRecord) -> str:
    name = (handoff.contact.name or "").strip()
    return name if name and name.lower() != "unknown" else "there"


def render_hot_template(handoff: HandoffRecord) -> str:
    """Appendix §9.1 — hot lead, warm-transfer companion message."""
    return (
        f"Hi {_name(handoff)}, this is Rupeezy. Thanks for the call just now. "
        f"Here's the partner signup link to get started: {_SIGNUP_LINK}. "
        "[RM Name] will be calling you back within the next 30 minutes "
        "with the full context of what we discussed — no need to "
        "re-explain anything.\n"
        "\n"
        "Quick reference for what we covered:\n"
        "• 100% lifetime brokerage share, paid daily via RISE Portal\n"
        "• Eligibility: NISM Series VII + 50 referrals to apply\n"
        "• One-time refundable security deposit ₹1L; monthly subscription "
        "deducted from earnings (starts at ₹2,499)"
    )


def render_warm_template(handoff: HandoffRecord) -> str:
    """Appendix §9.2 — warm lead, three links + scheduled callback."""
    return (
        f"Hi {_name(handoff)}, thanks for the chat earlier today. "
        "As discussed, here are three things:\n"
        f"1. Partner signup link: {_SIGNUP_LINK}\n"
        f"2. One-page summary of what we covered (with full fee breakdown): "
        f"{_SUMMARY_LINK}\n"
        f"3. Brokerage comparison sheet (Rupeezy vs. Angel One, 5paisa, "
        f"Motilal): {_COMPARE_LINK}\n"
        "\n"
        "[RM Name] will call you on [DAY] [TIME WINDOW] to take it forward. "
        "If anything changes, just reply to this message."
    )


def render_cold_nurture_template(handoff: HandoffRecord) -> str:
    """Appendix §9.3 — cold/soft, single day-3 nurture touch."""
    return (
        f"Hi {_name(handoff)}, Rupeezy here. We spoke earlier this week "
        "about our partner program. No follow-up call from us — just "
        f"leaving you with the link in case it's useful later: {_SIGNUP_LINK}. "
        "All the best with your business."
    )


def select_template(handoff: HandoffRecord) -> tuple[str, str] | None:
    """Pick a (template_id, body) for the handoff, or ``None`` to skip.

    Skip rules (returns ``None``):
      - ``next_action.type == "dnd"``                    → never WhatsApp
      - cold bucket without ``nurture_sequence`` action  → silent
    """
    if handoff.next_action.type == "dnd":
        return None

    bucket = handoff.classification.bucket
    if bucket == "hot":
        return ("hot", render_hot_template(handoff))
    if bucket == "warm":
        return ("warm", render_warm_template(handoff))
    if bucket == "cold":
        if handoff.next_action.type == "nurture_sequence":
            return ("cold_nurture", render_cold_nurture_template(handoff))
        return None
    return None


# ---------- sender interface + implementations ----------


class WhatsappSender(abc.ABC):
    """Interface every WhatsApp transport must implement.

    Senders are deliberately fire-and-forget: errors are swallowed by the
    caller in ``/end`` so a flaky WhatsApp pipeline never breaks the
    user-facing post-call flow.
    """

    @abc.abstractmethod
    async def send(self, handoff: HandoffRecord) -> WhatsappLog: ...


class MockSender(WhatsappSender):
    """Default sender. Renders the right Appendix §9 template, persists a
    ``whatsapp_log`` row with status ``sent_mock``, returns the log row.

    Returns a transient (un-persisted) WhatsappLog with ``status='skipped'``
    when the lead's next_action says we shouldn't message them.
    """

    async def send(self, handoff: HandoffRecord) -> WhatsappLog:
        chosen = select_template(handoff)
        if chosen is None:
            log.info(
                "whatsapp skipped for %s (bucket=%s, next=%s)",
                handoff.lead_id,
                handoff.classification.bucket,
                handoff.next_action.type,
            )
            # Transient — we deliberately do NOT write skipped rows so the
            # dashboard doesn't get a noisy "skipped" entry next to a
            # genuinely-suppressed lead.
            return WhatsappLog(
                conversation_id=handoff.lead_id,
                template_id="skipped",
                body="",
                to_phone=handoff.contact.phone or "",
                status="skipped",
                response_payload=None,
            )

        template_id, body = chosen
        from app.db.repo import persist_whatsapp_log

        row = WhatsappLog(
            conversation_id=handoff.lead_id,
            template_id=template_id,
            body=body,
            to_phone=handoff.contact.phone or "",
            status="sent_mock",
            response_payload=None,
        )
        persist_whatsapp_log(row)
        log.info(
            "whatsapp sent_mock for %s template=%s",
            handoff.lead_id,
            template_id,
        )
        return row


class CloudApiSender(WhatsappSender):
    """Production swap target — real Meta WhatsApp Business Cloud API.

    Skeleton only for Phase 8. Wiring is one env var change away
    (``WHATSAPP_MODE=cloud``) once credentials and a verified sender
    number exist.
    """

    async def send(self, handoff: HandoffRecord) -> WhatsappLog:
        # TODO: WhatsApp Cloud API integration
        #   1. POST to https://graph.facebook.com/v18.0/{phone-number-id}/messages
        #   2. Auth via WHATSAPP_CLOUD_API_TOKEN bearer header
        #   3. Map our (template_id, body) into Meta's template message format
        #   4. Persist response_payload (message_id, recipient_wa_id) for replies
        raise NotImplementedError(
            "CloudApiSender is not implemented; set WHATSAPP_MODE=mock for the demo."
        )


def get_sender() -> WhatsappSender:
    """Factory — returns the sender configured by ``WHATSAPP_MODE``.

    Default is mock, which is what the Phase 8 demo needs. Anything other
    than the literal string ``"mock"`` selects the cloud sender.
    """
    mode = (get_settings().whatsapp_mode or "mock").strip().lower()
    if mode == "mock":
        return MockSender()
    return CloudApiSender()
