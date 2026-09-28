"""Server-owned browser operation and media invariants."""

import hashlib
import io
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from PIL import Image

from nbinlineai.browser_media import Media, MediaError, MediaRegistry


def owner(registry, client='client', secret=None):
    return registry.bind('session', 'kernel', 'folder/unsaved.ipynb', 'model', client, secret)


def png(size=(2, 2)):
    image = Image.new('RGB', size, 'red')
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()


def test_dedup_owner_and_kernel_binding(tmp_path):
    registry = MediaRegistry(tmp_path)
    first = owner(registry)
    operation = registry.create(first, 'request', 'capture', {'max_size': 1280})
    assert registry.create(first, 'request', 'capture', {'max_size': 1280}) is operation
    with pytest.raises(MediaError, match='different arguments'):
        registry.create(first, 'request', 'capture', {'max_size': 200})
    with pytest.raises(MediaError, match='owner'):
        registry.bind('session', 'kernel', 'folder/unsaved.ipynb', 'model', 'client', 'bad')
    with pytest.raises(MediaError, match='changed'):
        registry.bind('session', 'other-kernel', 'folder/unsaved.ipynb', 'model', 'client', first.secret)
    other = owner(registry, 'other-client')
    with pytest.raises(MediaError, match='unavailable'):
        registry.status(other, operation.id)
    assert owner(registry, secret=first.secret) is first


def test_close_owner_revokes_only_exact_frozen_credential(tmp_path):
    registry = MediaRegistry(tmp_path)
    first = owner(registry)
    other = owner(registry, 'other-client')
    operation = registry.create(first, 'request', 'capture', {})
    with pytest.raises(MediaError, match='unavailable'):
        registry.close_owner(first.session_id, first.client_id, first.model_id, other.secret)
    with pytest.raises(MediaError, match='unavailable'):
        registry.close_owner(first.session_id, first.client_id, 'other-model', first.secret)
    assert first in registry.leases and other in registry.leases
    registry.close_owner(first.session_id, first.client_id, first.model_id, first.secret)
    assert first not in registry.leases and other in registry.leases
    assert operation.status == 'expired'


def test_mixed_case_recording_mime_keeps_memory_caps_and_audio_extension(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    header = b'\x1a\x45\xdf\xa3'
    too_long = registry.create(browser, 'mixed-duration', 'record_microphone', {})
    with pytest.raises(MediaError, match='60 seconds'):
        registry.upload(browser, too_long.id, header, 'Audio/WebM;codecs=opus',
                        hashlib.sha256(header).hexdigest(),
                        metadata={'duration_seconds': 61}, save_to=None)
    too_large = registry.create(browser, 'mixed-size', 'record_microphone', {})
    encoded = header + b'\x00' * (16 * 1024 * 1024)
    with pytest.raises(MediaError, match='16 MiB'):
        registry.upload(browser, too_large.id, encoded, 'Audio/WebM',
                        hashlib.sha256(encoded).hexdigest(), save_to=None)
    saved = registry.create(browser, 'mixed-save', 'record_microphone', {})
    status = registry.upload(browser, saved.id, header, 'Audio/WebM;codecs=opus',
                             hashlib.sha256(header).hexdigest(), save_to='auto')
    assert status['media']['mime_type'] == 'audio/webm;codecs=opus'
    assert status['media']['path'].endswith('.weba')


def test_binary_hash_mime_save_and_release(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    operation = registry.create(browser, 'one', 'capture', {})
    data = png()
    digest = hashlib.sha256(data).hexdigest()
    with pytest.raises(MediaError, match='hash'):
        registry.upload(browser, operation.id, data, 'image/png', '0' * 64)
    with pytest.raises(MediaError, match='MIME'):
        registry.upload(browser, operation.id, data, 'image/jpeg', digest)
    status = registry.upload(browser, operation.id, data, 'image/png', digest)
    media = status['media']
    assert media['bytes'] == len(data) and media['width'] == 2 and media['height'] == 2
    assert not list(tmp_path.rglob('*.png'))
    saved = registry.save_media(browser, media['media_id'], request_id='save-one')
    assert registry.save_media(browser, media['media_id'], request_id='save-one') == saved
    assert saved['path'].startswith('folder/media/')
    assert (tmp_path / saved['path']).read_bytes() == data
    with pytest.raises(MediaError, match='exists'):
        registry.save_media(browser, media['media_id'], saved['path'], request_id='save-two')
    registry.release_media(browser, media['media_id'])
    with pytest.raises(MediaError, match='expired'):
        registry.media_ref(browser, media['media_id'])
    assert (tmp_path / saved['path']).exists()


def test_symlink_escape_and_no_overwrite(tmp_path):
    outside = tmp_path.parent / f'{tmp_path.name}-outside'
    outside.mkdir()
    (tmp_path / 'link').symlink_to(outside, target_is_directory=True)
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'one', 'capture', {})
    data = png()
    digest = hashlib.sha256(data).hexdigest()
    with pytest.raises(MediaError, match='server root'):
        registry.upload(browser, op.id, data, 'image/png', digest, save_to='link/escape.png')
    assert not (outside / 'escape.png').exists()
    op = registry.create(browser, 'two', 'capture', {})
    path = tmp_path / 'existing.png'
    path.write_bytes(b'keep')
    with pytest.raises(MediaError, match='exists'):
        registry.upload(browser, op.id, data, 'image/png', digest, save_to='existing.png')
    assert path.read_bytes() == b'keep'


def test_expiry_and_retention(tmp_path):
    now = [1000.0]
    registry = MediaRegistry(tmp_path, clock=lambda: now[0])
    browser = owner(registry)
    waiting = registry.create(browser, 'wait', 'camera', {}, waiting=True)
    completed = registry.create(browser, 'done', 'capture', {})
    data = png()
    registry.upload(browser, completed.id, data, 'image/png', hashlib.sha256(data).hexdigest())
    now[0] += 95
    registry.sweep()
    assert waiting.status == 'expired'
    assert not registry.media
    assert completed.id in registry.operations
    now[0] += 301
    registry.sweep()
    assert completed.id not in registry.operations


def test_pixel_limit(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'large', 'capture', {})
    data = png((4097, 1))
    with pytest.raises(MediaError, match='pixel limits'):
        registry.upload(browser, op.id, data, 'image/png', hashlib.sha256(data).hexdigest())


def test_batch_upload_and_directory_save(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'batch', 'extract_frames', {})
    registry.begin_batch(browser, op.id, 2)
    first = png((2, 2))
    second = png((3, 3))
    assert registry.upload_part(browser, op.id, 0, first, 'image/png', hashlib.sha256(first).hexdigest())['status'] == 'running'
    assert registry.upload_part(browser, op.id, 0, first, 'image/png', hashlib.sha256(first).hexdigest())['result']['media_count'] == 1
    with pytest.raises(MediaError, match='changed'):
        registry.upload_part(browser, op.id, 0, first, 'image/jpeg', hashlib.sha256(first).hexdigest())
    with pytest.raises(MediaError, match='changed'):
        registry.upload_part(browser, op.id, 0, second, 'image/png', hashlib.sha256(second).hexdigest())
    registry.upload_part(browser, op.id, 1, second, 'image/png', hashlib.sha256(second).hexdigest())
    done = registry.finish_batch(browser, op.id, 'frames')
    assert done['status'] == 'completed'
    assert [item['path'] for item in done['media']] == ['frames/part-01.png', 'frames/part-02.png']
    assert (tmp_path / 'frames/part-01.png').read_bytes() == first
    assert (tmp_path / 'frames/part-02.png').read_bytes() == second
    assert registry.finish_batch(browser, op.id, 'frames') == done
    with pytest.raises(MediaError, match='destination changed'):
        registry.finish_batch(browser, op.id, 'other-frames')


def test_metadata_spoof_and_state_guards(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'one', 'capture', {})
    with pytest.raises(MediaError, match='needs a result'):
        registry.transition(browser, op.id, 'completed')
    with pytest.raises(MediaError, match='reserved'):
        registry.transition(browser, op.id, 'completed', {'path': 'fake.png'})
    data = png()
    with pytest.raises(MediaError, match='unsupported fields'):
        registry.upload(browser, op.id, data, 'image/png', hashlib.sha256(data).hexdigest(),
                        metadata={'path': 'fake.png'})
    done = registry.upload(browser, op.id, data, 'image/png', hashlib.sha256(data).hexdigest())
    assert registry.upload(browser, op.id, data, 'image/png', hashlib.sha256(data).hexdigest()) == done
    with pytest.raises(MediaError, match='changed'):
        registry.upload(browser, op.id, png((3, 3)), 'image/png', hashlib.sha256(png((3, 3))).hexdigest())


def test_cancelled_staged_save_leaves_no_file(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = png()
    media = Media('fixture', browser, data, 'image/png', hashlib.sha256(data).hexdigest(), 2000.0)
    with pytest.raises(MediaError, match='cancelled'):
        registry._save(browser, media, 'cancelled.png', lambda: False)
    assert not (tmp_path / 'cancelled.png').exists()
    assert not list(tmp_path.glob('*.part'))


def test_batch_status_pages_descriptors(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'batch-pages', 'extract_frames', {})
    registry.begin_batch(browser, op.id, 12)
    for index in range(12):
        data = png((index + 1, 1))
        registry.upload_part(browser, op.id, index, data, 'image/png', hashlib.sha256(data).hexdigest())
        registry.media[op.batch_media_ids[-1]].path = 'long/' + 'a' * 440 + f'{index}.png'
    state = registry.finish_batch(browser, op.id)
    all_media = list(state['media'])
    cursor = state.get('next_media_cursor')
    assert cursor is not None
    while cursor is not None:
        page = registry.media_page(browser, op.id, cursor)
        assert len(json.dumps(page)) <= 3500
        all_media.extend(page['media'])
        cursor = page['next_media_cursor']
    assert len({item['media_id'] for item in all_media}) == 12
    assert len(json.dumps(state)) <= 3500


def test_batch_save_conflict_rolls_back_new_files(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'conflicting-batch', 'extract_frames', {})
    registry.begin_batch(browser, op.id, 2)
    data = png()
    for index in range(2):
        registry.upload_part(browser, op.id, index, data, 'image/png', hashlib.sha256(data).hexdigest())
    (tmp_path / 'frames').mkdir()
    (tmp_path / 'frames' / 'part-02.png').write_bytes(b'preexisting')
    with pytest.raises(MediaError, match='exists'):
        registry.finish_batch(browser, op.id, 'frames')
    assert not (tmp_path / 'frames' / 'part-01.png').exists()
    assert (tmp_path / 'frames' / 'part-02.png').read_bytes() == b'preexisting'
    assert not list((tmp_path / 'frames').glob('*.part'))
    assert op.status == 'failed'


def test_batch_cancel_discards_partial_media(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'cancel-batch', 'extract_frames', {})
    registry.begin_batch(browser, op.id, 2)
    data = png()
    registry.upload_part(browser, op.id, 0, data, 'image/png', hashlib.sha256(data).hexdigest())
    assert registry.cancel(browser, op.id)['status'] == 'cancelled'
    assert not registry.media
    assert not list(tmp_path.rglob('*.png'))


def test_exact_saved_media_ref_and_symlink_rejection(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = png()
    (tmp_path / 'saved.png').write_bytes(data)
    reference = {'path': 'saved.png', 'sha256': hashlib.sha256(data).hexdigest()}
    assert registry.resolve_ref(browser, reference) == (data, 'image/png', reference['sha256'])
    (tmp_path / 'saved.png').write_bytes(png((3, 3)))
    with pytest.raises(MediaError, match='hash changed'):
        registry.resolve_ref(browser, reference)
    outside = tmp_path.parent / f'{tmp_path.name}-outside-file.png'
    outside.write_bytes(data)
    (tmp_path / 'linked.png').symlink_to(outside)
    with pytest.raises(MediaError, match='unavailable'):
        registry.resolve_ref(browser, {'path': 'linked.png', 'sha256': reference['sha256']})


def test_saved_file_ref_copy_release_and_exact_dedup(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = png()
    (tmp_path / 'original.png').write_bytes(data)
    reference = {'path': 'original.png', 'sha256': hashlib.sha256(data).hexdigest()}
    first = registry.save_media(browser, reference, request_id='same')
    assert first == registry.save_media(browser, reference, request_id='same')
    assert len(list(tmp_path.rglob('capture-*.png'))) == 1
    second = registry.save_media(browser, reference, request_id='different')
    assert second['path'] != first['path']
    assert registry.media[first['media_id']].path == first['path']
    registry.release_media(browser, first['media_id'])
    assert (tmp_path / first['path']).read_bytes() == data
    assert (tmp_path / second['path']).read_bytes() == data
    with pytest.raises(MediaError, match='different arguments'):
        registry.save_media(browser, reference, 'other.png', request_id='same')


def test_nonfilesystem_backend_keeps_memory_media_and_reports_unsupported_save():
    registry = MediaRegistry(None)
    browser = owner(registry)
    assert registry.file_media_supported() is False
    operation = registry.create(browser, 'memory-only', 'fixture_image', {})
    data = png()
    status = registry.upload(browser, operation.id, data, 'image/png', hashlib.sha256(data).hexdigest())
    assert status['status'] == 'completed'
    assert status['media']['bytes'] == len(data)
    with pytest.raises(MediaError) as failure:
        registry.save_media(browser, {'media_id': status['media']['media_id']}, request_id='cannot-save')
    assert failure.value.code == 'unsupported'


def test_cancelled_save_preflight_does_not_strand_duplicate_request(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    reference = {'media_id': 'unused'}
    operation = registry.create(browser, 'cancel-before-save', 'save_media',
                                {'media': reference, 'save_to': 'auto'})
    registry.cancel(browser, operation.id)
    for _ in range(2):
        with pytest.raises(MediaError, match='already ended'):
            registry.save_media(browser, reference, request_id='cancel-before-save')
        assert (browser, 'cancel-before-save') not in registry.save_flights


def test_same_notebook_file_saves_share_reserved_budget(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    first_owner = owner(registry)
    second_owner = owner(registry, 'second-client')
    data = png()
    (tmp_path / 'source.png').write_bytes(data)
    reference = {'path': 'source.png', 'sha256': hashlib.sha256(data).hexdigest()}
    monkeypatch.setattr('nbinlineai.browser_media.MAX_NOTEBOOK_BYTES', len(data) + 1)
    entered = threading.Event()
    resume = threading.Event()
    real_save = registry._save

    def stalled(*args, **kwargs):
        entered.set()
        assert resume.wait(3)
        return real_save(*args, **kwargs)

    monkeypatch.setattr(registry, '_save', stalled)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(registry.save_media, first_owner, reference, 'auto', 'first')
        assert entered.wait(3)
        with pytest.raises(MediaError, match='memory limit'):
            registry.save_media(second_owner, reference, request_id='second')
        single = registry.create(second_owner, 'single-during-save', 'fixture_image', {})
        with pytest.raises(MediaError, match='memory limit'):
            registry.upload(second_owner, single.id, data, 'image/png', reference['sha256'])
        batch = registry.create(second_owner, 'batch-during-save', 'extract_frames', {})
        registry.begin_batch(second_owner, batch.id, 1)
        with pytest.raises(MediaError, match='memory limit'):
            registry.upload_part(second_owner, batch.id, 0, data, 'image/png', reference['sha256'])
        resume.set()
        saved = pending.result(timeout=3)
    assert (tmp_path / saved['path']).read_bytes() == data
    assert registry.reserved_save_bytes == 0
    assert registry.reserved_save_by_session == {}


def test_concurrent_sweep_create_cancel_and_expire_while_save_is_staged(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    saving_owner = owner(registry)
    churn_owner = owner(registry, 'churn-client')
    data = png()
    (tmp_path / 'source.png').write_bytes(data)
    reference = {'path': 'source.png', 'sha256': hashlib.sha256(data).hexdigest()}
    entered = threading.Event()
    resume = threading.Event()
    real_save = registry._save

    def stalled(*args, **kwargs):
        entered.set()
        assert resume.wait(3)
        return real_save(*args, **kwargs)

    monkeypatch.setattr(registry, '_save', stalled)

    def churn():
        for index in range(50):
            op = registry.create(churn_owner, f'churn-{index}', 'fixture_pending', {})
            registry.cancel(churn_owner, op.id)
            registry.sweep()
        registry.expire_owner(churn_owner)

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(registry.save_media, saving_owner, reference, 'auto', 'staged')
        assert entered.wait(3)
        pool.submit(churn).result(timeout=3)
        registry.expire_owner(saving_owner)
        resume.set()
        with pytest.raises(MediaError, match='cancelled'):
            pending.result(timeout=3)
    assert not list(tmp_path.rglob('capture-*.png'))
    assert not registry.media


def test_direct_upload_save_cancel_rolls_back_published_file(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    operation = registry.create(browser, 'direct-save', 'fixture_image', {})
    data = png()
    digest = hashlib.sha256(data).hexdigest()
    entered = threading.Event()
    resume = threading.Event()
    real_save = registry._save

    def stalled(*args, **kwargs):
        entered.set()
        assert resume.wait(3)
        return real_save(*args, **kwargs)

    monkeypatch.setattr(registry, '_save', stalled)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(registry.upload, browser, operation.id, data, 'image/png', digest,
                              save_to='auto')
        assert entered.wait(3)
        registry.cancel(browser, operation.id)
        resume.set()
        with pytest.raises(MediaError, match='cancelled'):
            pending.result(timeout=3)
    assert registry.status(browser, operation.id)['status'] == 'cancelled'
    assert not list(tmp_path.rglob('capture-*.png'))


def test_concurrent_save_request_publishes_once_and_owner_loss_cancels(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = png()
    (tmp_path / 'source.png').write_bytes(data)
    reference = {'path': 'source.png', 'sha256': hashlib.sha256(data).hexdigest()}
    entered = threading.Event()
    resume = threading.Event()
    real_save = registry._save

    def stalled(*args, **kwargs):
        entered.set()
        assert resume.wait(3)
        return real_save(*args, **kwargs)

    monkeypatch.setattr(registry, '_save', stalled)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(registry.save_media, browser, reference, 'auto', 'one')
        assert entered.wait(3)
        second = pool.submit(registry.save_media, browser, reference, 'auto', 'one')
        resume.set()
        assert first.result(timeout=3) == second.result(timeout=3)
    assert len(list(tmp_path.rglob('capture-*.png'))) == 1

    entered.clear()
    resume.clear()
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(registry.save_media, browser, reference, 'auto', 'two')
        assert entered.wait(3)
        registry.expire_owner(browser)
        resume.set()
        with pytest.raises(MediaError, match='cancelled'):
            pending.result(timeout=3)
    assert len(list(tmp_path.rglob('capture-*.png'))) == 1


def test_batch_cancel_during_save_cannot_complete_or_leave_file(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'batch-cancel-race', 'extract_frames', {})
    registry.begin_batch(browser, op.id, 1)
    data = png()
    registry.upload_part(browser, op.id, 0, data, 'image/png', hashlib.sha256(data).hexdigest())
    entered = threading.Event()
    resume = threading.Event()
    real_save = registry._save

    def stalled(*args, **kwargs):
        entered.set()
        assert resume.wait(3)
        return real_save(*args, **kwargs)

    monkeypatch.setattr(registry, '_save', stalled)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(registry.finish_batch, browser, op.id, 'frames')
        assert entered.wait(3)
        assert registry.cancel(browser, op.id)['status'] == 'cancelled'
        resume.set()
        with pytest.raises(MediaError, match='cancelled'):
            pending.result(timeout=3)
    assert op.status == 'cancelled'
    assert not list(tmp_path.rglob('*.png'))


@pytest.mark.skipif(os.name != 'posix', reason='FIFO needs POSIX')
def test_saved_media_ref_rejects_fifo_without_blocking(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    os.mkfifo(tmp_path / 'pipe.png')
    with ThreadPoolExecutor(max_workers=1) as pool:
        result = pool.submit(registry.resolve_ref, browser, {'path': 'pipe.png', 'sha256': '0' * 64})
        with pytest.raises(MediaError, match='regular file'):
            result.result(timeout=2)


def test_rollback_preserves_replaced_file(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = png()
    media = Media('rollback', browser, data, 'image/png', hashlib.sha256(data).hexdigest(), 2000.0)
    path = registry._save(browser, media, 'frames/part-01.png')
    replacement = tmp_path / 'replacement.png'
    replacement.write_bytes(b'replacement')
    os.replace(replacement, tmp_path / path)
    registry._unlink_saved(path)
    assert (tmp_path / path).read_bytes() == b'replacement'


def test_media_root_ancestor_swap_cannot_redirect_saved_or_read_bytes(tmp_path, monkeypatch):
    base = tmp_path / 'base'
    root = base / 'root'
    root.mkdir(parents=True)
    outside = tmp_path / 'outside'
    (outside / 'root').mkdir(parents=True)
    registry = MediaRegistry(root)
    browser = owner(registry)
    data = png()
    digest = hashlib.sha256(data).hexdigest()
    media = Media('root-swap', browser, data, 'image/png', digest, registry._now() + 600)
    original_destination = registry._destination

    def swap_after_validation(*args, **kwargs):
        destination = original_destination(*args, **kwargs)
        base.rename(tmp_path / 'parked')
        base.symlink_to(outside, target_is_directory=True)
        return destination

    monkeypatch.setattr(registry, '_destination', swap_after_validation)
    with pytest.raises(MediaError, match='root changed|cancelled'):
        registry._save(browser, media, 'attack.png')
    assert not (outside / 'root' / 'attack.png').exists()
    assert not (tmp_path / 'parked' / 'root' / 'attack.png').exists()
    (outside / 'root' / 'source.png').write_bytes(data)
    with pytest.raises(MediaError, match='root changed'):
        registry.resolve_ref(browser, {'path': 'source.png', 'sha256': digest})


def test_post_publish_temporary_cleanup_failure_rolls_back_final(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    data = png()
    media = Media('part-cleanup', browser, data, 'image/png', hashlib.sha256(data).hexdigest(),
                  registry._now() + 600)
    actual_unlink = os.unlink
    failed = False

    def fail_once(path, *args, **kwargs):
        nonlocal failed
        if not failed and isinstance(path, str) and path.endswith('.part'):
            failed = True
            raise OSError('temporary cleanup failed')
        return actual_unlink(path, *args, **kwargs)

    monkeypatch.setattr(os, 'unlink', fail_once)
    with pytest.raises(MediaError, match='safely save'):
        registry._save(browser, media, 'saved.png')
    assert failed
    assert not (tmp_path / 'saved.png').exists()
    assert not list(tmp_path.glob('.nbinlineai-*.part'))
    assert not registry._published_inodes


def test_auto_directory_freezes_per_request_across_notebook_rename(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    before = registry.create(browser, 'before', 'capture', {})
    registry.bind('session', 'kernel', 'renamed/new.ipynb', 'model', 'client', browser.secret)
    after = registry.create(browser, 'after', 'capture', {})
    data = png()
    digest = hashlib.sha256(data).hexdigest()
    first = registry.upload(browser, before.id, data, 'image/png', digest, save_to='auto')
    second = registry.upload(browser, after.id, data, 'image/png', digest, save_to='auto')
    assert first['media']['path'].startswith('folder/media/')
    assert second['media']['path'].startswith('renamed/media/')

    source = tmp_path / 'source.png'
    source.write_bytes(data)
    reference = {'path': source.name, 'sha256': digest}
    saved = registry.save_media(browser, reference, request_id='file-before')
    registry.bind('session', 'kernel', 'later/moved.ipynb', 'model', 'client', browser.secret)
    assert registry.save_media(browser, reference, request_id='file-before') == saved
    newest = registry.save_media(browser, reference, request_id='file-after')
    assert saved['path'].startswith('renamed/media/')
    assert newest['path'].startswith('later/media/')


def test_batch_rollback_uses_original_directory_after_symlink_swap(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    op = registry.create(browser, 'batch-swap', 'extract_frames', {})
    registry.begin_batch(browser, op.id, 2)
    data = png()
    for index in range(2):
        registry.upload_part(browser, op.id, index, data, 'image/png', hashlib.sha256(data).hexdigest())
    outside = tmp_path.parent / f'{tmp_path.name}-victim'
    outside.mkdir()
    (outside / 'part-01.png').write_bytes(b'victim')
    real_save = registry._save
    calls = [0]

    def swap_after_first(*args, **kwargs):
        calls[0] += 1
        if calls[0] == 2:
            (tmp_path / 'frames').rename(tmp_path / 'frames-original')
            (tmp_path / 'frames').symlink_to(outside, target_is_directory=True)
            raise MediaError('path_conflict', 'Destination already exists')
        return real_save(*args, **kwargs)

    monkeypatch.setattr(registry, '_save', swap_after_first)
    with pytest.raises(MediaError, match='exists'):
        registry.finish_batch(browser, op.id, 'frames')
    assert not (tmp_path / 'frames-original' / 'part-01.png').exists()
    assert (outside / 'part-01.png').read_bytes() == b'victim'
