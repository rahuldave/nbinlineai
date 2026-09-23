"""FastLLM completion seam; replace `complete` in deterministic tests."""

from fastllm.acomplete import acomplete

from .config import MODEL_CAPABILITIES, resolve_api_key


async def complete(backend: str, model: str, messages: list, tools: list, *, reasoning_effort: str | None = None):
    vendor = {"openai_api": "openai", "anthropic_api": "anthropic"}[backend]
    system = "\n\n".join(message.text for message in messages if message.role == "system")
    conversation = [message for message in messages if message.role != "system"]
    # Explicit vendor and no retries: a repeated model request can duplicate a tool call.
    # High effort can consume much of the output allowance in hidden thinking.
    # This is a ceiling, not a requested output length or a token reservation.
    effective_effort = reasoning_effort or MODEL_CAPABILITIES.get(backend, {}).get(model, {}).get("default_effort")
    max_tokens = 65536 if effective_effort in ("xhigh", "max") else 32768 if effective_effort == "high" else 16384
    options = {"reasoning_effort": reasoning_effort} if reasoning_effort else {}
    return await acomplete(
        conversation,
        model,
        vendor_name=vendor,
        api_key=resolve_api_key(backend),
        tools=tools or None,
        system=system,
        max_tokens=max_tokens,
        stream=True,
        retries=0,
        **options,
    )
