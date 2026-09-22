"""Translate ai-jup-style kernel introspection into fastllm function tools.

This module deals only with descriptions. Executing the function in a Jupyter
kernel needs a separate, session-bound dispatcher.
"""

import re
from collections.abc import Mapping
from typing import Any

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_TYPE_MAP = {
    "int": "integer",
    "float": "number",
    "str": "string",
    "bool": "boolean",
    "list": "array",
    "dict": "object",
    "none": "null",
    "nonetype": "null",
}


def _json_type(annotation: str) -> str:
    """Map ai-jup's simple type annotation string to a JSON Schema type."""
    base = annotation.split("[", 1)[0].rsplit(".", 1)[-1].lower()
    return _TYPE_MAP.get(base, "string")


def fastllm_tool(name: str, info: Mapping[str, Any]) -> dict[str, Any]:
    """Build a function schema accepted by fastllm's supported providers.

    ``info`` is the shape emitted by ai-jup's ``getFunction`` introspection:
    ``{docstring, parameters: {name: {type, description, default?}}}``.
    A parameter without a ``default`` key is required, matching ai-jup.
    """
    if not _IDENTIFIER.fullmatch(name):
        raise ValueError(f"Invalid function name: {name!r}")
    parameters = info.get("parameters", {})
    if not isinstance(parameters, Mapping):
        raise TypeError("Function parameters must be a mapping")

    properties: dict[str, dict[str, str]] = {}
    required: list[str] = []
    for param_name, param_info in parameters.items():
        if not isinstance(param_name, str) or not _IDENTIFIER.fullmatch(param_name):
            raise ValueError(f"Invalid parameter name: {param_name!r}")
        if not isinstance(param_info, Mapping):
            raise TypeError(f"Invalid parameter info for {param_name!r}")
        annotation = str(param_info.get("type", "str"))
        prop = {
            "type": _json_type(annotation),
            "description": str(param_info.get("description", param_name)),
        }
        if prop["type"] == "array":
            item_annotation = annotation.partition("[")[2].rsplit("]", 1)[0]
            prop["items"] = {"type": _json_type(item_annotation or "str")}
        properties[param_name] = prop
        if "default" not in param_info:
            required.append(param_name)

    # FastLLM accepts this flat Responses shape for OpenAI and converts it for
    # Anthropic or Chat Completions. Keep strict=False here: ai-jup treats
    # parameters with defaults as optional, which OpenAI strict mode does not.
    return {
        "type": "function",
        "name": name,
        "description": str(info.get("docstring") or f"Call the {name} function"),
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
        },
        "strict": False,
    }


def fastllm_tools(functions: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Translate the selected ``&`function` `` functions as one tool list."""
    return [fastllm_tool(name, info) for name, info in functions.items()]
