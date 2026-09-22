"""FastLLM completion seam; replace `complete` in deterministic tests."""

import os

from fastllm.acomplete import acomplete

from .config import KEY_NAMES, load_server_env


async def complete(backend: str, model: str, messages: list, tools: list):
    load_server_env()
    vendor = {"openai_api": "openai", "anthropic_api": "anthropic"}[backend]
    system = "\n\n".join(message.text for message in messages if message.role == "system")
    conversation = [message for message in messages if message.role != "system"]
    # Explicit vendor and no retries: a repeated model request can duplicate a tool call.
    return await acomplete(
        conversation,
        model,
        vendor_name=vendor,
        api_key=os.environ[KEY_NAMES[backend]],
        tools=tools or None,
        system=system,
        max_tokens=4096,
        stream=True,
        retries=0,
    )
