"""Published gallery questions retain their completed worked answers."""

import json
from pathlib import Path

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def test_every_gallery_question_has_one_completed_nonempty_answer():
    missing = []
    for path in sorted(EXAMPLES.glob("*.ipynb")):
        notebook = json.loads(path.read_text(encoding="utf-8"))
        for prompt in notebook["cells"]:
            if not prompt.get("metadata", {}).get("nbinlineai", {}).get("isPromptCell"):
                continue
            completed = []
            for cell in notebook["cells"]:
                ai = cell.get("metadata", {}).get("nbinlineai", {})
                source = cell.get("source", "")
                text = "".join(source) if isinstance(source, list) else source
                if (ai.get("isOutputCell") and ai.get("promptCellId") == prompt["id"]
                        and ai.get("status") == "done" and text.strip()):
                    completed.append(cell)
            if len(completed) != 1:
                missing.append(f"{path.name}:{prompt['id']} ({len(completed)} completed answers)")
    assert not missing, "Gallery questions need saved worked answers:\n" + "\n".join(missing)
