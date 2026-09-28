"""Exact still-image model payload and host-envelope accounting."""

from __future__ import annotations

import base64
import json
from collections.abc import Iterable

from aidialog.msg_parts import InputImage, Msg
from fastllm import anthropic, openai_responses

from .config import MODEL_CAPABILITIES


class ImageProviderUnsupported(ValueError):
    """The selected model cannot accept this exact still-image input."""


def image_model_supported(backend: str, model: str, *, subscription_modalities: Iterable[str] | None = None) -> bool:
    if backend == 'openai_codex_subscription':
        return subscription_modalities is not None and 'image' in subscription_modalities
    return 'image' in MODEL_CAPABILITIES.get(backend, {}).get(model, {}).get('input_modalities', ())


def image_part(data: bytes, mime_type: str, *, detail: str = 'auto', backend: str | None = None) -> InputImage:
    if detail != 'auto' and backend != 'openai_api':
        raise ImageProviderUnsupported(
            'provider_unsupported: This API image transport supports detail=auto only')
    if len(data) >= 48_000:
        raise ValueError('Exact image exceeds the 64000-character API envelope; attach an explicit smaller derivative')
    encoded = base64.b64encode(data).decode('ascii')
    return InputImage(f'data:{mime_type};base64,{encoded}', mime=mime_type)


def api_payload(backend: str, model: str, messages: list[Msg], tools: list[dict],
                *, reasoning_effort: str | None = None, image_detail: str = 'auto') -> dict:
    """Mirror pinned FastLLM 0.0.63's real provider converter and options."""
    converter = {'openai_api': openai_responses, 'anthropic_api': anthropic}.get(backend)
    if converter is None:
        raise ImageProviderUnsupported('Selected backend cannot accept image input')
    if not image_model_supported(backend, model):
        raise ImageProviderUnsupported('Selected model does not support image input')
    system = '\n\n'.join(message.text for message in messages if message.role == 'system')
    conversation = [message for message in messages if message.role != 'system']
    effective_effort = reasoning_effort or MODEL_CAPABILITIES[backend][model].get('default_effort')
    max_tokens = 65536 if effective_effort in ('xhigh', 'max') else 32768 if effective_effort == 'high' else 16384
    payload = converter.mk_payload(conversation, model, tools=tools or None, system=system,
                                   max_tokens=max_tokens, stream=True,
                                   **({'reasoning_effort': reasoning_effort} if reasoning_effort else {}))
    if fix := getattr(converter, 'fix_payload', None):
        fix(payload, model, 'openai' if backend == 'openai_api' else 'anthropic')
    if image_detail != 'auto':
        if image_detail not in ('low', 'high') or backend != 'openai_api':
            raise ImageProviderUnsupported('provider_unsupported: Selected API image detail is unavailable')
        image_count = 0
        for message in payload.get('input', []):
            for content in message.get('content', []):
                if content.get('type') == 'input_image':
                    content['detail'] = image_detail
                    image_count += 1
        if image_count != 1:
            raise ImageProviderUnsupported('Expected one exact image for OpenAI detail selection')
    return payload


def api_wire_cost(backend: str, model: str, messages: list[Msg], tools: list[dict],
                  *, reasoning_effort: str | None = None, image_detail: str = 'auto') -> int:
    return len(json.dumps(api_payload(backend, model, messages, tools,
                                      reasoning_effort=reasoning_effort, image_detail=image_detail),
                          ensure_ascii=False, separators=(',', ':')))
