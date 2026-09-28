"""Render original example .ipynb files directly to the Quarto site as HTML."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
SITE = ROOT / "docs" / "_site"


def main() -> None:
    if not (SITE / "index.html").is_file():
        raise SystemExit("Render the docs site before rendering example notebooks")
    sources = sorted(EXAMPLES.glob("*.ipynb"))
    for source in sources:
        env = os.environ.copy()
        env["NBINLINEAI_NOTEBOOK_NAME"] = source.name
        subprocess.run(
            [
                "quarto",
                "render",
                str(source),
                "--no-execute",
                "--output-dir",
                "../docs/_site/notebooks",
                "--quiet",
            ],
            cwd=ROOT,
            env=env,
            check=True,
        )
    print(f"Rendered {len(sources)} source notebooks directly to HTML")


if __name__ == "__main__":
    main()
