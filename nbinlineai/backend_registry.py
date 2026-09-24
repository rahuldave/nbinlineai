"""Connection routes used by notebook prompts.

An account connection is deliberately separate from API-key storage.  The
subscription route must never be treated as an OpenAI API credential.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Backend:
    id: str
    transport: str
    vendor: str | None = None


BACKENDS = {
    "openai_api": Backend("openai_api", "api_key", "openai"),
    "anthropic_api": Backend("anthropic_api", "api_key", "anthropic"),
    "openai_codex_subscription": Backend("openai_codex_subscription", "subscription"),
}


def get_backend(backend_id: str) -> Backend:
    """Return a known connection route, including one that is not yet ready."""
    try:
        return BACKENDS[backend_id]
    except (KeyError, TypeError) as exc:
        raise ValueError("Unsupported AI backend") from exc
