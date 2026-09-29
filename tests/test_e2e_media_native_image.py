"""The offline browser provider reports exact native image bytes without echoing them."""

import asyncio
import base64
import hashlib
import importlib.util
import io
from pathlib import Path

import pytest
from aidialog.msg_parts import InputImage, Msg, Text
from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "browser_media_e2e_server", Path(__file__).parent / "support" / "e2e_server.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_native_image_fixture_distinguishes_unattached_and_exact_png() -> None:
    async def complete(parts):
        result = await MODULE.fake_complete("openai_api", "test-model",
                                            [Msg("system", [Text("test")]), Msg("user", parts)], [])
        return result.message.content[0].text

    assert asyncio.run(complete([Text("E2E_MEDIA_NATIVE_IMAGE")])) == "NATIVE_IMAGE count=0"
    stream = io.BytesIO()
    Image.new("RGB", (4, 4), (212, 64, 47)).save(stream, format="PNG")
    raw = stream.getvalue()
    uri = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
    report = asyncio.run(complete([Text("E2E_MEDIA_NATIVE_IMAGE"),
                                   InputImage(uri, mime="image/png")]))
    assert report == (f"NATIVE_IMAGE count=1 mime=image/png bytes={len(raw)} "
                      f"sha256={hashlib.sha256(raw).hexdigest()}")
    assert uri not in report
    with pytest.raises(AssertionError):
        asyncio.run(complete([Text("E2E_MEDIA_NATIVE_IMAGE " + uri),
                              InputImage(uri, mime="image/png")]))
