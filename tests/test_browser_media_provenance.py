"""Derivative provenance and saved sidecars share the anchored media transaction."""

import hashlib
import io
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from PIL import Image

from nbinlineai.browser_media import Media, MediaError, MediaRegistry


def png(color='red'):
    image = Image.new('RGB', (2, 2), color)
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()


def owner(registry):
    return registry.bind('session', 'kernel', 'fixture.ipynb', 'model', 'client')


def source_media(registry, browser, data=None):
    data = data or png()
    digest = hashlib.sha256(data).hexdigest()
    registry.media['source'] = Media('source', browser, data, 'image/png', digest,
                                     registry._now() + 600)
    return digest


def crop_args(save_to=None):
    return {'media': {'media_id': 'source'}, 'x': 0, 'y': 0, 'width': 2,
            'height': 2, 'save_to': save_to}


def test_saved_crop_writes_exact_sidecar_and_preserves_source(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    source_hash = source_media(registry, browser)
    source_before = registry.media['source'].data
    output = png('blue')
    output_hash = hashlib.sha256(output).hexdigest()
    op = registry.create(browser, 'crop', 'crop_image', crop_args('derived.png'))
    state = registry.upload(browser, op.id, output, 'image/png', output_hash,
                            metadata={'source_sha256': source_hash, 'transform': 'crop_image'},
                            save_to='derived.png')
    assert state['status'] == 'completed'
    assert state['media']['path'] == 'derived.png'
    assert state['media']['sidecar_path'] == 'derived.png.json'
    assert (tmp_path / 'derived.png').read_bytes() == output
    sidecar = json.loads((tmp_path / 'derived.png.json').read_text())
    assert sidecar == {'version': 1, 'source_sha256': source_hash, 'transform': 'crop_image',
                       'parameters': {'x': 0, 'y': 0, 'width': 2, 'height': 2},
                       'output_sha256': output_hash, 'output_mime_type': 'image/png',
                       'output_bytes': len(output)}
    assert registry.media['source'].data == source_before
    assert not (tmp_path / 'source.png.json').exists()


def test_memory_derivative_has_no_sidecar_until_explicit_later_save(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    source_hash = source_media(registry, browser)
    output = png('green')
    op = registry.create(browser, 'memory-crop', 'crop_image', crop_args())
    state = registry.upload(browser, op.id, output, 'image/png', hashlib.sha256(output).hexdigest(),
                            metadata={'source_sha256': source_hash, 'transform': 'crop_image'})
    assert state['status'] == 'completed'
    assert not list(tmp_path.rglob('*.json'))
    saved = registry.save_media(browser, {'media_id': state['media']['media_id']},
                                'later.png', 'later-save')
    assert saved['path'] == 'later.png'
    assert saved['sidecar_path'] == 'later.png.json'
    assert (tmp_path / 'later.png').read_bytes() == output


def test_frame_batch_paginated_descriptors_keep_actual_times_and_sidecars(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    clip = b'\x1aE\xdf\xa3fixture-webm'
    source_hash = hashlib.sha256(clip).hexdigest()
    registry.media['source'] = Media('source', browser, clip, 'video/webm', source_hash,
                                     registry._now() + 600)
    op = registry.create(browser, 'frames', 'extract_frames', {
        'media': {'media_id': 'source'}, 'timestamps': [0, 0.5], 'save_to': 'frames'})
    registry.begin_batch(browser, op.id, 2)
    for index, actual in enumerate((0.01, 0.51)):
        data = png('red' if index == 0 else 'blue')
        registry.upload_part(browser, op.id, index, data, 'image/png', hashlib.sha256(data).hexdigest(),
                             metadata={'source_sha256': source_hash, 'transform': 'extract_frames',
                                       'actual_seconds': actual})
    state = registry.finish_batch(browser, op.id, 'frames')
    assert state['status'] == 'completed'
    assert [item['actual_seconds'] for item in state['media']] == [0.01, 0.51]
    assert [item['path'] for item in state['media']] == ['frames/part-01.png', 'frames/part-02.png']
    for index, descriptor in enumerate(state['media']):
        sidecar = json.loads((tmp_path / descriptor['sidecar_path']).read_text())
        assert sidecar['parameters'] == {'requested_seconds': [0, 0.5][index],
                                         'actual_seconds': descriptor['actual_seconds'],
                                         'frame_index': index}
        assert sidecar['output_sha256'] == descriptor['sha256']


@pytest.mark.parametrize('metadata', [
    {}, {'source_sha256': '0' * 64, 'transform': 'crop_image'},
    {'source_sha256': 'a' * 64, 'transform': 'annotate_image'},
    {'source_sha256': 'a' * 64, 'transform': 'crop_image', 'actual_seconds': 0},
])
def test_bad_or_spoofed_crop_provenance_is_rejected(tmp_path, metadata):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    source_hash = source_media(registry, browser)
    metadata = {key: source_hash if value == 'a' * 64 else value for key, value in metadata.items()}
    op = registry.create(browser, 'bad-crop', 'crop_image', crop_args())
    data = png()
    with pytest.raises(MediaError, match='Invalid|changed|unsupported'):
        registry.upload(browser, op.id, data, 'image/png', hashlib.sha256(data).hexdigest(),
                        metadata=metadata)
    assert not list(tmp_path.rglob('*.png'))


def test_saved_sidecar_conflict_leaves_preexisting_file_and_no_derivative(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    source_hash = source_media(registry, browser)
    (tmp_path / 'derived.png.json').write_bytes(b'preexisting')
    op = registry.create(browser, 'conflict', 'crop_image', crop_args('derived.png'))
    data = png()
    with pytest.raises(MediaError, match='exists'):
        registry.upload(browser, op.id, data, 'image/png', hashlib.sha256(data).hexdigest(),
                        metadata={'source_sha256': source_hash, 'transform': 'crop_image'},
                        save_to='derived.png')
    assert not (tmp_path / 'derived.png').exists()
    assert (tmp_path / 'derived.png.json').read_bytes() == b'preexisting'


def test_batch_second_child_conflict_rolls_back_files_and_sidecars(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    source_hash = source_media(registry, browser)
    op = registry.create(browser, 'batch-conflict', 'extract_frames', {
        'media': {'media_id': 'source'}, 'timestamps': [0, 0.5], 'save_to': 'frames'})
    registry.begin_batch(browser, op.id, 2)
    data = png()
    for index in range(2):
        registry.upload_part(browser, op.id, index, data, 'image/png', hashlib.sha256(data).hexdigest(),
                             metadata={'source_sha256': source_hash, 'transform': 'extract_frames',
                                       'actual_seconds': index * 0.5})
    (tmp_path / 'frames').mkdir()
    (tmp_path / 'frames/part-02.png').write_bytes(b'preexisting')
    with pytest.raises(MediaError, match='exists'):
        registry.finish_batch(browser, op.id, 'frames')
    assert not (tmp_path / 'frames/part-01.png').exists()
    assert not (tmp_path / 'frames/part-01.png.json').exists()
    assert not (tmp_path / 'frames/part-02.png.json').exists()
    assert (tmp_path / 'frames/part-02.png').read_bytes() == b'preexisting'


def test_frozen_destination_and_released_source_are_rejected(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    digest = source_media(registry, browser)
    op = registry.create(browser, 'frozen', 'crop_image', crop_args('approved.png'))
    data = png()
    with pytest.raises(MediaError, match='destination changed'):
        registry.upload(browser, op.id, data, 'image/png', hashlib.sha256(data).hexdigest(),
                        metadata={'source_sha256': digest, 'transform': 'crop_image'},
                        save_to='other.png')
    registry.release_media(browser, 'source')
    with pytest.raises(MediaError) as error:
        registry.upload(browser, op.id, data, 'image/png', hashlib.sha256(data).hexdigest(),
                        metadata={'source_sha256': digest, 'transform': 'crop_image'},
                        save_to='approved.png')
    assert error.value.code == 'stale_target'
    assert not list(tmp_path.rglob('*.png'))


def test_release_during_frame_pixel_verification_rejects_batch_part(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    source_hash = source_media(registry, browser)
    op = registry.create(browser, 'release-during-frame', 'extract_frames', {
        'media': {'media_id': 'source'}, 'timestamps': [0.5], 'save_to': None})
    registry.begin_batch(browser, op.id, 1)
    data = png('blue')
    entered = threading.Event()
    resume = threading.Event()
    original_open = Image.open

    def paused_open(*args, **kwargs):
        entered.set()
        assert resume.wait(5)
        return original_open(*args, **kwargs)

    monkeypatch.setattr(Image, 'open', paused_open)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(registry.upload_part, browser, op.id, 0, data,
                              'image/png', hashlib.sha256(data).hexdigest(),
                              {'source_sha256': source_hash, 'transform': 'extract_frames',
                               'actual_seconds': 0.5})
        assert entered.wait(5)
        registry.release_media(browser, 'source')
        resume.set()
        with pytest.raises(MediaError) as error:
            pending.result(timeout=5)
    assert error.value.code == 'stale_target'
    assert op.batch_media_ids == []
    assert not any(media.id != 'source' for media in registry.media.values())


def test_auto_frame_batch_uses_one_generated_directory(tmp_path):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    digest = source_media(registry, browser)
    op = registry.create(browser, 'auto-frames', 'extract_frames', {
        'media': {'media_id': 'source'}, 'timestamps': [0, 0.5], 'save_to': 'auto'})
    registry.begin_batch(browser, op.id, 2)
    data = png()
    for index in range(2):
        registry.upload_part(browser, op.id, index, data, 'image/png', hashlib.sha256(data).hexdigest(),
                             metadata={'source_sha256': digest, 'transform': 'extract_frames',
                                       'actual_seconds': index * 0.5})
    with pytest.raises(MediaError, match='frozen request'):
        registry.finish_batch(browser, op.id, 'other')
    state = registry.finish_batch(browser, op.id, 'auto')
    names = [item['path'] for item in state['media']]
    assert names[0].startswith('media/frames-')
    assert names[0].rsplit('/', 1)[0] == names[1].rsplit('/', 1)[0]
    assert names[0].endswith('/part-01.png') and names[1].endswith('/part-02.png')
    assert all((tmp_path / (name + '.json')).is_file() for name in names)


def test_cancelled_derivative_save_rolls_back_sidecar_and_media(tmp_path, monkeypatch):
    registry = MediaRegistry(tmp_path)
    browser = owner(registry)
    digest = source_media(registry, browser)
    op = registry.create(browser, 'cancelled-crop', 'crop_image', crop_args('derived.png'))
    data = png()
    entered = threading.Event()
    resume = threading.Event()
    original = registry._save

    def hold_media(*args, **kwargs):
        if args[2] == 'derived.png':
            entered.set()
            assert resume.wait(3)
        return original(*args, **kwargs)

    monkeypatch.setattr(registry, '_save', hold_media)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(registry.upload, browser, op.id, data, 'image/png',
                              hashlib.sha256(data).hexdigest(),
                              metadata={'source_sha256': digest, 'transform': 'crop_image'},
                              save_to='derived.png')
        assert entered.wait(3)
        assert (tmp_path / 'derived.png.json').is_file()
        assert registry.cancel(browser, op.id)['status'] == 'cancelled'
        resume.set()
        with pytest.raises(MediaError, match='cancelled'):
            pending.result(timeout=3)
    assert not (tmp_path / 'derived.png').exists()
    assert not (tmp_path / 'derived.png.json').exists()
