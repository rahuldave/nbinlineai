"""Bounded notebook snapshot and explicit provider/tool loop."""

import re

from aidialog.msg_parts import Msg, Refusal, Text, mk_tool_res_msg
from fasttransport.errors import APIError

from . import providers
from .config import DEFAULT_MODELS, KEY_NAMES, provider_status
from .tool_schema import fastllm_tools

REFERENCE = re.compile(r"([\$&])`([A-Za-z_][A-Za-z0-9_]*)`")
MAX_CELLS = 200
MAX_SOURCE_CHARS = 50000
MAX_HISTORY_CHARS = 16000
MAX_PROMPT_CHARS = 16000


def validate_request(body: dict) -> dict:
    if not isinstance(body, dict):
        raise TypeError("Request body must be a JSON object")
    for field in ("prompt", "session_id", "prompt_cell_id"):
        if not isinstance(body.get(field), str) or not body[field]:
            raise ValueError(f"{field} is required")
    if len(body["prompt"]) > MAX_PROMPT_CHARS:
        raise ValueError("Prompt is too large")
    if body.get("backend") not in KEY_NAMES:
        raise ValueError("Unsupported API backend")
    if not provider_status()[body["backend"]]["configured"]:
        raise ValueError("Selected API provider is not configured")
    model = body.get("model") or DEFAULT_MODELS[body["backend"]]
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", model):
        raise ValueError("Invalid model name")
    body["model"] = model
    steps = body.get("max_tool_steps", 5)
    if isinstance(steps, bool) or not isinstance(steps, int) or not 0 <= steps <= 10:
        raise ValueError("max_tool_steps must be between 0 and 10")
    body["max_tool_steps"] = steps
    cells = body.get("preceding_cells")
    if not isinstance(cells, list) or len(cells) > MAX_CELLS:
        raise ValueError("preceding_cells must be a list of at most 200 cells")
    for cell in cells:
        if not isinstance(cell, dict) or not isinstance(cell.get("id"), str):
            raise TypeError("Invalid preceding cell")
        if cell.get("cell_type") not in ("code", "markdown", "raw"):
            raise ValueError("Invalid preceding cell type")
        if not isinstance(cell.get("source"), str):
            raise TypeError("Invalid preceding cell source")
    return body


def _ai_role(cell: dict) -> str | None:
    metadata = cell.get("metadata")
    if not isinstance(metadata, dict):
        return None
    ai = metadata.get("nbinlineai")
    if not isinstance(ai, dict):
        return None
    if ai.get("isPromptCell") or ai.get("is_prompt_cell") or ai.get("role") == "prompt":
        return "prompt"
    if ai.get("isOutputCell") or ai.get("is_output_cell") or ai.get("role") == "response":
        return "response"
    return None


def _history(cells: list[dict]) -> list[Msg]:
    prompts = {}
    pairs = []
    for cell in cells:
        role = _ai_role(cell)
        if role == "prompt":
            prompts[cell["id"]] = cell["source"]
        elif role == "response":
            ai = cell["metadata"]["nbinlineai"]
            prompt_id = ai.get("promptCellId") or ai.get("prompt_cell_id")
            if ai.get("status", "done") == "done" and prompt_id in prompts:
                pairs.append((prompts[prompt_id], cell["source"]))
    selected = []
    remaining = MAX_HISTORY_CHARS
    for prompt, response in reversed(pairs):
        if len(prompt) + len(response) > remaining:
            break
        selected.append((prompt, response))
        remaining -= len(prompt) + len(response)
    result = []
    for prompt, response in reversed(selected):
        result.extend([Msg("user", [Text(prompt)]), Msg("assistant", [Text(response)])])
    return result


def _source_context(cells: list[dict]) -> tuple[str, dict]:
    chunks = []
    counts = {"code_cells": 0, "markdown_cells": 0, "code_chars": 0, "markdown_chars": 0,
              "source_chars": 0, "source_truncated": False}
    for cell in cells:
        kind = cell["cell_type"]
        if kind not in ("code", "markdown") or _ai_role(cell) is not None:
            continue
        source = cell["source"]
        if not source:
            continue
        remaining = MAX_SOURCE_CHARS - counts["source_chars"]
        if remaining <= 0:
            counts["source_truncated"] = True
            break
        included = source[:remaining]
        label = f"Code cell {cell['id']} (source; execution count {cell.get('execution_count')})" if kind == "code" else f"Markdown cell {cell['id']} (source)"
        chunks.append(f"[{label}]\n{included}")
        counts[f"{kind}_cells"] += 1
        counts[f"{kind}_chars"] += len(included)
        counts["source_chars"] += len(included)
        if len(included) < len(source):
            counts["source_truncated"] = True
            break
    return "\n\n".join(chunks), counts


async def run_prompt(body: dict, dispatcher, kernel_id: str, kernel):
    prompt = body["prompt"]
    vars_ = list(dict.fromkeys(name for kind, name in REFERENCE.findall(prompt) if kind == "$"))
    funcs = list(dict.fromkeys(name for kind, name in REFERENCE.findall(prompt) if kind == "&"))
    if set(vars_) & set(funcs):
        raise ValueError("A name cannot be both a variable and a tool in one prompt")
    if len(vars_) + len(funcs) > 20:
        raise ValueError("Too many live kernel references")
    info = await dispatcher.inspect(kernel_id, kernel, vars_, funcs) if vars_ or funcs else {}
    if "error" in info:
        raise ValueError(f"Kernel introspection failed: {info['error']}")
    for name in [*vars_, *funcs]:
        if name not in info:
            raise ValueError(f"Kernel did not return {name}")
        if "error" in info[name]:
            raise ValueError(f"{name}: {info[name]['error']}")
    for name in vars_:
        prompt = prompt.replace(f"$`{name}`", info[name]["repr"])
    tools = fastllm_tools({name: info[name] for name in funcs})
    source_text, source_counts = _source_context(body["preceding_cells"])
    context = {
        **source_counts,
        "variables": {name: info[name] for name in vars_},
        "tools": funcs,
    }
    yield {"type": "context", **context}
    system = "You are a helpful notebook assistant. The code and Markdown shown are notebook source above this prompt. Code may be unexecuted or stale. Live variables and tools come from the current Python kernel. Only call registered tools when helpful.\n\nNotebook source above this prompt:\n" + source_text
    messages = [Msg("system", [Text(system)]), *_history(body["preceding_cells"]), Msg("user", [Text(prompt)])]
    allowed = set(funcs)
    steps = 0
    while True:
        try:
            response = await providers.complete(body["backend"], body["model"], messages, tools)
        except (APIError, KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            raise RuntimeError("Model request failed") from exc
        streamed_text = ""
        if hasattr(response, "__aiter__"):
            completion = None
            try:
                async for item in response:
                    if hasattr(item, "message") and hasattr(item, "tool_calls"):
                        completion = item
                    elif isinstance(item, Text) and item.text:
                        streamed_text += item.text
                        yield {"type": "text_delta", "text": item.text}
            except (APIError, KeyboardInterrupt, SystemExit):
                raise
            except Exception as exc:
                raise RuntimeError("Model request failed") from exc
            if completion is None:
                raise RuntimeError("Model stream ended without completion")
        else:
            completion = response
        refusal = next((part.text for part in completion.message.content if isinstance(part, Refusal)), None)
        if refusal is not None:
            raise ValueError((refusal or "Model declined the request")[:500])
        if completion.finish_reason == "content_filter":
            raise ValueError("Model response was blocked by the provider")
        if completion.finish_reason == "length":
            raise ValueError("Model response exceeded the output limit")
        full_text = completion.message.text
        if not streamed_text and full_text:
            yield {"type": "text_delta", "text": full_text}
        elif streamed_text and full_text.startswith(streamed_text) and len(full_text) > len(streamed_text):
            yield {"type": "text_delta", "text": full_text[len(streamed_text):]}
        calls = completion.tool_calls
        if not calls:
            if not full_text and not streamed_text:
                raise ValueError("Model returned an empty response")
            yield {"type": "done", "model": body["model"], "tool_steps": steps}
            return
        if len(calls) > 10 or len({call.id for call in calls}) != len(calls):
            raise ValueError("Model returned too many or duplicate tool calls")
        if steps >= body["max_tool_steps"]:
            raise ValueError("Tool step limit reached")
        steps += 1
        results = []
        for call in calls:
            if call.server:
                raise ValueError("Provider-side tools are not enabled")
            if call.name not in allowed:
                raise ValueError("Model requested a tool that was not registered for this prompt")
            if not isinstance(call.id, str) or not call.id:
                raise ValueError("Model returned a tool call without an ID")
            yield {"type": "tool_start", "id": call.id, "name": call.name, "arguments": call.arguments}
            try:
                result = await dispatcher.call(body["session_id"], kernel_id, kernel, allowed, call.name, call.arguments)
            except (ValueError, TimeoutError) as exc:
                result = f"Error: {exc}"
            results.append(result)
            yield {"type": "tool_result", "id": call.id, "name": call.name, "text": result}
        messages.extend([completion.message, mk_tool_res_msg(calls, results)])
