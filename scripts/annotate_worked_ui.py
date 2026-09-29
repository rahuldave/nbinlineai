"""Publish verified ordinary JupyterLab observations after a worked-notebook merge.

The private input records actions performed in a disposable notebook copy. This
step only annotates mapped comparison cells; it never changes code, AI answers,
tool traces, or the source that the direct/AI merger already checked.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

ROW_KEYS = frozenset({"notebook", "cellId", "name", "completed", "observedBefore", "observedAfter"})
PRIVATE_TEXT = re.compile(
    r"(?:Bearer\s+|sk-[A-Za-z0-9_-]{20,}|/Users/|/home/|/tmp/|"
    r"/(?:private/)?var/folders/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})",
    re.IGNORECASE,
)


def _source(cell: dict[str, Any]) -> str:
    source = cell.get("source", "")
    if isinstance(source, list) and all(isinstance(line, str) for line in source):
        return "".join(source)
    if isinstance(source, str):
        return source
    raise ValueError("comparison cell has invalid source")


def _safe_observation(value: Any, label: str) -> str:
    if (not isinstance(value, str) or not 0 < len(value.strip()) <= 300
            or value != value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value)
            or any(char in value for char in "<>`[]|\\") or PRIVATE_TEXT.search(value)):
        raise ValueError(f"{label} must be a bounded, private-data-free plain sentence")
    return value


def annotate(examples_dir: Path, observations: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Return fully validated notebook replacements without writing any files."""
    if not isinstance(observations, list) or not observations:
        raise ValueError("UI observation manifest must be a nonempty list")
    coverage = json.loads((examples_dir / "tool-coverage.json").read_text(encoding="utf-8"))
    allowed = {
        name: entry["normal_example"] for name, entry in coverage.items()
        if isinstance(entry, dict) and isinstance(entry.get("normal_example"), dict)
        and entry["normal_example"].get("mode") == "jupyterlab"
    }
    if len(observations) > len(allowed):
        raise ValueError("UI manifest contains more actions than mapped JupyterLab tools")

    notebooks: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()
    for row in observations:
        if not isinstance(row, dict) or set(row) != ROW_KEYS or row.get("completed") is not True:
            raise ValueError("UI observation has missing, extra, or uncompleted fields")
        name, notebook, cell_id = row["name"], row["notebook"], row["cellId"]
        if (not isinstance(name, str) or name not in allowed or name in seen
                or not isinstance(notebook, str) or not isinstance(cell_id, str)):
            raise ValueError("UI observation names an unknown or repeated mapped tool")
        mapping = allowed[name]
        if notebook != mapping["notebook"] or cell_id != mapping["cell_id"]:
            raise ValueError("UI observation does not match its mapped notebook cell")
        before = _safe_observation(row["observedBefore"], "observedBefore")
        after = _safe_observation(row["observedAfter"], "observedAfter")
        seen.add(name)

        path = examples_dir / notebook
        if (Path(notebook).name != notebook or not notebook.endswith(".ipynb")
                or path.is_symlink() or not path.resolve().is_relative_to(examples_dir.resolve())):
            raise ValueError("UI observation has an unsafe notebook path")
        if notebook not in notebooks:
            notebooks[notebook] = json.loads(path.read_text(encoding="utf-8"))
        cells = notebooks[notebook].get("cells")
        if not isinstance(cells, list) or sum(cell.get("id") == cell_id for cell in cells) != 1:
            raise ValueError("mapped comparison cell is missing or repeated")
        cell = next(cell for cell in cells if cell["id"] == cell_id)
        source = _source(cell)
        if (cell.get("cell_type") != "markdown"
                or not source.startswith(f'<span id="{cell_id}"></span>\n')
                or "manual comparison" not in source.lower()):
            raise ValueError("mapped comparison cell has changed its source prefix")
        metadata = cell.get("metadata")
        if not isinstance(metadata, dict):
            raise TypeError("comparison cell has invalid metadata")
        prior = metadata.get("nbinlineaiWorkedUIActions", [])
        if not isinstance(prior, list):
            raise TypeError("comparison cell has invalid prior UI observations")
        prior_names: set[str] = set()
        prior_sentences: list[str] = []
        for action in prior:
            if (not isinstance(action, dict) or set(action) != ROW_KEYS - {"notebook", "cellId"}
                    or action.get("completed") is not True or action.get("name") in prior_names
                    or action.get("name") not in allowed
                    or allowed[action["name"]]["notebook"] != notebook
                    or allowed[action["name"]]["cell_id"] != cell_id):
                raise ValueError("comparison cell has invalid prior UI observations")
            _safe_observation(action["observedBefore"], "prior observedBefore")
            _safe_observation(action["observedAfter"], "prior observedAfter")
            prior_sentences.append(
                f'Observed in JupyterLab (`{action["name"]}`): {action["observedAfter"]}'
            )
            prior_names.add(action["name"])
        existing_sentences = [line for line in source.splitlines()
                              if line.startswith("Observed in JupyterLab")]
        if existing_sentences != prior_sentences:
            raise ValueError("comparison cell has unverified observation prose")
        if name in prior_names:
            raise ValueError("UI observation repeats an already published action")

        sentence = f"Observed in JupyterLab (`{name}`): {after}"
        updated = source.rstrip("\n") + "\n\n" + sentence + "\n"
        cell["source"] = updated.splitlines(keepends=True) if isinstance(cell["source"], list) else updated
        metadata["nbinlineaiWorkedUIActions"] = [*prior, {
            "name": name, "completed": True,
            "observedBefore": before, "observedAfter": after,
        }]
    return notebooks


def publish(examples_dir: Path, manifest: Path) -> list[str]:
    """Validate a private manifest, then atomically replace affected notebooks."""
    observations = json.loads(manifest.read_text(encoding="utf-8"))
    replacements = annotate(examples_dir, observations)
    staged: list[tuple[Path, Path]] = []
    try:
        for notebook, data in replacements.items():
            target = examples_dir / notebook
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=examples_dir,
                prefix=f".{notebook}.", suffix=".tmp", delete=False,
            ) as stream:
                temporary = Path(stream.name)
                json.dump(data, stream, ensure_ascii=False, indent=1)
                stream.write("\n")
            staged.append((temporary, target))
        for temporary, target in staged:
            os.replace(temporary, target)
    finally:
        for temporary, _target in staged:
            temporary.unlink(missing_ok=True)
    return sorted(replacements)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Private JSON array of observed UI actions")
    parser.add_argument("--examples-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "examples")
    args = parser.parse_args()
    changed = publish(args.examples_dir, args.manifest)
    print(f"Annotated {len(changed)} worked notebook(s) from verified UI observations")


if __name__ == "__main__":
    main()
