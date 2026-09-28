"""Server-owned browser operation and media invariants."""

import hashlib
import io
import json

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
