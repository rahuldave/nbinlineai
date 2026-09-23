"""Private saved-key persistence, precedence, and path safety."""

import stat
from pathlib import Path

import pytest

from nbinlineai.config import key_settings_status, provider_status, resolve_api_key
from nbinlineai.credentials import CredentialStore, credential_directory


@pytest.fixture(autouse=True)
def no_project_env(monkeypatch):
    monkeypatch.setattr("nbinlineai.config.load_server_env", lambda: None)


def test_saved_key_persists_replaces_and_delete_reveals_env(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "environment-only-key")
    store = CredentialStore()
    assert resolve_api_key("openai_api") == "environment-only-key"
    assert key_settings_status()["providers"]["openai_api"] == {
        "configured": True, "source": "environment"
    }
    store.save("openai_api", "first-saved-key")
    assert CredentialStore().get("openai_api") == "first-saved-key"
    assert resolve_api_key("openai_api") == "first-saved-key"
    store.save("openai_api", "second-saved-key")
    assert resolve_api_key("openai_api") == "second-saved-key"
    assert provider_status()["openai_api"]["source"] == "saved"
    store.delete("openai_api")
    assert resolve_api_key("openai_api") == "environment-only-key"
    assert key_settings_status()["providers"]["openai_api"]["source"] == "environment"


def test_private_modes_and_no_project_key_file(monkeypatch, tmp_path):
    config_home = tmp_path / "xdg"
    project = tmp_path / "notebooks"
    project.mkdir()
    monkeypatch.chdir(project)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(config_home))
    store = CredentialStore()
    store.save("anthropic_api", "test-anthropic-key")
    assert store.path == config_home / "nbinlineai" / "credentials.json"
    assert stat.S_IMODE(store.directory.stat().st_mode) == 0o700
    assert stat.S_IMODE(store.path.stat().st_mode) == 0o600
    assert stat.S_IMODE((store.directory / ".credentials.lock").stat().st_mode) == 0o600
    assert not (project / "credentials.json").exists()


def test_default_and_relative_xdg_path(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    assert credential_directory() == tmp_path / ".config" / "nbinlineai"
    monkeypatch.setenv("XDG_CONFIG_HOME", "relative/path")
    assert credential_directory() == tmp_path / ".config" / "nbinlineai"


def test_symlinks_and_invalid_values_rejected(tmp_path):
    store = CredentialStore(tmp_path / "private")
    with pytest.raises(ValueError, match="Unsupported"):
        store.save("other", "test-example-key")
    with pytest.raises(ValueError, match="non-whitespace"):
        store.save("openai_api", "bad key with space")
    with pytest.raises(ValueError, match="non-whitespace"):
        store.save("openai_api", "unicode-\N{SNOWMAN}-key")
    store.directory.mkdir(mode=0o700)
    target = tmp_path / "target"
    target.write_text("{}")
    store.path.symlink_to(target)
    with pytest.raises(RuntimeError, match="symlink"):
        store.get("openai_api")
    with pytest.raises(RuntimeError, match="symlink"):
        store.save("openai_api", "test-example-key")
