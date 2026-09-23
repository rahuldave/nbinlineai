"""Private API credentials for one Jupyter user server.

The notebook kernel and Jupyter Server normally run as the same OS user. This
store is private from other OS users, not from code deliberately run in that
user's own Python kernel.
"""

import json
import os
import stat
import tempfile
from pathlib import Path

from filelock import FileLock

BACKENDS = frozenset({"openai_api", "anthropic_api"})
MAX_KEY_LENGTH = 2048


def credential_directory() -> Path:
    """Use the XDG user config root, independent of notebooks and uv environments."""
    xdg = os.getenv("XDG_CONFIG_HOME")
    if xdg and Path(xdg).is_absolute():
        base = Path(xdg)
    elif os.name == "nt":
        base = Path(os.getenv("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path.home() / ".config"
    return base / "nbinlineai"


def _check_backend(backend: str) -> None:
    if not isinstance(backend, str) or backend not in BACKENDS:
        raise ValueError("Unsupported API backend")


def _check_private_dir(path: Path, *, create: bool) -> bool:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        if not create:
            return False
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        mode = path.lstat().st_mode
    if not stat.S_ISDIR(mode) or (os.name != "nt" and stat.S_IMODE(mode) & 0o077):
        raise RuntimeError("API credential directory must be private")
    return True


class CredentialStore:
    def __init__(self, directory: Path | None = None):
        self.directory = Path(directory) if directory is not None else credential_directory()
        self.path = self.directory / "credentials.json"

    def _read(self) -> dict[str, str]:
        if not _check_private_dir(self.directory, create=False):
            return {}
        if self.path.is_symlink():
            raise RuntimeError("API credential file must not be a symlink")
        try:
            fd = os.open(self.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        except FileNotFoundError:
            return {}
        except OSError as exc:
            raise RuntimeError("Cannot read API credentials") from exc
        try:
            mode = os.fstat(fd).st_mode
            if not stat.S_ISREG(mode) or (os.name != "nt" and stat.S_IMODE(mode) & 0o077):
                raise RuntimeError("API credential file must be private")
            with os.fdopen(fd, "rb", closefd=False) as stream:
                raw = stream.read(8193)
            if len(raw) > 8192:
                raise RuntimeError("API credential file is too large")
            data = json.loads(raw)
            if not isinstance(data, dict) or any(
                key not in BACKENDS or not isinstance(value, str)
                for key, value in data.items()
            ):
                raise RuntimeError("API credential file is invalid")
            return data
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("API credential file is invalid") from exc
        finally:
            os.close(fd)

    def get(self, backend: str) -> str | None:
        _check_backend(backend)
        return self._read().get(backend)

    def save(self, backend: str, key: str) -> None:
        _check_backend(backend)
        if not isinstance(key, str) or not 8 <= len(key) <= MAX_KEY_LENGTH or any(
            not 33 <= ord(char) <= 126 for char in key
        ):
            raise ValueError("API key must be 8 to 2048 non-whitespace characters")
        _check_private_dir(self.directory, create=True)
        with self._lock():
            data = self._read()
            data[backend] = key
            self._write(data)

    def delete(self, backend: str) -> None:
        _check_backend(backend)
        if not _check_private_dir(self.directory, create=False):
            return
        with self._lock():
            data = self._read()
            if backend not in data:
                return
            del data[backend]
            if data:
                self._write(data)
            else:
                self.path.unlink()

    def _lock(self):
        lock_path = self.directory / ".credentials.lock"
        if lock_path.is_symlink():
            raise RuntimeError("API credential lock must not be a symlink")
        if os.name != "nt" and lock_path.exists() and stat.S_IMODE(lock_path.lstat().st_mode) & 0o077:
            raise RuntimeError("API credential lock must be private")
        return FileLock(lock_path, timeout=10, mode=0o600, preserve_lock_file=True)

    def _write(self, data: dict[str, str]) -> None:
        _check_private_dir(self.directory, create=True)
        # Reject an existing symlink rather than silently replacing it.
        if self.path.is_symlink():
            raise RuntimeError("API credential file must not be a symlink")
        fd, temp_path = tempfile.mkstemp(prefix=".credentials-", dir=self.directory)
        try:
            if os.name != "nt":
                os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_path, self.path)
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
