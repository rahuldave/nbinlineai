"""Model tool schemas reuse source documentation without calling the function."""

import builtins
import importlib.util
import json
import sys
from types import SimpleNamespace

import pytest

from nbinlineai.kernel import MARKER, _payload_code
from nbinlineai.tool_schema import fastllm_tool


def _source_function(tmp_path, monkeypatch, source):
    path = tmp_path / "documented_tool.py"
    path.write_text(source, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("documented_tool", path)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module.compute


def _inspect(function, capsys, *, import_function=None):
    namespace = {"get_ipython": lambda: SimpleNamespace(user_ns={"compute": function})}
    if import_function:
        namespace["__builtins__"] = {**vars(builtins), "__import__": import_function}
    exec(_payload_code("inspect", {"names": ["compute"], "functions": ["compute"]}), namespace)  # noqa: S102
    rows = [line.removeprefix(MARKER) for line in capsys.readouterr().out.splitlines()
            if line.startswith(MARKER)]
    assert len(rows) == 1
    result = json.loads(rows[0])
    assert "error" not in result, result
    return result["compute"]


def _inspect_with_parser(function, capsys, parser):
    original_import = builtins.__import__

    def import_with_parser(name, *args, **kwargs):
        if name == "fastcore.docments":
            return SimpleNamespace(docments=parser)
        return original_import(name, *args, **kwargs)

    return _inspect(function, capsys, import_function=import_with_parser)


def test_model_schema_uses_docments_and_preserves_types_defaults_and_summary(
    tmp_path, monkeypatch, capsys
):
    function = _source_function(tmp_path, monkeypatch, '''\
def compute(
    quantity: int,  # Number of readings to scale.
    *,
    scale: float = 1.5,  # Multiplier applied to each reading.
) -> float:  # Scaled reading count.
    """Scale a reading count without changing the observations."""
    raise AssertionError("Inspection must not call this function")
''')
    info = _inspect(function, capsys)
    schema = fastllm_tool("compute", info)
    assert schema["description"] == "Scale a reading count without changing the observations."
    assert schema["parameters"] == {
        "type": "object",
        "properties": {
            "quantity": {"type": "integer", "description": "Number of readings to scale."},
            "scale": {"type": "number", "description": "Multiplier applied to each reading."},
        },
        "required": ["quantity"],
    }
    assert info["parameters"]["scale"]["default"] == "1.5"


def test_source_unavailable_function_keeps_its_signature_and_docstring(capsys):
    namespace = {}
    exec(  # noqa: S102
        compile('def compute(quantity: int = 2):\n    "A dynamic reading count."\n',
                "<dynamic-tool>", "exec"), namespace,
    )
    info = _inspect(namespace["compute"], capsys)
    assert info["docstring"] == "A dynamic reading count."
    assert info["parameters"] == {
        "quantity": {"type": "int", "description": "quantity", "default": "2"}
    }


def test_kernel_without_fastcore_keeps_plain_function_introspection(
    tmp_path, monkeypatch, capsys
):
    function = _source_function(tmp_path, monkeypatch, '''\
def compute(
    quantity: int = 2,  # Number of readings.
) -> int:  # The count.
    """Read the count."""
    raise AssertionError("must not call")
''')
    original_import = builtins.__import__

    def without_docments(name, *args, **kwargs):
        if name == "fastcore.docments":
            raise ImportError("This kernel does not have fastcore")
        return original_import(name, *args, **kwargs)

    info = _inspect(function, capsys, import_function=without_docments)
    assert info["docstring"] == "Read the count."
    assert info["parameters"] == {
        "quantity": {"type": "int", "description": "quantity", "default": "2"}
    }


def test_forward_annotation_is_not_evaluated(tmp_path, monkeypatch, capsys):
    function = _source_function(tmp_path, monkeypatch, '''\
from __future__ import annotations

def compute(
    quantity: dangerous_annotation(),  # The reading to describe.
) -> str:  # Its description.
    """Describe a reading."""
    raise AssertionError("must not call")
''')
    info = _inspect(function, capsys)
    assert info["parameters"]["quantity"] == {
        "type": "dangerous_annotation()", "description": "The reading to describe."
    }


def test_parameter_description_and_function_summary_are_bounded(
    tmp_path, monkeypatch, capsys
):
    comment = "Reading description " + "x" * 5000
    function = _source_function(tmp_path, monkeypatch, f'''\
def compute(
    quantity: int,  # {comment}
) -> int:  # Count.
    """Summary {'y' * 5000}"""
    raise AssertionError("must not call")
''')
    info = _inspect(function, capsys)
    assert info["parameters"]["quantity"]["description"].startswith("Reading description ")
    assert len(info["parameters"]["quantity"]["description"]) <= 1000
    assert len(info["docstring"]) <= 1000


def test_docments_parser_error_falls_back_to_signature(tmp_path, monkeypatch, capsys):
    function = _source_function(tmp_path, monkeypatch, '''\
def compute(quantity: int = 2) -> int:
    """Read a count."""
    raise AssertionError("must not call")
''')

    def broken_parser(*args, **kwargs):
        raise ValueError("Cannot parse this source")

    info = _inspect_with_parser(function, capsys, broken_parser)
    assert info["docstring"] == "Read a count."
    assert info["parameters"] == {
        "quantity": {"type": "int", "description": "quantity", "default": "2"}
    }


@pytest.mark.parametrize("parsed", [None, [], "unexpected", 42])
def test_docments_nonmapping_result_falls_back_to_signature(
    tmp_path, monkeypatch, capsys, parsed
):
    function = _source_function(tmp_path, monkeypatch, '''\
def compute(quantity: int) -> int:
    """Read a count."""
    raise AssertionError("must not call")
''')
    info = _inspect_with_parser(function, capsys, lambda *args, **kwargs: parsed)
    assert info["docstring"] == "Read a count."
    assert info["parameters"] == {
        "quantity": {"type": "int", "description": "quantity"}
    }


def test_blank_and_nonstring_docments_descriptions_fall_back_per_parameter(
    tmp_path, monkeypatch, capsys
):
    function = _source_function(tmp_path, monkeypatch, '''\
def compute(quantity: int, scale: float = 1.5, label: str = "raw", offset: int = 0):
    """Read a count."""
    raise AssertionError("must not call")
''')
    parsed = {"quantity": "  \n ", "scale": None, "label": 17, "offset": "Offset to apply."}
    info = _inspect_with_parser(function, capsys, lambda *args, **kwargs: parsed)
    assert info["parameters"] == {
        "quantity": {"type": "int", "description": "quantity"},
        "scale": {"type": "float", "description": "scale", "default": "1.5"},
        "label": {"type": "str", "description": "label", "default": "'raw'"},
        "offset": {"type": "int", "description": "Offset to apply.", "default": "0"},
    }


def test_oversized_source_skips_docments_parser(tmp_path, monkeypatch, capsys):
    function = _source_function(tmp_path, monkeypatch, f'''\
def compute(quantity: int) -> int:
    """Read a count."""
    # {"x" * 64000}
    raise AssertionError("must not call")
''')
    calls = []

    def record_parser(*args, **kwargs):
        calls.append((args, kwargs))
        return {"quantity": "Description that should be skipped."}

    info = _inspect_with_parser(function, capsys, record_parser)
    assert calls == []
    assert info["parameters"] == {
        "quantity": {"type": "int", "description": "quantity"}
    }


def test_numpy_docstring_parameter_descriptions_are_used(tmp_path, monkeypatch, capsys):
    function = _source_function(tmp_path, monkeypatch, '''\
def compute(quantity: int, scale: float = 1.5) -> float:
    """Scale a reading count.

    Parameters
    ----------
    quantity : int
        Number of readings to scale.
    scale : float
        Multiplier applied to each reading.
    """
    raise AssertionError("must not call")
''')
    info = _inspect(function, capsys)
    assert info["parameters"]["quantity"]["description"] == "Number of readings to scale."
    assert info["parameters"]["scale"]["description"] == "Multiplier applied to each reading."
