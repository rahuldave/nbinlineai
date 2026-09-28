#!/usr/bin/env python3
"""Quarto ipynb filter for publishing the original example notebooks.

Quarto passes notebook JSON on stdin and receives presentation-only changes on
stdout. Source .ipynb files are never copied, edited, or executed.
"""

from __future__ import annotations

import json
import os
import re
import sys

GITHUB_EXAMPLES = "https://github.com/rahuldave/nbinlineai/blob/main/examples"


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


def decorate(notebook: dict, name: str) -> dict:
    title, description = notebook_summary(notebook["cells"], name)
    # JSON string syntax is valid YAML for these scalars. A list of lines is
    # required here: Quarto's ipynb reader flattens string source newlines.
    front_matter = (
        "---\n"
        f"title: {json.dumps(title, ensure_ascii=False)}\n"
        f"description: {json.dumps(description, ensure_ascii=False)}\n"
        "execute:\n  enabled: false\n"
        "---\n"
    )
    notebook["cells"].insert(
        0,
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": front_matter.splitlines(keepends=True),
        },
    )
    for cell in notebook["cells"]:
        if cell["cell_type"] != "markdown":
            continue
        ai = cell.get("metadata", {}).get("nbinlineai", {})
        kind = (
            "prompt" if ai.get("isPromptCell") else "response" if ai.get("isOutputCell") else None
        )
        if kind:
            cell_id = cell.get("id", "")
            anchor = f" #{cell_id}" if re.fullmatch(r"[A-Za-z][\w-]*", cell_id) else ""
            decorated = (
                f"::: {{.nbinlineai-ai-cell .nbinlineai-ai-{kind}{anchor}}}\n\n"
                + cell_source(cell).rstrip()
                + "\n\n:::\n"
            )
            cell["source"] = decorated.splitlines(keepends=True)
    notebook["cells"].append(
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                (
                    f"[← Examples guide](../examples.html) · "
                    f"[Download this notebook]({GITHUB_EXAMPLES}/{name})\n"
                )
            ],
        }
    )
    return notebook


def main() -> None:
    name = os.environ["NBINLINEAI_NOTEBOOK_NAME"]
    if "/" in name or "\\" in name or not name.endswith(".ipynb"):
        raise ValueError("NBINLINEAI_NOTEBOOK_NAME must be a notebook filename")
    notebook = json.load(sys.stdin)
    json.dump(decorate(notebook, name), sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
