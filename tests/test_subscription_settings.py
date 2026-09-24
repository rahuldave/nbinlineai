import os
import stat

import pytest

from nbinlineai.subscription_settings import SubscriptionSettings


def test_scope_defaults_to_project_and_persists_without_path_grants(tmp_path):
    store = SubscriptionSettings(tmp_path / "private")
    assert store.get_file_access() == "project"
    store.set_file_access("notebook")
    assert store.get_file_access() == "notebook"
    assert store.path.read_text(encoding="utf-8") == '{"file_access":"notebook"}'
    if os.name != "nt":
        assert stat.S_IMODE(store.path.stat().st_mode) == 0o600
    store.set_file_access("project")
    assert store.get_file_access() == "project"
    with pytest.raises(ValueError, match="Invalid ChatGPT file access"):
        store.set_file_access("/arbitrary/path")


def test_scope_rejects_symlinked_settings_file(tmp_path):
    store = SubscriptionSettings(tmp_path / "private")
    store.directory.mkdir(mode=0o700)
    target = tmp_path / "outside"
    target.write_text('{"file_access":"project"}', encoding="utf-8")
    store.path.symlink_to(target)
    with pytest.raises(RuntimeError, match="symlink"):
        store.get_file_access()
    with pytest.raises(RuntimeError, match="symlink"):
        store.set_file_access("notebook")
    assert target.read_text(encoding="utf-8") == '{"file_access":"project"}'
