"""Private per-user choices for ChatGPT direct file access."""

import json
import os
import stat
import tempfile
from pathlib import Path

from filelock import FileLock

from .credentials import _check_private_dir, credential_directory

SCOPES = frozenset({"project", "notebook"})


class SubscriptionSettings:
    """Store only a named scope, never a browser-provided filesystem root."""

    def __init__(self, directory: Path | None = None):
        self.directory = Path(directory) if directory is not None else credential_directory()
        self.path = self.directory / "subscription-settings.json"
        self.lock_path = self.directory / ".subscription-settings.lock"

    def get_file_access(self) -> str:
        if not _check_private_dir(self.directory, create=False):
            return "project"
        if self.path.is_symlink():
            raise RuntimeError("ChatGPT settings file must not be a symlink")
        try:
            fd = os.open(self.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        except FileNotFoundError:
            return "project"
        except OSError as exc:
            raise RuntimeError("Cannot read ChatGPT settings") from exc
        try:
            mode = os.fstat(fd).st_mode
            if not stat.S_ISREG(mode) or (os.name != "nt" and stat.S_IMODE(mode) & 0o077):
                raise RuntimeError("ChatGPT settings file must be private")
            with os.fdopen(fd, "rb", closefd=False) as stream:
                raw = stream.read(4097)
            if len(raw) > 4096:
                raise RuntimeError("ChatGPT settings file is too large")
            data = json.loads(raw)
            if not isinstance(data, dict) or set(data) != {"file_access"} or data["file_access"] not in SCOPES:
                raise RuntimeError("ChatGPT settings file is invalid")
            return data["file_access"]
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("ChatGPT settings file is invalid") from exc
        finally:
            os.close(fd)

    def set_file_access(self, scope: str) -> None:
        if not isinstance(scope, str) or scope not in SCOPES:
            raise ValueError("Invalid ChatGPT file access choice")
        _check_private_dir(self.directory, create=True)
        if self.lock_path.is_symlink():
            raise RuntimeError("ChatGPT settings lock must not be a symlink")
        if (os.name != "nt" and self.lock_path.exists()
                and stat.S_IMODE(self.lock_path.lstat().st_mode) & 0o077):
            raise RuntimeError("ChatGPT settings lock must be private")
        with FileLock(self.lock_path, timeout=10, mode=0o600, preserve_lock_file=True):
            if self.path.is_symlink():
                raise RuntimeError("ChatGPT settings file must not be a symlink")
            fd, temporary = tempfile.mkstemp(prefix=".subscription-settings-", dir=self.directory)
            try:
                if os.name != "nt":
                    os.fchmod(fd, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    json.dump({"file_access": scope}, stream, separators=(",", ":"))
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
