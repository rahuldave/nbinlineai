"""Bounded notebook snapshot and explicit provider/tool loop."""

import re

from aidialog.msg_parts import Msg, Refusal, Text, mk_tool_res_msg

from . import providers
from .config import DEFAULT_MODELS, KEY_NAMES, provider_status
from .tool_schema import fastllm_tools

REFERENCE = re.compile(r"([\$&])`([A-Za-z_][A-Za-z0-9_]*)`")
MAX_CELLS = 200
MAX_CODE_CHARS = 50000
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


def _history(cells: list[dict]) -> list[Msg]:
    prompts = {}
    pairs = []
    for cell in cells:
        meta = cell.get("metadata") or {}
        if not isinstance(meta, dict):
            continue
        ai = meta.get("nbinlineai") or {}
        if not isinstance(ai, dict):
            continue
        if ai.get("isPromptCell") or ai.get("is_prompt_cell") or ai.get("role") == "prompt":
            prompts[cell["id"]] = cell["source"]
        elif ai.get("isOutputCell") or ai.get("is_output_cell") or ai.get("role") == "response":
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


def _code(cells: list[dict]) -> str:
    chunks = []
    used = 0
    for cell in cells:
        if cell["cell_type"] != "code":
            continue
        source = cell["source"]
        remaining = MAX_CODE_CHARS - used
        if remaining <= 0:
            break
        chunks.append(f"# Cell {cell['id']} (source; execution count {cell.get('execution_count')})\n{source[:remaining]}")
        used += min(len(source), remaining)
    return "\n\n".join(chunks)


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
    context = {
        "code_cells": sum(cell["cell_type"] == "code" for cell in body["preceding_cells"]),
        "code_chars": len(_code(body["preceding_cells"])),
        "variables": {name: info[name] for name in vars_},
        "tools": funcs,
    }
    yield {"type": "context", **context}
    system = "You are a helpful notebook assistant. The code shown is notebook source, which may be unexecuted or stale. Live variables and tools come from the current Python kernel. Only call registered tools when helpful.\n\nNotebook code above this prompt:\n" + _code(body["preceding_cells"])
    messages = [Msg("system", [Text(system)]), *_history(body["preceding_cells"]), Msg("user", [Text(prompt)])]
    allowed = set(funcs)
    steps = 0
    while True:
        response = await providers.complete(body["backend"], body["model"], messages, tools)
        streamed_text = ""
        if hasattr(response, "__aiter__"):
            completion = None
            async for item in response:
                if hasattr(item, "message") and hasattr(item, "tool_calls"):
                    completion = item
                elif isinstance(item, Text) and item.text:
                    streamed_text += item.text
                    yield {"type": "text_delta", "text": item.text}
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
