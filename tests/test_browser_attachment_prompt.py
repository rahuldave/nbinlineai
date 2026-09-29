"""Only a confirmed current question contributes image input to a model round."""

import asyncio
import hashlib
import io

import pytest
from aidialog.msg_parts import InputImage, Msg, Text
from fastllm.acomplete import Completion
from PIL import Image

from nbinlineai import providers
from nbinlineai.browser_media import MediaError, MediaRegistry
from nbinlineai.prompt import (
    NO_ATTACHMENT,
    _confirmed_attachment,
    preview_context,
    run_prompt,
    validate_request,
)


def png() -> bytes:
    stream = io.BytesIO()
    Image.new('RGB', (2, 2), 'green').save(stream, format='PNG')
    return stream.getvalue()


def snapshot(attachment=None, *, prior=False):
    cells = []
    if prior:
        cells.append({'id': 'old', 'cell_type': 'markdown', 'source': 'Earlier image',
                      'metadata': {'nbinlineai': {'isPromptCell': True,
                                                  'mediaAttachment': {'tampered': True}}}})
    ai = {'isPromptCell': True}
    if attachment is not None:
        ai['mediaAttachment'] = attachment
    cells.append({'id': 'question', 'cell_type': 'markdown', 'source': 'What is shown?',
                  'metadata': {'nbinlineai': ai}})
    return validate_request({'prompt': 'What is shown?', 'session_id': 'session',
                             'prompt_cell_id': 'question', 'snapshot_version': 1,
                             'notebook_cells': cells, 'context_mode': 'current-only',
                             'backend': 'openai_api', 'model': 'gpt-6-sol'}, preview=True)


class NoKernelReferences:
    async def inspect_preview(self, *_):
        raise AssertionError('No kernel references are declared')

    async def inspect(self, *_):
        raise AssertionError('No kernel references are declared')


def test_direct_legacy_prompt_has_no_attachment_but_malformed_current_snapshot_fails():
    legacy = {'prompt_cell_id': 'question',
              'preceding_cells': [{'id': 'old', 'cell_type': 'markdown', 'source': 'Earlier image',
                                   'metadata': {'nbinlineai': {'mediaAttachment': {'tampered': True}}}}]}
    assert _confirmed_attachment(legacy) is NO_ATTACHMENT
    with pytest.raises(TypeError, match='current notebook snapshot'):
        _confirmed_attachment({**legacy, 'snapshot_version': 1})
    with pytest.raises(ValueError, match='missing from the notebook snapshot'):
        _confirmed_attachment({**legacy, 'snapshot_version': 1, 'notebook_cells': []})


def test_saved_image_preview_and_actual_round_reread_exact_current_question(tmp_path, monkeypatch):
    async def check():
        registry = MediaRegistry(tmp_path)
        owner = registry.bind('session', 'kernel', 'notes/example.ipynb', 'model', 'client')
        data = png()
        folder = tmp_path / 'notes'
        folder.mkdir()
        path = folder / 'sample.png'
        path.write_bytes(data)
        reference = {'path': 'notes/sample.png', 'sha256': hashlib.sha256(data).hexdigest()}
        operation = registry.create(owner, 'attach', 'attach_media',
                                    {'media': reference, 'question_cell_id': 'question', 'detail': 'auto'},
                                    waiting=True)
        granted = registry.confirm_attachment(owner, reference, 'question', 'auto', operation.id)
        confirmation = {key: value for key, value in granted.items() if key != 'display'}
        body = snapshot(confirmation, prior=True)
        report = await preview_context(body, NoKernelReferences(), 'kernel', object(),
                                       media_registry=registry, attachment_owner=owner)
        assert 0 < report['round_wire_chars'] <= 64_000
        assert registry.reserved_save_bytes == 0
        sent = []

        async def fake_complete(backend, model, messages, tools, **kwargs):
            sent.append(messages)
            assert registry.reserved_save_bytes == len(data)
            assert backend == 'openai_api' and model == 'gpt-6-sol'
            assert len(messages[-1].content) == 2
            assert isinstance(messages[-1].content[1], InputImage)
            assert 'data:image/png;base64,' in messages[-1].content[1].text
            assert 'data:image' not in messages[-1].content[0].text
            return Completion(model, Msg('assistant', [Text('Green square')]), finish_reason='stop')

        monkeypatch.setattr(providers, 'complete', fake_complete)
        events = [event async for event in run_prompt(body, NoKernelReferences(), 'kernel', object(),
                                                       media_registry=registry, attachment_owner=owner)]
        assert sent and events[-1]['type'] == 'done'
        assert registry.reserved_save_bytes == 0
        path.write_bytes(data + b'changed')
        with pytest.raises(MediaError, match='hash'):
            await preview_context(body, NoKernelReferences(), 'kernel', object(),
                                  media_registry=registry, attachment_owner=owner)
        with pytest.raises(MediaError, match='hash'):
            _ = [event async for event in run_prompt(body, NoKernelReferences(), 'kernel', object(),
                                                     media_registry=registry, attachment_owner=owner)]
        assert len(sent) == 1

    asyncio.run(check())


def test_prior_question_image_never_attaches_to_current_question():
    async def check():
        class RefuseRead:
            def resolve_attachment(self, *_):
                raise AssertionError('Earlier question attachment was read')

        body = snapshot(prior=True)
        report = await preview_context(body, NoKernelReferences(), 'kernel', object(),
                                       media_registry=RefuseRead(), attachment_owner=object())
        assert report['context_budget_chars'] == 64_000

    asyncio.run(check())


def test_cancelled_stream_releases_prepared_image_reservation(tmp_path, monkeypatch):
    async def check():
        registry = MediaRegistry(tmp_path)
        browser = registry.bind('session', 'kernel', 'notes/example.ipynb', 'model', 'client')
        data = png()
        folder = tmp_path / 'notes'
        folder.mkdir()
        (folder / 'sample.png').write_bytes(data)
        reference = {'path': 'notes/sample.png', 'sha256': hashlib.sha256(data).hexdigest()}
        operation = registry.create(browser, 'attach', 'attach_media',
                                    {'media': reference, 'question_cell_id': 'question', 'detail': 'auto'},
                                    waiting=True)
        granted = registry.confirm_attachment(browser, reference, 'question', 'auto', operation.id)
        body = snapshot({key: value for key, value in granted.items() if key != 'display'})

        async def fake_complete(*_args, **_kwargs):
            assert registry.reserved_save_bytes == len(data)

            async def stream():
                yield Text('partial')
                await asyncio.Future()

            return stream()

        monkeypatch.setattr(providers, 'complete', fake_complete)
        events = run_prompt(body, NoKernelReferences(), 'kernel', object(),
                            media_registry=registry, attachment_owner=browser)
        assert (await anext(events))['type'] == 'context'
        assert (await anext(events))['type'] == 'text_delta'
        assert registry.reserved_save_bytes == len(data)
        await events.aclose()
        assert registry.reserved_save_bytes == 0

    asyncio.run(check())
