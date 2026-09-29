"""Opt-in, private proof of native image inputs accepted by the owned test server.

This wraps only the isolated server's App Server client. It never records the
model payload, image path or bytes, account data, or unsuccessful requests.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import threading
from pathlib import Path

MAX_IMAGE_BYTES = 8_000_000
MAX_RECORDS = 64
TURN_ID = re.compile(r"[A-Za-z0-9_-]{1,200}\Z")


def _private_new_file(path: Path) -> None:
    if not path.is_absolute() or path.name in {"", ".", ".."}:
        raise ValueError("Observer output must be an absolute private file")
    parent = path.parent
    info = parent.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError("Observer output directory must be owned and private")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    os.close(fd)


def _image_hash(path: str) -> str:
    if not isinstance(path, str) or not path:
        raise ValueError("Native image path is invalid")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_IMAGE_BYTES:
            raise ValueError("Native image is not a bounded regular file")
        digest = hashlib.sha256()
        read = 0
        while True:
            chunk = os.read(fd, min(65536, MAX_IMAGE_BYTES + 1 - read))
            if not chunk:
                break
            read += len(chunk)
            if read > MAX_IMAGE_BYTES:
                raise ValueError("Native image exceeds observer bound")
            digest.update(chunk)
        return digest.hexdigest()
    finally:
        os.close(fd)


def observed_app_server(base: type, output: Path) -> type:
    """Return a test-only App Server class that records accepted image turns."""
    output = Path(output)
    _private_new_file(output)
    lock = threading.Lock()
    count = 0

    class ObservedAppServer(base):
        async def request(self, method, params, **kwargs):
            nonlocal count
            result = await super().request(method, params, **kwargs)
            if method != "turn/start":
                return result
            items = params.get("input") if isinstance(params, dict) else None
            if not isinstance(items, list) or not items:
                return result
            types = [item.get("type") if isinstance(item, dict) else None for item in items]
            if "localImage" not in types:
                return result
            if any(not isinstance(kind, str) or len(kind) > 30 for kind in types):
                raise ValueError("Native image input shape is invalid")
            images = [item for item in items if item.get("type") == "localImage"]
            if len(images) != 1 or len(items) > 8:
                raise ValueError("Native image input count is invalid")
            turn = result.get("turn") if isinstance(result, dict) else None
            turn_id = turn.get("id") if isinstance(turn, dict) else None
            if not isinstance(turn_id, str) or not TURN_ID.fullmatch(turn_id):
                raise ValueError("Accepted turn identity is invalid")
            record = {
                "kind": "accepted_native_image_turn",
                "turn_id": turn_id,
                "input_count": len(items),
                "input_types": types,
                "local_image_count": 1,
                "local_image_sha256": _image_hash(images[0].get("path")),
            }
            line = (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode()
            if len(line) > 512:
                raise ValueError("Native image observer record is oversized")
            with lock:
                if count >= MAX_RECORDS:
                    raise ValueError("Native image observer record limit reached")
                flags = os.O_WRONLY | os.O_APPEND
                if hasattr(os, "O_NOFOLLOW"):
                    flags |= os.O_NOFOLLOW
                fd = os.open(output, flags)
                try:
                    info = os.fstat(fd)
                    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                            or stat.S_IMODE(info.st_mode) & 0o077):
                        raise ValueError("Native image observer file is not private")
                    if os.write(fd, line) != len(line):
                        raise OSError("Native image observer write was incomplete")
                finally:
                    os.close(fd)
                count += 1
            return result

    return ObservedAppServer


def install(output: Path) -> None:
    """Install only when the owned isolated server explicitly opts in."""
    from nbinlineai import subscription_runtime

    subscription_runtime._AppServer = observed_app_server(subscription_runtime._AppServer, output)
