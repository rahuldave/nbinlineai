"""Bounded notebook snapshot and explicit provider/tool loop."""

import asyncio
import json
import re

from aidialog.msg_parts import Msg, Refusal, Text, mk_tool_res_msg
from fasttransport.errors import APIError

from . import providers
from .config import DEFAULT_MODELS, KEY_NAMES, MODEL_CAPABILITIES, provider_status
from .context_budget import ai_role, build_context
from .context_selection import CONTEXT_MODES, select_context
from .tool_schema import fastllm_tools
from .web_tools import MAX_WEB_TOTAL_SECONDS, fetch_url_markdown

REFERENCE = re.compile(r"([\$&])`([A-Za-z_][A-Za-z0-9_]*)`")
MAX_CELLS = 10_000
MAX_SNAPSHOT_CHARS = 4_000_000
MAX_PROMPT_CHARS = 16000
MAX_PROMPT_INSTRUCTIONS_CHARS = 8000
PROMPT_MODE_INSTRUCTIONS = {
    "compact": (
        "Answer the current question directly and very succinctly. Give only the explanation needed "
        "to make the answer useful. If code helps, put it in a fenced Markdown block with an explicit "
        "language tag such as ```python."
    ),
    "full": (
        "Give a detailed, well-structured answer with the reasoning and explanation needed to understand "
        "it. Include examples or code when useful. Put code in fenced Markdown blocks with explicit "
        "language tags such as ```python."
    ),
    "learning": (
        "Act as a Socratic tutor. Help the learner reason through the current problem by asking one or "
        "a few focused questions, then wait for their next AI cell before advancing. Use the earlier "
        "prompt-and-answer history to adapt to what they have already tried and understood. Give hints "
        "and feedback, but do not provide a complete solution or substantial code. Only when needed "
        "as a hint, include at most 3 lines of example code in the entire response, in one fenced "
        "Markdown block with a language tag. Do not split a complete solution across multiple "
        "snippets. You may suggest relevant documentation to consult, but do not claim "
        "to have opened or read linked documentation unless its contents were actually provided."
    ),
}


def _prompt_mode(body: dict) -> str:
    mode = body.get("prompt_mode", "compact")
    if not isinstance(mode, str) or mode not in PROMPT_MODE_INSTRUCTIONS:
        raise ValueError("prompt_mode must be one of: compact, full, learning")
    return mode


def validate_request(body: dict, *, preview: bool = False) -> dict:
    if not isinstance(body, dict):
        raise TypeError("Request body must be a JSON object")
    for field in ("prompt", "session_id", "prompt_cell_id"):
        if not isinstance(body.get(field), str) or not body[field]:
            raise ValueError(f"{field} is required")
    if len(body["prompt"]) > MAX_PROMPT_CHARS:
        raise ValueError("Prompt is too large")
    body["prompt_mode"] = _prompt_mode(body)
    if "prompt_instructions" in body:
        instructions = body["prompt_instructions"]
        if (not isinstance(instructions, str) or not instructions.strip()
                or len(instructions) > MAX_PROMPT_INSTRUCTIONS_CHARS):
            raise ValueError("prompt_instructions must be nonempty text of at most 8000 characters")
    backend = body.get("backend", "openai_api" if preview else None)
    if backend not in KEY_NAMES:
        raise ValueError("Unsupported API backend")
    body["backend"] = backend
    if not preview and not provider_status()[backend]["configured"]:
        raise ValueError("Selected API provider is not configured")
    model = body.get("model") or DEFAULT_MODELS[backend]
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", model):
        raise ValueError("Invalid model name")
    body["model"] = model
    effort = body.get("reasoning_effort", "default")
    if not isinstance(effort, str):
        raise TypeError("reasoning_effort must be 'default' or a supported effort for the selected model")
    if effort == "default":
        body["reasoning_effort"] = None
    else:
        choices = MODEL_CAPABILITIES[backend].get(model, {}).get("efforts", [])
        if effort not in choices:
            raise ValueError("reasoning_effort is unavailable for the selected model")
        body["reasoning_effort"] = effort
    steps = body.get("max_tool_steps", 5)
    if isinstance(steps, bool) or not isinstance(steps, int) or not 0 <= steps <= 10:
        raise ValueError("max_tool_steps must be between 0 and 10")
    body["max_tool_steps"] = steps
    version = body.get("snapshot_version")
    if version is None:
        cells = body.get("preceding_cells")
        if not isinstance(cells, list) or len(cells) > MAX_CELLS:
            raise ValueError("preceding_cells must be a list of at most 10000 cells")
        body["context_mode"] = "default"
        body["_legacy_snapshot"] = True
    elif type(version) is int and version == 1:
        cells = body.get("notebook_cells")
        if not isinstance(cells, list) or len(cells) > MAX_CELLS:
            raise ValueError("notebook_cells must be a list of at most 10000 cells")
        if not isinstance(body.get("context_mode", "default"), str) or body.get("context_mode", "default") not in CONTEXT_MODES:
            raise ValueError("Invalid context mode")
        body["context_mode"] = body.get("context_mode", "default")
        body["_legacy_snapshot"] = False
    else:
        raise ValueError("Unsupported notebook snapshot version; refresh JupyterLab")
    if len(json.dumps(cells, ensure_ascii=False, default=str)) > MAX_SNAPSHOT_CHARS:
        raise ValueError("Notebook snapshot exceeds the 4000000-character request limit")
    ids = set()
    for cell in cells:
        if not isinstance(cell, dict) or not isinstance(cell.get("id"), str) or not cell["id"]:
            raise TypeError("Invalid notebook cell")
        if len(cell["id"]) > 200 or cell["id"] in ids:
            raise ValueError("Notebook cell IDs must be unique and at most 200 characters")
        ids.add(cell["id"])
        if cell.get("cell_type") not in ("code", "markdown", "raw"):
            raise ValueError("Invalid notebook cell type")
        if not isinstance(cell.get("source"), str):
            raise TypeError("Invalid notebook cell source")
        if not isinstance(cell.get("metadata", {}), dict):
            raise TypeError("Invalid notebook cell metadata")
        ai = cell.get("metadata", {}).get("nbinlineai")
        if ai is not None and not isinstance(ai, dict):
            raise TypeError("Invalid AI cell metadata")
        if ai and ai_role(cell):
            if cell["cell_type"] != "markdown":
                raise ValueError("AI questions and answers must be Markdown cells")
            if ai_role(cell) == "response":
                link = ai.get("promptCellId") or ai.get("prompt_cell_id")
                if link is not None and (not isinstance(link, str) or len(link) > 200):
                    raise ValueError("Invalid AI answer question link")
                status = ai.get("status", "done")
                if status not in ("running", "done", "error", "cancelled"):
                    raise ValueError("Invalid AI answer status")
        if "context_include" in cell and not isinstance(cell["context_include"], bool):
            raise TypeError("context_include must be a boolean")
        if "tools_include" in cell and not isinstance(cell["tools_include"], bool):
            raise TypeError("tools_include must be a boolean")
    if version == 1 and body["prompt_cell_id"] not in ids:
        raise ValueError("Current AI question is missing from the notebook snapshot")
    if version == 1:
        current = next(cell for cell in cells if cell["id"] == body["prompt_cell_id"])
        if ai_role(current) != "prompt" or current["cell_type"] != "markdown":
            raise ValueError("Current cell must be an AI question")
        if current["source"].strip() != body["prompt"]:
            raise ValueError("Current question changed; refresh its notebook snapshot")
    generation = body.get("preview_generation")
    if generation is not None and (isinstance(generation, bool) or not isinstance(generation, (str, int))
                                   or isinstance(generation, str) and len(generation) > 200):
        raise ValueError("Invalid preview generation")
    return body


def _inherited_tools(
    cells: list[dict],  # Complete preceding snapshot, before context trimming.
) -> list[str]:  # Distinct tool names declared in eligible Markdown source.
    """Find tool declarations in ordinary Markdown and AI questions only."""
    names = []
    for cell in cells:
        if (cell["cell_type"] != "markdown" or ai_role(cell) == "response"
                or cell.get("tools_include", True) is False):
            continue
        names.extend(name for kind, name in REFERENCE.findall(cell["source"]) if kind == "&")
    return list(dict.fromkeys(names))


def _special_arguments(arguments):
    """Decode a model tool-call object without accepting arbitrary payloads."""
    if isinstance(arguments, str):
        if len(arguments) > 16_000:
            raise ValueError("Tool arguments are too large")
        try:
            arguments = json.loads(arguments)
        except ValueError as exc:
            raise ValueError("Tool arguments are invalid JSON") from exc
    if not isinstance(arguments, dict):
        raise TypeError("Tool arguments must be an object")
    try:
        size = len(json.dumps(arguments))
    except (TypeError, ValueError) as exc:
        raise ValueError("Tool arguments must be JSON values") from exc
    if size > 16_000:
        raise ValueError("Tool arguments are too large")
    return arguments


async def prepare_context(body: dict, dispatcher, kernel_id: str, kernel, *, preview: bool = False):
    mode = _prompt_mode(body)
    prompt = body["prompt"]
    vars_ = list(dict.fromkeys(name for kind, name in REFERENCE.findall(prompt) if kind == "$"))
    cells = body["preceding_cells"] if body.get("_legacy_snapshot", "notebook_cells" not in body) else body["notebook_cells"]
    if body.get("_legacy_snapshot", "notebook_cells" not in body):
        preceding = cells
    else:
        preceding = cells[:next(index for index, cell in enumerate(cells)
                                if cell["id"] == body["prompt_cell_id"])]
    current_tools_enabled = True if body.get("_legacy_snapshot", "notebook_cells" not in body) else next(
        cell for cell in cells if cell["id"] == body["prompt_cell_id"]
    ).get("tools_include", True)
    current_funcs = ([name for kind, name in REFERENCE.findall(prompt) if kind == "&"]
                     if current_tools_enabled else [])
    funcs = list(dict.fromkeys([*current_funcs, *_inherited_tools(preceding)]))
    if set(vars_) & set(funcs):
        raise ValueError("A name cannot be both a variable and a tool in one prompt")
    if len(vars_) + len(funcs) > 20:
        raise ValueError("Too many live kernel references, including inherited tools (limit 20)")
    if vars_ or funcs:
        if preview:
            info = await dispatcher.inspect_preview(kernel_id, kernel, vars_, funcs)
        else:
            info = await dispatcher.inspect(kernel_id, kernel, vars_, funcs)
    else:
        info = {}
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
    if body.get("_legacy_snapshot", "notebook_cells" not in body):
        from .context_budget import eligible_units

        units = eligible_units(cells)
        selected_legacy_ids = {cell["id"] for unit in units
                               for cell in (unit.cell, unit.prompt, unit.answer) if cell}
        selection_report = {"context_mode": "default", "selected_cell_ids": [
            cell["id"] for cell in cells if cell["id"] in selected_legacy_ids
        ], "excluded_cell_ids": [], "ineligible_cells": []}
    else:
        selection = select_context(cells, body["prompt_cell_id"], body["context_mode"])
        units = selection.units
        selection_report = selection.report
    if body.get("preview_generation") is not None:
        selection_report["snapshot_generation"] = body["preview_generation"]
    selection_report["snapshot_version"] = 1 if not body.get("_legacy_snapshot") else 0
    selection_report["tool_disabled_cell_ids"] = [cell["id"] for cell in cells
                                                  if cell.get("tools_include", True) is False]
    system_prefix = (
        "You are a helpful notebook assistant. The labeled code, Markdown and AI cells are notebook "
        "source relative to this question. Code may be unexecuted or stale. AI cells labeled as "
        "source are not prior chat turns. Live variables and tools come from the current Python kernel. "
        "Only call registered tools when helpful.\n\nNotebook source:\n"
    )
    system_suffix = (
        "\n\n"
        "Response style for this run (" + mode + "): "
        + body.get("prompt_instructions", PROMPT_MODE_INSTRUCTIONS[mode])
    )
    return cells, units, tools, system_prefix, system_suffix, prompt, selection_report, vars_, funcs, info


async def preview_context(body: dict, dispatcher, kernel_id: str, kernel) -> dict:
    prepared = await prepare_context(body, dispatcher, kernel_id, kernel, preview=True)
    cells, units, tools, prefix, suffix, prompt, report, vars_, funcs, info = prepared
    built = build_context(cells, units, tools, prefix, suffix, prompt, [], report)
    return {"type": "context", **built.counts,
            "variables": {name: info[name] for name in vars_}, "tools": funcs}


async def run_prompt(body: dict, dispatcher, kernel_id: str, kernel, bridge=None, run=None):
    prepared = await prepare_context(body, dispatcher, kernel_id, kernel)
    cells, units, tools, system_prefix, system_suffix, prompt, selection_report, vars_, funcs, info = prepared
    special_tools = {name: info[name]["frontend_special"] for name in funcs
                     if "frontend_special" in info[name]}
    executed_messages: list[Msg] = []
    allowed = set(funcs)
    steps = 0
    while True:
        built = build_context(cells, units, tools, system_prefix,
                              system_suffix, prompt, executed_messages, selection_report)
        messages = built.messages
        yield {"type": "context", **built.counts,
               "variables": {name: info[name] for name in vars_}, "tools": funcs}
        try:
            if body.get("reasoning_effort") not in (None, "default"):
                response = await providers.complete(
                    body["backend"], body["model"], messages, tools,
                    reasoning_effort=body["reasoning_effort"],
                )
            else:
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
                if call.name in special_tools:
                    if bridge is None or run is None:
                        raise ValueError("Notebook front-end action is unavailable")
                    action = special_tools[call.name]
                    arguments = call.arguments
                    if action == "url_to_note":
                        arguments = _special_arguments(arguments)
                        if set(arguments) - {"url", "after_cell_id"}:
                            raise ValueError("Unexpected url_to_note argument")
                        url = arguments.get("url")
                        if not isinstance(url, str) or not url or len(url) > 2_000:
                            raise ValueError("url must be nonempty text of at most 2000 characters")
                        try:
                            content = await asyncio.wait_for(
                                asyncio.to_thread(fetch_url_markdown, url),
                                timeout=MAX_WEB_TOTAL_SECONDS,
                            )
                        except TimeoutError as exc:
                            raise TimeoutError("Page fetch timed out") from exc
                        arguments = {"content": content,
                                     "after_cell_id": arguments.get("after_cell_id", "")}
                        action = "insert_markdown"
                    current_id, current_kernel = await dispatcher.resolve(body["session_id"])
                    if current_id != kernel_id or current_kernel is not kernel:
                        raise ValueError("Notebook session changed kernels during the prompt")
                    event, pending = bridge.prepare(run, action, arguments)
                    yield event
                    result = await bridge.wait(run, pending)
                else:
                    result = await dispatcher.call(body["session_id"], kernel_id, kernel, allowed,
                                                   call.name, call.arguments)
            except (ValueError, TypeError, TimeoutError) as exc:
                result = f"Error: {exc}"
            results.append(result)
            yield {"type": "tool_result", "id": call.id, "name": call.name, "text": result}
        executed_messages.extend([completion.message, mk_tool_res_msg(calls, results)])
