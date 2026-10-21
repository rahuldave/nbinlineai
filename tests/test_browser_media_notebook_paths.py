"""Exercise the path mapping embedded in the browser-media examples."""

# Execute only the repository's selected helper/cleanup cells on owned temporary
# paths, with browser calls replaced by inert stubs.
# ruff: noqa: S102

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
from types import SimpleNamespace

import pytest

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
NOTEBOOKS = (
    ("foundation", "media-setup"),
    ("playback", "playback-setup"),
    ("attachment", "attachment-setup"),
    ("transforms", "transform-setup"),
    ("integration", "integration-setup"),
    ("outputs", "outputs-setup"),
)


def _mapping_source(name: str, setup_id: str) -> str:
    notebook = json.loads((EXAMPLES / f"browser-media-{name}.ipynb").read_text())
    source = next("".join(cell["source"]) for cell in notebook["cells"] if cell["id"] == setup_id)
    start = source.index("root_text = ")
    end = source.index("    return candidate", source.index("def server_file", start)) + len("    return candidate")
    return source[start:end]


def _cell_source(name: str, cell_id: str) -> str:
    notebook = json.loads((EXAMPLES / f"browser-media-{name}.ipynb").read_text())
    return next("".join(cell["source"]) for cell in notebook["cells"] if cell["id"] == cell_id)


def _mapping(name: str, setup_id: str, server_root: Path) -> dict:
    namespace = {
        "Path": Path,
        "PurePosixPath": PurePosixPath,
        "os": os,
        "input": lambda _prompt: str(server_root),
    }
    exec(compile(_mapping_source(name, setup_id), setup_id, "exec"), namespace)
    return namespace


@pytest.fixture(autouse=True)
def _clear_worked_root(monkeypatch) -> None:
    monkeypatch.delenv("NBINLINEAI_WORKED_ROOT", raising=False)


@pytest.mark.parametrize("name,setup_id", NOTEBOOKS)
def test_media_notebook_maps_nested_kernel_paths(tmp_path: Path, monkeypatch, name: str, setup_id: str) -> None:
    server_root = tmp_path / "served"
    notebook_folder = server_root / "examples" / "nested"
    notebook_folder.mkdir(parents=True)
    monkeypatch.chdir(notebook_folder)
    namespace = _mapping(name, setup_id, server_root)
    server_ref, server_file = namespace["server_ref"], namespace["server_file"]

    source = notebook_folder / "sample.png"
    source.write_bytes(b"owned example")
    assert server_ref(source) == "examples/nested/sample.png"
    assert server_file("examples/nested/sample.png") == source
    assert server_ref(notebook_folder / "future.png") == "examples/nested/future.png"
    assert server_file("examples/nested/future.png") == notebook_folder / "future.png"

    for invalid in (str(source), ".", "../sample.png", "examples/../sample.png", "./sample.png", "a//b", "a\\b"):
        with pytest.raises(ValueError):
            server_file(invalid)

    outside = tmp_path / "outside.png"
    outside.write_bytes(b"not owned")
    escaped = notebook_folder / "escape.png"
    try:
        escaped.symlink_to(outside)
    except (OSError, NotImplementedError):
        pass  # Some Windows test accounts cannot create symlinks.
    else:
        with pytest.raises(ValueError):
            server_ref(escaped)
        with pytest.raises(ValueError):
            server_file("examples/nested/escape.png")


@pytest.mark.parametrize("name,setup_id", NOTEBOOKS)
def test_media_notebook_requires_explicit_absolute_root(tmp_path: Path, monkeypatch, name: str, setup_id: str) -> None:
    notebook_folder = tmp_path / "served" / "examples"
    notebook_folder.mkdir(parents=True)
    monkeypatch.chdir(notebook_folder)
    source = _mapping_source(name, setup_id)
    for supplied in ("", ".", "../served", str(tmp_path / "other")):
        namespace = {
            "Path": Path,
            "PurePosixPath": PurePosixPath,
            "os": os,
            "input": lambda _prompt, supplied=supplied: supplied,
        }
        with pytest.raises((ValueError, FileNotFoundError)):
            exec(compile(source, setup_id, "exec"), namespace)


@pytest.mark.parametrize("name,setup_id", (("attachment", "attachment-setup"),
                                         ("integration", "integration-setup")))
def test_worked_runner_root_skips_interactive_input(tmp_path: Path, monkeypatch,
                                                   name: str, setup_id: str) -> None:
    server_root = tmp_path / "served"
    notebook_folder = server_root / "examples"
    notebook_folder.mkdir(parents=True)
    monkeypatch.chdir(notebook_folder)
    monkeypatch.setenv("NBINLINEAI_WORKED_ROOT", str(server_root))
    namespace = {"Path": Path, "PurePosixPath": PurePosixPath, "os": os,
                 "input": lambda _prompt: pytest.fail("Owned runner root should skip input")}
    exec(compile(_mapping_source(name, setup_id), setup_id, "exec"), namespace)
    assert namespace["server_root"] == server_root


def test_media_notebooks_use_mapping_for_generated_and_saved_paths() -> None:
    expected = {
        "foundation": ("server_ref(source)", "server_file(saved.media['path'])", "server_file(ai_save_to)"),
        "playback": ("server_ref(image_path)", "server_ref(tone_path)"),
        "attachment": ("server_ref(source_path)",),
        "transforms": ("server_ref(image_path)", "server_ref(video_path)",
                       "save_to=server_ref(work / 'crop.png')", "server_file(crop.media['sidecar_path'])"),
        "integration": ("server_file(saved.media['path'])", "server_file(saved.media['sidecar_path'])"),
        "outputs": ("server_file(descriptor['path'])",),
    }
    for name, snippets in expected.items():
        notebook = json.loads((EXAMPLES / f"browser-media-{name}.ipynb").read_text())
        source = "\n".join("".join(cell["source"]) for cell in notebook["cells"])
        for snippet in snippets:
            assert snippet in source, (name, snippet)


def test_foundation_cleanup_removes_nested_generated_and_saved_files(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "served"
    folder = root / "examples"
    (folder / "media").mkdir(parents=True)
    monkeypatch.chdir(folder)
    namespace = _mapping("foundation", "media-setup", root)
    source = folder / "source.png"
    saved_path = folder / "media" / "saved.png"
    ai_path = folder / "ai.png"
    for path in (source, saved_path, ai_path):
        path.write_bytes(b"owned")
    namespace.update({
        "source": source,
        "saved": SimpleNamespace(media={
            "path": "examples/media/saved.png",
            "sha256": hashlib.sha256(saved_path.read_bytes()).hexdigest(),
        }),
        "picture": SimpleNamespace(size=(2, 2)),
        "ai_save_to": "examples/ai.png",
        "hashlib": hashlib,
    })
    exec(_cell_source("foundation", "media-cleanup"), namespace)
    assert not any(path.exists() for path in (source, saved_path, ai_path))


def test_integration_cleanup_removes_nested_file_and_sidecar(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "served"
    folder = root / "examples"
    (folder / "media").mkdir(parents=True)
    monkeypatch.chdir(folder)
    namespace = _mapping("integration", "integration-setup", root)
    saved_path = folder / "media" / "capture.png"
    sidecar_path = folder / "media" / "capture.png.json"
    saved_path.write_bytes(b"owned")
    sidecar_path.write_text("{}")
    namespace["saved"] = SimpleNamespace(status="completed", media={
        "path": "examples/media/capture.png",
        "sidecar_path": "examples/media/capture.png.json",
        "sha256": hashlib.sha256(saved_path.read_bytes()).hexdigest(),
    })
    namespace["hashlib"] = hashlib
    exec(_cell_source("integration", "integration-file-cleanup"), namespace)
    assert not saved_path.exists() and not sidecar_path.exists()


def test_transforms_destination_and_cleanup_stay_in_nested_folder(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "served"
    folder = root / "examples"
    work = folder / "nbinlineai-transform-test"
    work.mkdir(parents=True)
    monkeypatch.chdir(folder)
    namespace = _mapping("transforms", "transform-setup", root)
    image_path = work / "source.png"
    video_path = work / "owned.webm"
    for path in (image_path, video_path, work / "crop.png", work / "crop.png.json"):
        path.write_bytes(b"owned")
    assert namespace["server_ref"](work / "crop.png") == "examples/nbinlineai-transform-test/crop.png"
    namespace.update({
        "work": work,
        "image_path": image_path,
        "video_path": video_path,
        "release_media": lambda _media_id: None,
    })
    exec(_cell_source("transforms", "transform-cleanup"), namespace)
    assert not work.exists()


def test_outputs_cleanup_rejects_changed_file_and_removes_exact_file(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "served"
    folder = root / "examples"
    (folder / "media").mkdir(parents=True)
    monkeypatch.chdir(folder)
    namespace = _mapping("outputs", "outputs-setup", root)
    saved_path = folder / "media" / "data.json"
    saved_path.write_bytes(b'{"owned": true}')
    descriptor = {
        "path": "examples/media/data.json",
        "sha256": hashlib.sha256(saved_path.read_bytes()).hexdigest(),
    }
    empty = SimpleNamespace(status="failed", media=None)
    namespace.update({
        "canvas_source": None,
        "raster_export": empty,
        "vector_export": empty,
        "data_export": empty,
        "data_saved": SimpleNamespace(status="completed", media=descriptor),
        "canvas_still": empty,
        "canvas_saved": empty,
        "region": empty,
        "hashlib": hashlib,
        "release_media": lambda _media_id: None,
    })
    cleanup = _cell_source("outputs", "outputs-cleanup")
    descriptor["sha256"] = "0" * 64
    with pytest.raises(RuntimeError, match="missing or changed"):
        exec(cleanup, namespace)
    assert saved_path.is_file()
    descriptor["sha256"] = hashlib.sha256(saved_path.read_bytes()).hexdigest()
    exec(cleanup, namespace)
    assert not saved_path.exists()
