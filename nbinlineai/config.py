"""Server-side API configuration. Never return credential values to clients."""

import os
from pathlib import Path

from dotenv import load_dotenv

from .credentials import CredentialStore

DEFAULT_MODELS = {
    "openai_api": "gpt-6-sol",
    "anthropic_api": "claude-sonnet-5",
}
MODEL_CHOICES = {
    "openai_api": ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra"],
    "anthropic_api": [
        "claude-sonnet-5",
        "claude-haiku-4-5-20251001",
        "claude-opus-5-5",
        "claude-fable-5-1",
    ],
}
KEY_NAMES = {"openai_api": "OPENAI_API_KEY", "anthropic_api": "ANTHROPIC_API_KEY"}


def load_server_env() -> None:
    """Load a local .env once; existing environment takes precedence."""
    load_dotenv(Path.cwd() / ".env", override=False)
    source_root = Path(__file__).resolve().parent.parent
    if (source_root / "pyproject.toml").exists():
        load_dotenv(source_root / ".env", override=False)


def provider_status() -> dict:
    load_server_env()
    store = CredentialStore()
    result = {}
    for backend, key_name in KEY_NAMES.items():
        source = "saved" if store.get(backend) else "environment" if os.getenv(key_name) else None
        result[backend] = {
            "configured": source is not None,
            "source": source,
            "default_model": DEFAULT_MODELS[backend],
            "models": MODEL_CHOICES[backend],
        }
    return result


def key_settings_status() -> dict:
    return {
        "providers": {
            backend: {"configured": status["configured"], "source": status["source"]}
            for backend, status in provider_status().items()
        }
    }


def resolve_api_key(backend: str) -> str:
    if backend not in KEY_NAMES:
        raise ValueError("Unsupported API backend")
    saved = CredentialStore().get(backend)
    if saved:
        return saved
    load_server_env()
    key = os.getenv(KEY_NAMES[backend])
    if not key:
        raise ValueError("Selected API provider is not configured")
    return key
