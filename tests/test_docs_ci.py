"""Focused checks for CI's conservative internal-doc routing."""

import importlib.util
import subprocess
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "docs_ci.py"
SPEC = importlib.util.spec_from_file_location("docs_ci", MODULE_PATH)
docs_ci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(docs_ci)


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def commit(root, message):
    git(root, "add", "-A")
    git(
        root, "-c", "user.name=CI Test", "-c", "user.email=ci@example.test", "commit", "-m", message
    )
    return git(root, "rev-parse", "HEAD")


def test_classifier_boundaries(tmp_path, monkeypatch):
    git(tmp_path, "init")
    docs = tmp_path / "internal_docs"
    docs.mkdir()
    (docs / "a.md").write_text("start\n")
    (tmp_path / "source.py").write_text("pass\n")
    base = commit(tmp_path, "base")
    monkeypatch.chdir(tmp_path)

    (docs / "a.md").write_text("changed\n")
    doc_head = commit(tmp_path, "docs")
    assert docs_ci.docs_only(base, doc_head)
    assert not docs_ci.docs_only(base, base)
    assert not docs_ci.docs_only("", doc_head)
    assert not docs_ci.docs_only("0" * 40, doc_head)  # Manual/first-push uncertainty.

    (tmp_path / "source.py").write_text("print(1)\n")
    code_head = commit(tmp_path, "code")
    assert not docs_ci.docs_only(base, code_head)
    assert not docs_ci.docs_only(doc_head, code_head)
    assert not docs_ci.docs_only(code_head, doc_head)  # Base drift still counts.

    git(tmp_path, "mv", "internal_docs/a.md", "internal_docs/b.md")
    rename_head = commit(tmp_path, "doc rename")
    assert docs_ci.docs_only(code_head, rename_head)
    git(tmp_path, "mv", "source.py", "internal_docs/source.md")
    moved_head = commit(tmp_path, "source moved to docs")
    assert not docs_ci.docs_only(rename_head, moved_head)
    (docs / "b.md").unlink()
    deleted_head = commit(tmp_path, "doc deletion")
    assert docs_ci.docs_only(moved_head, deleted_head)
    (docs / "linked.md").symlink_to("source.md")
    symlink_head = commit(tmp_path, "symlink")
    assert not docs_ci.docs_only(deleted_head, symlink_head)
    workflow = tmp_path / ".github" / "workflows" / "check.yml"
    workflow.parent.mkdir(parents=True)
    workflow.write_text("name: changed\n")
    workflow_head = commit(tmp_path, "workflow")
    assert not docs_ci.docs_only(symlink_head, workflow_head)


def test_internal_links_ignore_code_and_allow_fragments(tmp_path):
    docs = tmp_path / "internal_docs"
    docs.mkdir()
    (docs / "a.md").write_text(
        "[other](b.md#second)\n[reference]: b.md\n"
        "`[inline](missing.md)`\n```md\n[example](missing.md)\n```\n"
    )
    (docs / "b.md").write_text("# Second\n")
    assert docs_ci.check_docs(tmp_path) == []
    (docs / "b.md").write_text("# Different\n")  # Heading fragments are intentionally not parsed.
    assert docs_ci.check_docs(tmp_path) == []
    (docs / "a.md").write_text("[gone](missing.md)\n")
    assert "missing local link" in docs_ci.check_docs(tmp_path)[0]


def test_gate_rejects_failures_skips_and_missing_matrix(tmp_path):
    gate = docs_ci.gate
    assert gate("source", "success", "true", "success", "skipped")
    assert gate("source", "success", "false", "skipped", "success")
    assert not gate("source", "failure", "true", "success", "skipped")
    assert not gate("source", "success", "true", "skipped", "skipped")
    assert not gate("source", "success", "true", "success", "success")
    assert not gate("source", "success", "false", "skipped", "cancelled")
    assert not gate("source", "success", "unknown", "success", "skipped")
    assert gate("runtime", "success", "true", "success", "skipped", "skipped")
    assert not gate("runtime", "success", "true", "success", "success", "skipped")
    assert not gate("runtime", "success", "false", "skipped", "success", "success", tmp_path)
    runners = (
        "macos-15",
        "macos-15-intel",
        "ubuntu-24.04",
        "ubuntu-24.04-arm",
        "windows-2025",
        "windows-11-arm",
    )
    for runner in runners:
        for python in ("3.12", "3.14"):
            (tmp_path / f"passed-{runner}-{python}").touch()
    for runner in ("ubuntu-24.04", "ubuntu-24.04-arm"):
        (tmp_path / f"passed-alpine-{runner}").touch()
    assert gate("runtime", "success", "false", "skipped", "success", "success", tmp_path)
    (tmp_path / "unexpected").touch()
    assert not gate("runtime", "success", "false", "skipped", "success", "success", tmp_path)
    (tmp_path / "unexpected").unlink()
    (tmp_path / "passed-alpine-ubuntu-24.04-arm").unlink()
    assert not gate("runtime", "success", "false", "skipped", "success", "success", tmp_path)
