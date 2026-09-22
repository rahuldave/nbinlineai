"""Server-side API configuration. Never return credential values to clients."""

import os
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_MODELS = {
    "openai_api": "gpt-5.4-mini",
    "anthropic_api": "claude-haiku-4-5-20251001",
}
MODEL_CHOICES = {
    "openai_api": ["gpt-5.4-mini", "gpt-5.4"],
    "anthropic_api": ["claude-haiku-4-5-20251001", "claude-sonnet-4-5"],
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
    return {
        backend: {
            "configured": bool(os.getenv(key_name)),
            "default_model": DEFAULT_MODELS[backend],
            "models": MODEL_CHOICES[backend],
        }
        for backend, key_name in KEY_NAMES.items()
    }
