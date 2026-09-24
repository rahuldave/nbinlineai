from pathlib import Path

import pytest
from jupyter_server.services.contents.filemanager import (
    AsyncFileContentsManager,
    FileContentsManager,
)

from nbinlineai.backend_registry import get_backend
from nbinlineai.notebook_scope import (
    NotebookScopeResolver,
    local_project_root,
    resolve_notebook_scope,
)


def _session(path: str, session_id: str = "one") -> dict:
    return {"id": session_id, "path": path, "type": "notebook"}


def test_registry_keeps_subscription_separate_from_api_keys():
    assert get_backend("openai_api").vendor == "openai"
    assert get_backend("anthropic_api").transport == "api_key"
    subscription = get_backend("openai_codex_subscription")
    assert subscription.transport == "subscription"
    assert subscription.vendor is None
    with pytest.raises(ValueError, match="Unsupported AI backend"):
        get_backend("unknown")


def test_scope_uses_effective_local_root_and_session_path(tmp_path):
    course = tmp_path / "course"
    week = course / "week2"
    week.mkdir(parents=True)
    (week / "lesson.ipynb").write_text("{}", encoding="utf-8")
    manager = FileContentsManager(root_dir=str(course))
    project = resolve_notebook_scope(manager, _session("week2/lesson.ipynb"))
    narrow = resolve_notebook_scope(manager, _session("week2/lesson.ipynb"), access="notebook")
    assert project.project_root == course.resolve()
    assert project.working_folder == week.resolve()
    assert project.file_access_root == course.resolve()
    assert narrow.file_access_root == week.resolve()
    assert narrow.session_id == "one"


def test_root_is_frozen_but_session_move_is_seen_on_next_run(tmp_path):
    course = tmp_path / "course"
    alternate = tmp_path / "other"
    first = course / "week1"
    second = course / "week2"
    first.mkdir(parents=True)
    second.mkdir()
    alternate.mkdir()
    (first / "lesson.ipynb").write_text("{}", encoding="utf-8")
    (second / "moved.ipynb").write_text("{}", encoding="utf-8")
    manager = FileContentsManager(root_dir=str(course))
    resolver = NotebookScopeResolver(manager)
    initial = resolver.resolve(_session("week1/lesson.ipynb"), access="notebook")
    manager.root_dir = str(alternate)
    moved = resolver.resolve(_session("week2/moved.ipynb"), access="notebook")
    assert initial.working_folder == first.resolve()
    assert moved.working_folder == second.resolve()
    assert moved.project_root == course.resolve()


@pytest.mark.parametrize("path", [
    "../outside.ipynb", "/outside.ipynb", "week2/../outside.ipynb",
    "week2//lesson.ipynb", "week2/./lesson.ipynb", "week2\\lesson.ipynb",
])
def test_scope_rejects_paths_not_supplied_as_canonical_session_paths(tmp_path, path):
    manager = FileContentsManager(root_dir=str(tmp_path))
    with pytest.raises(ValueError, match="Notebook path"):
        resolve_notebook_scope(manager, _session(path))


def test_scope_rejects_symlink_escape_and_nonlocal_contents(tmp_path):
    course = tmp_path / "course"
    outside = tmp_path / "outside"
    course.mkdir()
    outside.mkdir()
    (outside / "secret.ipynb").write_text("{}", encoding="utf-8")
    (course / "link.ipynb").symlink_to(outside / "secret.ipynb")
    manager = FileContentsManager(root_dir=str(course))
    with pytest.raises(ValueError, match="outside"):
        resolve_notebook_scope(manager, _session("link.ipynb"))
    with pytest.raises(ValueError, match="local"):
        local_project_root(object())


def test_scope_rejects_missing_or_nonnotebook_sessions(tmp_path):
    manager = FileContentsManager(root_dir=str(tmp_path))
    with pytest.raises(ValueError, match="notebook session"):
        resolve_notebook_scope(manager, {"id": "one", "type": "console", "path": "x"})
    with pytest.raises(ValueError, match="Invalid ChatGPT file access"):
        resolve_notebook_scope(manager, _session("x.ipynb"), access=str(Path("/tmp")))


def test_async_local_contents_manager_is_supported(tmp_path):
    (tmp_path / "lesson.ipynb").write_text("{}", encoding="utf-8")
    manager = AsyncFileContentsManager(root_dir=str(tmp_path))
    assert resolve_notebook_scope(manager, _session("lesson.ipynb")).project_root == tmp_path.resolve()
