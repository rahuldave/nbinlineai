"""Server-owned browser operation and media invariants."""

import hashlib
import io

import pytest
from PIL import Image

from nbinlineai.browser_media import MediaError, MediaRegistry


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
    saved = registry.save_media(browser, media['media_id'])
    assert saved['path'].startswith('folder/media/')
    assert (tmp_path / saved['path']).read_bytes() == data
    with pytest.raises(MediaError, match='exists'):
        registry.save_media(browser, media['media_id'], saved['path'])
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
