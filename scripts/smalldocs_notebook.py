"""Make a presentation-only copy of a saved notebook for smalldocs.

The source notebook is never changed or executed. smalldocs reads the copied
JSON and displays its stored outputs; these additions supply stable cell links,
AI prompt/answer styling, and a link back to the downloadable source.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import PurePosixPath

GITHUB_EXAMPLES = "https://github.com/rahuldave/nbinlineai/blob/main/examples"
CELL_ID = re.compile(r"^[A-Za-z0-9_-]+$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def cell_source(cell: dict) -> str:
    source = cell.get("source", "")
    return "".join(source) if isinstance(source, list) else source


def notebook_summary(cells: list[dict], name: str) -> tuple[str, str]:
    markdown = [cell_source(cell).strip() for cell in cells if cell["cell_type"] == "markdown"]
    title = next(
        (
            line[2:].strip()
            for source in markdown
            for line in source.splitlines()
            if line.startswith("# ")
        ),
        name.removesuffix(".ipynb").replace("-", " ").title(),
    )
    description = ""
    for source in markdown:
        for paragraph in re.split(r"\n\s*\n", source):
            paragraph = paragraph.strip()
            if paragraph and not paragraph.startswith(("#", "!", "|", "```", ":::")):
                description = re.sub(r"\s+", " ", paragraph)
                break
        if description:
            break
    return title, description


def close_open_fence(source: str) -> str:
    """End a truncated saved Markdown fence at its cell boundary.

    One worked notebook intentionally ends a saved source excerpt mid-fence.
    smalldocs combines Markdown cells into one document, so without a closing
    fence, all subsequent page navigation would become code text.
    """
    opened: str | None = None
    for line in source.splitlines():
        match = FENCE.match(line)
        if not match:
            continue
        marker, tail = match.groups()
        if opened is None:
            opened = marker
        elif marker[0] == opened[0] and len(marker) >= len(opened) and not tail.strip():
            opened = None
    return source if opened is None else source.rstrip("\n") + "\n" + opened + "\n"


def decorate(notebook: dict, source_path: PurePosixPath) -> dict:
    """Return a deep-copied notebook ready for static, no-execution rendering."""
    if source_path.is_absolute() or source_path.suffix != ".ipynb" or any(
        part in ("", ".", "..") for part in source_path.parts
    ):
        raise ValueError("source_path must be a relative .ipynb path under examples")
    rendered = copy.deepcopy(notebook)
    cells = rendered["cells"]
    title, description = notebook_summary(cells, source_path.name)
    cells.insert(
        0,
        {
            "cell_type": "raw",
            "metadata": {},
            "source": (
                "---\n"
                f"title: {json.dumps(title, ensure_ascii=False)}\n"
                f"description: {json.dumps(description, ensure_ascii=False)}\n"
                "---\n"
            ),
        },
    )
    for cell in cells[1:]:
        cell_id = cell.get("id", "")
        if not cell_id:
            continue
        if not CELL_ID.fullmatch(cell_id):
            raise ValueError(f"unsupported notebook cell ID: {cell_id!r}")
        source = cell_source(cell)
        if cell["cell_type"] == "code":
            # smalldocs strips this Quarto-style option before displaying code.
            cell["source"] = f"#| label: {cell_id}\n" + source
        elif cell["cell_type"] == "markdown":
            ai = cell.get("metadata", {}).get("nbinlineai", {})
            kind = (
                "prompt" if ai.get("isPromptCell") else "response" if ai.get("isOutputCell") else None
            )
            classes = f" .nbinlineai-ai-cell .nbinlineai-ai-{kind}" if kind else ""
            fence = ":" * max(4, max((len(m.group()) for m in re.finditer(r":{3,}", source)), default=0) + 1)
            content = close_open_fence(source).rstrip("\n")
            cell["source"] = f"{fence} {{#{cell_id}{classes}}}\n\n{content}\n\n{fence}\n"
    back = "../" * len(source_path.parts)
    cells.append(
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": (
                f"[← Examples guide]({back}examples.html) · "
                f"[Download this notebook]({GITHUB_EXAMPLES}/{source_path.as_posix()})\n"
            ),
        }
    )
    return rendered
