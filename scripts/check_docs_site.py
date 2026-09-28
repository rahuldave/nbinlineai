"""Check the rendered Quarto site before publishing it to GitHub Pages."""

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()
        self.references: list[str] = []
        self.classes: list[str] = []
        self.table_rows: list[list[str]] = []
        self._table = False
        self._row: list[str] | None = None
        self._cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.add(attributes["id"])
        self.classes.extend((attributes.get("class") or "").split())
        if tag in ("a", "link") and attributes.get("href"):
            self.references.append(attributes["href"])
        if tag in ("img", "script") and attributes.get("src"):
            self.references.append(attributes["src"])
        if tag == "table":
            self._table = True
        elif tag == "tr" and self._table:
            self._row = []
        elif tag in ("th", "td") and self._row is not None:
            self._cell = True
            self._row.append("")

    def handle_data(self, data: str) -> None:
        if self._cell and self._row is not None:
            self._row[-1] += data

    def handle_endtag(self, tag: str) -> None:
        if tag in ("th", "td"):
            self._cell = False
        elif tag == "tr" and self._row is not None:
            self.table_rows.append(self._row)
            self._row = None
        elif tag == "table":
            self._table = False


REQUIRED_PAGES = [
    "index.html", "user-guide.html", "tools.html", "examples.html",
    "faq.html", "architecture.html", "prior-art.html", "development.html",
    *[f"manual/{name}.html" for name in (
        "setup", "prompts", "models-and-styles", "editing-and-running",
        "context-selection", "variables-and-tools", "saving-and-privacy",
        "troubleshooting",
    )],
]


def check(site: Path, examples: Path | None = None) -> list[str]:
    problems: list[str] = []
    pages: dict[Path, Page] = {}
    examples = examples or Path(__file__).resolve().parents[1] / "examples"
    sources = sorted(examples.glob("*.ipynb"))
    notebook_pages = [f"notebooks/{source.stem}.html" for source in sources]
    for relative in [*REQUIRED_PAGES, *notebook_pages]:
        path = site / relative
        if not path.is_file():
            problems.append(f"missing page: {relative}")
            continue
        page = Page()
        page.feed(path.read_text(encoding="utf-8"))
        pages[path.resolve()] = page
    if not (site / ".nojekyll").is_file():
        problems.append("missing .nojekyll in rendered site")
    gallery = pages.get((site / "examples.html").resolve())
    if gallery:
        listing_links = {ref.rsplit("/", 1)[-1] for ref in gallery.references
                         if re.search(r"(?:^|/)notebooks/[a-z0-9-]+\.html$", ref)}
        if len(listing_links) != len(sources):
            problems.append(f"expected {len(sources)} notebook links, found {len(listing_links)}")
        for relative in notebook_pages:
            if not any(ref.endswith(relative) for ref in gallery.references):
                problems.append(f"examples guide does not link to {relative}")
    for source, relative in zip(sources, notebook_pages):
        page = pages.get((site / relative).resolve())
        if not page:
            continue
        if "—title:" in (site / relative).read_text(encoding="utf-8"):
            problems.append(f"{relative}: Quarto front matter appears as page text")
        notebook = json.loads(source.read_text(encoding="utf-8"))
        for key, css in (("isPromptCell", "nbinlineai-ai-prompt"),
                         ("isOutputCell", "nbinlineai-ai-response")):
            expected = sum(bool(cell.get("metadata", {}).get("nbinlineai", {}).get(key))
                           for cell in notebook["cells"])
            actual = page.classes.count(css)
            if actual != expected:
                problems.append(f"{relative}: expected {expected} {css} panels, found {actual}")
        download = f"https://github.com/rahuldave/nbinlineai/blob/main/examples/{source.name}"
        if download not in page.references:
            problems.append(f"{relative}: missing source notebook download link")
    for path, page in list(pages.items()):
        for reference in page.references:
            url = urlsplit(reference)
            if url.netloc:
                if (url.scheme != "https" or url.netloc != "rahuldave.com"
                        or not url.path.startswith("/nbinlineai/")):
                    continue
            elif url.scheme or reference.startswith("//"):
                continue
            target = unquote(url.path)
            if target.startswith("/nbinlineai/"):
                target_path = site / target.removeprefix("/nbinlineai/")
            elif target.startswith("/"):
                continue
            else:
                target_path = path.parent / target if target else path
            if target_path.is_dir():
                target_path /= "index.html"
            target_path = target_path.resolve()
            if not target_path.is_relative_to(site.resolve()) or not target_path.exists():
                problems.append(f"{path.relative_to(site)}: broken local link {reference}")
            elif url.fragment and target_path.suffix == ".html":
                destination = pages.get(target_path)
                if destination is None:
                    destination = Page()
                    destination.feed(target_path.read_text(encoding="utf-8"))
                    pages[target_path] = destination
                if unquote(url.fragment) not in destination.ids:
                    problems.append(f"{path.relative_to(site)}: broken anchor {reference}")
    tools_path = (site / "tools.html").resolve()
    if tools_path not in pages:
        return problems
    tools = tools_path.read_text(encoding="utf-8")
    if re.search(r"<p>\s*\|\s*Function\s*\|\s*Purpose\s*\|", tools):
        problems.append("function index was emitted as literal Markdown")
    tool_rows = [row for row in pages[tools_path].table_rows
                 if row and "(" in row[0] and ")" in row[0]]
    if len(tool_rows) != 51:
        problems.append(f"expected 51 rendered tool rows, found {len(tool_rows)}")
    return problems


if __name__ == "__main__":
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/_site").resolve()
    errors = check(site)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print("Quarto site: pages, notebook gallery, AI panels, 51 tool rows, local links and anchors OK")
