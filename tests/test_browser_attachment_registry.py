"""Attachment grants bind exact still bytes to the originating AI question."""

import hashlib
import io

import pytest
from PIL import Image

from nbinlineai.browser_attachment import validate_confirmation
from nbinlineai.browser_media import MediaError, MediaRegistry


def image_bytes() -> bytes:
    stream = io.BytesIO()
    Image.new('RGB', (3, 2), 'red').save(stream, format='PNG')
    return stream.getvalue()


def owner(registry, client='client', secret=None):
    return registry.bind('session', 'kernel', 'notes/example.ipynb', 'model', client, secret)


def waiting(registry, browser, media, request='attach', detail='auto'):
    args = {'media': media, 'question_cell_id': 'question', 'detail': detail}
    return registry.create(browser, request, 'attach_media', args, waiting=True)


def test_memory_grant_is_question_and_owner_bound_and_release_revokes(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = image_bytes()
    digest = hashlib.sha256(data).hexdigest()
    produced = registry.create(browser, 'produced', 'capture_camera', {})
    media = registry.upload(browser, produced.id, data, 'image/png', digest)['media']
    ref = {'media_id': media['media_id']}
    operation = waiting(registry, browser, ref)
    result = registry.confirm_attachment(browser, ref, 'question', 'auto', operation.id)
    assert result['display'] == {'mime_type': 'image/png', 'bytes': len(data), 'width': 3, 'height': 2}
    confirmation = {key: value for key, value in result.items() if key != 'display'}
    assert validate_confirmation(confirmation, 'question') == confirmation
    assert registry.confirm_attachment(browser, ref, 'question', 'auto', operation.id) == result
    with pytest.raises(MediaError, match='expired'):
        registry.resolve_attachment(browser, 'question', confirmation)
    registry.transition(browser, operation.id, 'completed', {'confirmed': True})
    with pytest.raises(MediaError, match='ended'):
        registry.confirm_attachment(browser, ref, 'question', 'auto', operation.id)
    assert registry.resolve_attachment(browser, 'question', confirmation) == (data, 'image/png', 'auto')
    with pytest.raises(MediaError, match='question'):
        registry.resolve_attachment(browser, 'other-question', confirmation)
    with pytest.raises(MediaError, match='expired'):
        registry.resolve_attachment(owner(registry, 'other'), 'question', confirmation)
    registry.release_media(browser, media['media_id'])
    with pytest.raises(MediaError, match='expired'):
        registry.resolve_attachment(browser, 'question', confirmation)


def test_saved_confirmation_survives_owner_reopen_but_detects_changed_file(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = image_bytes()
    path = tmp_path / 'notes' / 'sample.png'
    path.parent.mkdir()
    path.write_bytes(data)
    reference = {'path': 'notes/sample.png', 'sha256': hashlib.sha256(data).hexdigest()}
    operation = waiting(registry, browser, reference, detail='high')
    result = registry.confirm_attachment(browser, reference, 'question', 'high', operation.id)
    confirmation = {key: value for key, value in result.items() if key != 'display'}
    assert confirmation['kind'] == 'saved'
    registry.expire_owner(browser)
    reopened = owner(registry, 'reopened')
    assert registry.resolve_attachment(reopened, 'question', confirmation) == (data, 'image/png', 'high')
    path.write_bytes(image_bytes() + b'changed')
    with pytest.raises(MediaError, match='hash'):
        registry.resolve_attachment(reopened, 'question', confirmation)


def test_cancelled_or_changed_operation_cannot_mint_grant(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = image_bytes()
    digest = hashlib.sha256(data).hexdigest()
    path = tmp_path / 'notes' / 'sample.png'
    path.parent.mkdir()
    path.write_bytes(data)
    reference = {'path': 'notes/sample.png', 'sha256': digest}
    operation = waiting(registry, browser, reference)
    original = registry.resolve_ref

    def cancel_during_read(*args, **kwargs):
        result = original(*args, **kwargs)
        registry.cancel(browser, operation.id)
        return result

    monkeypatch.setattr(registry, 'resolve_ref', cancel_during_read)
    with pytest.raises(MediaError, match='ended or changed'):
        registry.confirm_attachment(browser, reference, 'question', 'auto', operation.id)
    assert not registry.attachment_requests
    monkeypatch.setattr(registry, 'resolve_ref', original)
    other = waiting(registry, browser, reference, 'different')
    with pytest.raises(MediaError, match='does not match'):
        registry.confirm_attachment(browser, reference, 'question', 'low', other.id)


def test_non_still_and_tampered_metadata_fail_closed(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    path = tmp_path / 'notes' / 'drawing.svg'
    path.parent.mkdir()
    path.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    reference = {'path': 'notes/drawing.svg', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    operation = waiting(registry, browser, reference)
    with pytest.raises(MediaError) as error:
        registry.confirm_attachment(browser, reference, 'question', 'auto', operation.id)
    assert error.value.code == 'provider_unsupported'
    with pytest.raises(MediaError):
        validate_confirmation({'version': 1, 'kind': 'saved', 'question_cell_id': 'question',
                               'path': 'notes/drawing.svg', 'sha256': reference['sha256'],
                               'detail': 'auto', 'owner_secret': 'never'}, 'question')


def test_memory_grants_reuse_exact_confirmation_and_cap_per_question(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    grants = []
    for index in range(5):
        image = io.BytesIO()
        Image.new('RGB', (3, 2), (index * 30, 0, 0)).save(image, format='PNG')
        data = image.getvalue()
        produced = registry.create(browser, f'produced-{index}', 'capture_camera', {})
        media = registry.upload(browser, produced.id, data, 'image/png',
                                hashlib.sha256(data).hexdigest())['media']
        ref = {'media_id': media['media_id']}
        operation = waiting(registry, browser, ref, f'attach-{index}')
        if index == 4:
            with pytest.raises(MediaError, match='Too many pending'):
                registry.confirm_attachment(browser, ref, 'question', 'auto', operation.id)
        else:
            grants.append(registry.confirm_attachment(browser, ref, 'question', 'auto', operation.id))
    first = {'media_id': next(grant.media_id for grant in registry.attachment_grants.values()
                             if grant.id == grants[0]['grant_id'])}
    retry = waiting(registry, browser, first, 'attach-again')
    assert registry.confirm_attachment(browser, first, 'question', 'auto', retry.id)['grant_id'] == grants[0]['grant_id']
    with pytest.raises(MediaError, match='unavailable'):
        registry.revoke_attachment(owner(registry, 'other'), 'question', grants[0]['grant_id'])
    registry.revoke_attachment(browser, 'question', grants[0]['grant_id'])
    with pytest.raises(MediaError, match='expired'):
        registry.resolve_attachment(browser, 'question', {key: value for key, value in grants[0].items()
                                                          if key != 'display'})
    assert len(registry.attachment_grants) == 3
    replacement = waiting(registry, browser, first, 'attach-after-remove')
    assert registry.confirm_attachment(browser, first, 'question', 'auto', replacement.id)['grant_id'] != grants[0]['grant_id']


def test_attachment_read_reservation_lives_until_closed(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = image_bytes()
    path = tmp_path / 'notes' / 'sample.png'
    path.parent.mkdir()
    path.write_bytes(data)
    reference = {'path': 'notes/sample.png', 'sha256': hashlib.sha256(data).hexdigest()}
    operation = waiting(registry, browser, reference)
    result = registry.confirm_attachment(browser, reference, 'question', 'auto', operation.id)
    registry.transition(browser, operation.id, 'completed', {'confirmed': True})
    confirmation = {key: value for key, value in result.items() if key != 'display'}
    read = registry.acquire_attachment(browser, 'question', confirmation)
    assert read.data == data
    assert registry.reserved_save_bytes == len(data)
    read.close()
    read.close()
    assert registry.reserved_save_bytes == 0


@pytest.mark.parametrize('ending', ['cancelled', 'failed', 'expired'])
def test_unsuccessful_confirmation_releases_only_its_pending_grants(tmp_path, ending):
    moment = [0.0]
    registry = MediaRegistry(tmp_path, clock=lambda: moment[0])
    browser = owner(registry)
    pending = []
    for index in range(4):
        image = io.BytesIO()
        Image.new('RGB', (3, 2), (index * 30, 0, 0)).save(image, format='PNG')
        data = image.getvalue()
        produced = registry.create(browser, f'produced-{index}', 'capture_camera', {})
        media = registry.upload(browser, produced.id, data, 'image/png',
                                hashlib.sha256(data).hexdigest())['media']
        ref = {'media_id': media['media_id']}
        operation = waiting(registry, browser, ref, f'attach-{index}')
        registry.confirm_attachment(browser, ref, 'question', 'auto', operation.id)
        pending.append((operation, ref))
    assert len(registry.attachment_grants) == 4
    if ending == 'expired':
        moment[0] = 80
        registry.heartbeat(browser)
        moment[0] = 121
        registry.sweep()
    else:
        for operation, _ in pending:
            if ending == 'cancelled':
                registry.cancel(browser, operation.id)
            else:
                registry.transition(browser, operation.id, 'failed', error={
                    'code': 'stale_target', 'message': 'Question changed'})
    assert not registry.attachment_grants
    assert not registry.attachment_requests
    for operation, ref in pending:
        with pytest.raises(MediaError, match='ended or expired'):
            registry.confirm_attachment(browser, ref, 'question', 'auto', operation.id)
    replacement = waiting(registry, browser, pending[0][1], 'attach-after-' + ending)
    accepted = registry.confirm_attachment(browser, pending[0][1], 'question', 'auto', replacement.id)
    assert accepted['grant_id'] in registry.attachment_grants


def test_failed_replacement_keeps_reused_successful_and_other_pending_grants(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = image_bytes()
    produced = registry.create(browser, 'produced', 'capture_camera', {})
    media = registry.upload(browser, produced.id, data, 'image/png',
                            hashlib.sha256(data).hexdigest())['media']
    ref = {'media_id': media['media_id']}
    first = waiting(registry, browser, ref, 'first')
    accepted = registry.confirm_attachment(browser, ref, 'question', 'auto', first.id)
    second = waiting(registry, browser, ref, 'second')
    assert registry.confirm_attachment(browser, ref, 'question', 'auto', second.id)['grant_id'] == accepted['grant_id']
    registry.cancel(browser, first.id)
    assert accepted['grant_id'] in registry.attachment_grants
    registry.transition(browser, second.id, 'completed', {'confirmed': True})
    third = waiting(registry, browser, ref, 'third')
    assert registry.confirm_attachment(browser, ref, 'question', 'auto', third.id)['grant_id'] == accepted['grant_id']
    registry.transition(browser, third.id, 'failed', error={'code': 'stale_target', 'message': 'Changed'})
    assert registry.resolve_attachment(browser, 'question',
                                       {key: value for key, value in accepted.items() if key != 'display'}) == (
                                           data, 'image/png', 'auto')
