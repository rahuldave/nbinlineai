"""Build the Markdown site and all saved notebooks with smalldocs, without execution."""

from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from pathlib import Path, PurePosixPath

if __package__:
    from .smalldocs_notebook import decorate
else:
    from smalldocs_notebook import decorate

ROOT = Path(__file__).resolve().parents[1]


def notebook_sources(examples: Path) -> list[Path]:
    """Include gallery notebooks and nested supporting fixtures."""
    return sorted(
        source for source in examples.rglob("*.ipynb")
        if not any(part.startswith(".") for part in source.relative_to(examples).parts)
    )


def source_hashes(sources: list[Path]) -> dict[Path, str]:
    return {source: hashlib.sha256(source.read_bytes()).hexdigest() for source in sources}


def build(root: Path = ROOT) -> tuple[int, int]:
    """Build in a scratch project, then replace only the ignored output site."""
    from smalldocs.site import build as build_smalldocs

    docs = root / "docs"
    examples = root / "examples"
    site = docs / "_site"
    sources = notebook_sources(examples)
    if not sources:
        raise ValueError("no example notebooks found")
    before = source_hashes(sources)
    if site.is_symlink():
        raise ValueError(f"refusing symlink output folder: {site}")
    with tempfile.TemporaryDirectory(prefix="nbinlineai-smalldocs-") as temp:
        staged = Path(temp) / "docs"
        shutil.copytree(
            docs,
            staged,
            ignore=shutil.ignore_patterns("_site", ".quarto", "__pycache__"),
        )
        for source in sources:
            relative = PurePosixPath(source.relative_to(examples).as_posix())
            target = staged / "notebooks" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            notebook = json.loads(source.read_text(encoding="utf-8"))
            target.write_text(json.dumps(decorate(notebook, relative), ensure_ascii=False), encoding="utf-8")
        rendered = build_smalldocs(staged, quiet=True)
        if rendered.warnings:
            raise ValueError("smalldocs warnings: " + "; ".join(rendered.warnings))
        result = staged / "_site"
        if not (result / "index.html").is_file():
            raise ValueError("smalldocs did not render the site index")
        for source in sources:
            relative = source.relative_to(examples).with_suffix(".html")
            if not (result / "notebooks" / relative).is_file():
                raise ValueError(f"missing rendered notebook: {relative}")
        if before != source_hashes(sources):
            raise ValueError("source notebooks changed during rendering")
        if site.exists():
            shutil.rmtree(site)
        shutil.copytree(result, site)
    return len(sources), len(list(site.rglob("*.html")))


def main() -> None:
    notebooks, pages = build()
    print(f"smalldocs site: {pages} pages, {notebooks} saved notebooks; no execution")


if __name__ == "__main__":
    main()
