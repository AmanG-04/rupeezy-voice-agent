"""WhatsApp follow-up dispatch (Phase 8 — mocked).

Exports:
  - ``WhatsappSender``  : abstract send interface
  - ``MockSender``      : default; persists a ``whatsapp_log`` row with
                          ``status='sent_mock'``. No external calls.
  - ``CloudApiSender``  : production skeleton (Meta WhatsApp Business
                          Cloud API). Not implemented.
  - ``get_sender()``    : factory keyed off ``settings.whatsapp_mode``
                          (``"mock"`` is the only supported live value).
  - Template renderers  : ``render_hot_template`` / ``render_warm_template``
                          / ``render_cold_nurture_template`` — direct
                          Appendix §9 transcriptions with placeholders.
  - ``select_template`` : routes a HandoffRecord to (template_id, body)
                          or ``None`` for DND / silent-cold leads.

The post-call ``/end`` route invokes ``get_sender().send(handoff)`` after
successfully scoring a conversation. The dashboard surfaces every row via
``GET /api/dashboard/leads/{conv_id}/whatsapp``.
"""

from app.whatsapp.sender import (
    CloudApiSender,
    MockSender,
    WhatsappSender,
    get_sender,
    render_cold_nurture_template,
    render_hot_template,
    render_warm_template,
    select_template,
)

__all__ = [
    "CloudApiSender",
    "MockSender",
    "WhatsappSender",
    "get_sender",
    "render_cold_nurture_template",
    "render_hot_template",
    "render_warm_template",
    "select_template",
]
