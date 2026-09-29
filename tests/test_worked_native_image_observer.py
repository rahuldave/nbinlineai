"""Private, test-server-only evidence for an accepted native image turn."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path

import pytest

from scripts.worked_native_image_observer import observed_app_server

pytestmark = pytest.mark.skipif(os.name != "posix", reason="POSIX-only private test observer")


def _private_output(tmp_path: Path) -> Path:
    directory = tmp_path / "observer"
    directory.mkdir(mode=0o700)
    return directory / "accepted.jsonl"


def test_only_accepted_image_turn_records_shape_hash_and_opaque_identity(tmp_path: Path) -> None:
    async def exercise() -> None:
        image = tmp_path / "private-blue.png"
        image.write_bytes(b"\x89PNG\r\n\x1a\nprivate synthetic pixels")
        output = _private_output(tmp_path)

        class AppServer:
            async def request(self, method, params):
                if params.get("reject"):
                    raise RuntimeError("private provider payload")
                return {"turn": {"id": "turn-opaque-1"}}

        client = observed_app_server(AppServer, output)()
        text = {"type": "text", "text": "private notebook question and credential"}
        local_image = {"type": "localImage", "path": str(image), "detail": "auto"}
        await client.request("thread/start", {"input": [text, local_image]})
        await client.request("turn/start", {"input": [text]})
        assert output.read_bytes() == b""
        with pytest.raises(RuntimeError, match="private provider payload"):
            await client.request("turn/start", {"input": [text, local_image], "reject": True})
        assert output.read_bytes() == b""
        result = await client.request("turn/start", {"input": [text, local_image]})
        assert result == {"turn": {"id": "turn-opaque-1"}}
        assert json.loads(output.read_text()) == {
            "kind": "accepted_native_image_turn",
            "turn_id": "turn-opaque-1",
            "input_count": 2,
            "input_types": ["text", "localImage"],
            "local_image_count": 1,
            "local_image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
        }
        raw = output.read_text()
        assert str(image) not in raw
        assert "private notebook" not in raw
        assert "credential" not in raw
        assert os.stat(output).st_mode & 0o077 == 0

    asyncio.run(exercise())


def test_observer_rejects_nonprivate_output_and_symlink_image(tmp_path: Path) -> None:
    class AppServer:
        async def request(self, method, params):
            return {"turn": {"id": "turn-opaque-2"}}

    public_dir = tmp_path / "public"
    public_dir.mkdir(mode=0o755)
    with pytest.raises(ValueError, match="private"):
        observed_app_server(AppServer, public_dir / "public.jsonl")
    output = _private_output(tmp_path)
    image = tmp_path / "image.png"
    image.write_bytes(b"actual bytes")
    alias = tmp_path / "alias.png"
    alias.symlink_to(image)
    client = observed_app_server(AppServer, output)()
    with pytest.raises(OSError):
        asyncio.run(client.request("turn/start", {"input": [
            {"type": "text", "text": "x"},
            {"type": "localImage", "path": str(alias)},
        ]}))
    assert output.read_bytes() == b""


def test_observer_requires_new_private_file(tmp_path: Path) -> None:
    class AppServer:
        pass

    output = _private_output(tmp_path)
    output.write_text("old evidence must not be overwritten")
    with pytest.raises(FileExistsError):
        observed_app_server(AppServer, output)
