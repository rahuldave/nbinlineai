"""Real pinned vendor converters and the private native image serializer."""

import asyncio
import importlib
import json
from io import BytesIO

import pytest
from aidialog.msg_parts import Msg, Text
from PIL import Image

from nbinlineai import providers
from nbinlineai.config import MODEL_CHOICES
from nbinlineai.context_budget import ContextWindowExceededError, build_context
from nbinlineai.model_image import (
    ImageProviderUnsupported,
    api_payload,
    api_wire_cost,
    image_model_supported,
    image_part,
)
from nbinlineai.subscription_runtime import (
    LOCAL_IMAGE_PATH_RESERVE,
    OUTPUT_SCHEMA,
    ROUND_INSTRUCTIONS,
    RPC_METADATA_RESERVE,
    _compact,
    _round_input,
    _round_text,
    round_wire_cost,
)


def image_bytes() -> bytes:
    stream = BytesIO()
    Image.new('RGB', (2, 2), 'red').save(stream, format='PNG')
    return stream.getvalue()


@pytest.mark.parametrize('backend', ['openai_api', 'anthropic_api'])
def test_native_api_image_is_a_real_vendor_part_and_full_envelope_is_counted(backend):
    model = MODEL_CHOICES[backend][0]
    part = image_part(image_bytes(), 'image/png')
    messages = [Msg('system', [Text('instructions')]), Msg('user', [Text('Question'), part])]
    tools = [{'type': 'function', 'name': 'noop', 'description': 'A synthetic schema',
              'parameters': {'type': 'object', 'properties': {}}}]
    payload = api_payload(backend, model, messages, tools)
    counted = api_wire_cost(backend, model, messages, tools)
    assert counted == len(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    if backend == 'openai_api':
        content = payload['input'][0]['content']
        assert content[1]['type'] == 'input_image'
        assert content[1]['image_url'] == part.text
        assert 'data:image' not in content[0]['text']
    else:
        content = payload['messages'][0]['content']
        assert content[1]['type'] == 'image'
        assert content[1]['source']['media_type'] == 'image/png'
        assert content[1]['source']['data'] in part.text
        assert 'data:image' not in content[0]['text']
    built = build_context([], [], tools, 'instructions', '', 'Question', [],
                          round_wire_cost=lambda round_messages, declared: api_wire_cost(
                              backend, model, round_messages, declared),
                          current_media_parts=[part])
    assert built.counts['round_wire_chars'] == api_wire_cost(backend, model, built.messages, tools)


def test_all_offered_api_models_accept_image_and_unknown_fails_closed():
    assert sum(len(models) for models in MODEL_CHOICES.values()) == 7
    for backend, models in MODEL_CHOICES.items():
        assert all(image_model_supported(backend, model) for model in models)
        assert not image_model_supported(backend, 'custom-unknown')
    assert not image_model_supported('openai_codex_subscription', 'gpt-6-sol',
                                     subscription_modalities=['text'])
    assert image_model_supported('openai_codex_subscription', 'gpt-6-sol',
                                 subscription_modalities=['text', 'image'])


def test_openai_existing_fastllm_transport_receives_exact_detail_payload(monkeypatch):
    async def check():
        acomplete_module = importlib.import_module('fastllm.acomplete')
        api = acomplete_module.api_registry['openai']
        sent = []

        async def provider_req(client, path, body, **kwargs):
            sent.append(body)
            return object()

        async def collect(_response, **kwargs):
            from fastllm.acomplete import Completion

            yield Completion('gpt-6-sol', Msg('assistant', [Text('OK')]), finish_reason='stop')

        monkeypatch.setattr(acomplete_module, 'provider_req', provider_req)
        monkeypatch.setattr(api, 'acollect_stream', collect)
        monkeypatch.setattr(providers, 'resolve_api_key', lambda backend: 'synthetic-test-key')
        part = image_part(image_bytes(), 'image/png', detail='high', backend='openai_api')
        messages = [Msg('system', [Text('instructions')]), Msg('user', [Text('Question'), part])]
        streamed = await providers.complete('openai_api', 'gpt-6-sol', messages, [], image_detail='high')
        received = [item async for item in streamed]
        assert received[-1].message.text == 'OK'
        assert len(sent) == 1
        image = sent[0]['input'][0]['content'][1]
        assert image == {'type': 'input_image', 'image_url': part.text, 'detail': 'high'}
        assert api_wire_cost('openai_api', 'gpt-6-sol', messages, [], image_detail='high') == len(
            json.dumps(sent[0], ensure_ascii=False, separators=(',', ':')))

    asyncio.run(check())


def test_exact_image_budget_rejects_oversize_without_resizing():
    with pytest.raises(ImageProviderUnsupported, match='detail=auto only'):
        image_part(image_bytes(), 'image/png', detail='high', backend='anthropic_api')
    part = image_part(image_bytes(), 'image/png', detail='high', backend='openai_api')
    high = api_payload('openai_api', 'gpt-6-sol', [Msg('user', [Text('Question'), part])], [],
                       image_detail='high')
    assert high['input'][0]['content'][1]['detail'] == 'high'
    with pytest.raises(ValueError, match='smaller derivative'):
        image_part(b'x' * 48_000, 'image/png')
    part = image_part(b'x' * 47_000, 'image/png')
    with pytest.raises(ContextWindowExceededError, match='smaller derivative'):
        build_context([], [], [], 'instructions' * 300, '', 'Question', [],
                      round_wire_cost=lambda messages, tools: api_wire_cost(
                          'openai_api', 'gpt-6-sol', messages, tools),
                      current_media_parts=[part])


def test_subscription_image_is_separate_local_image_with_bounded_path_reserve():
    messages = [Msg('user', [Text('Question')])]
    text = _round_text(messages, [])
    assert 'data:image' not in text and 'localImage' not in text
    local = _round_input(messages, [], local_image_path='/private/round/image.png', detail='high')
    assert local == [{'type': 'text', 'text': text},
                     {'type': 'localImage', 'path': '/private/round/image.png', 'detail': 'high'}]
    reserved = _compact({'baseInstructions': ROUND_INSTRUCTIONS,
                         'input': _round_input(messages, [],
                             local_image_path='x' * LOCAL_IMAGE_PATH_RESERVE, detail='high'),
                         'outputSchema': OUTPUT_SCHEMA})
    assert round_wire_cost(messages, [], local_image=True, detail='high') == (
        len(reserved) + RPC_METADATA_RESERVE)
