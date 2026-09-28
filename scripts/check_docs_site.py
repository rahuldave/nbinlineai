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
        self.table_rows: list[list[str]] = []
        self._table = False
        self._row: list[str] | None = None
        self._cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.add(attributes["id"])
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
CATALOG = Path(__file__).resolve().parents[1] / "examples" / "tool-coverage.json"
TOOL_SIGNATURE = re.compile(r"^([a-z][a-z0-9_]*)\s*\(")


def public_tool_names(coverage_path: Path = CATALOG) -> set[str]:
    """The separate catalog test checks this mapping against the live registry."""
    coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
    return {name for name, entry in coverage.items() if not entry.get("setup_helper")}


def check(site: Path, coverage_path: Path = CATALOG) -> list[str]:
    problems: list[str] = []
    pages: dict[Path, Page] = {}
    expected_tools = public_tool_names(coverage_path)
    for path in sorted(site.rglob("*.html")):
        page = Page()
        page.feed(path.read_text(encoding="utf-8"))
        pages[path.resolve()] = page
    for relative in REQUIRED_PAGES:
        path = site / relative
        if not path.is_file():
            problems.append(f"missing page: {relative}")
    if not (site / ".nojekyll").is_file():
        problems.append("missing .nojekyll in rendered site")
    for path, page in list(pages.items()):
        for reference in page.references:
            url = urlsplit(reference)
            if url.scheme or url.netloc or reference.startswith("//"):
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
                 if row and TOOL_SIGNATURE.match(row[0].strip())]
    rendered = [TOOL_SIGNATURE.match(row[0].strip()).group(1) for row in tool_rows]
    missing = sorted(expected_tools - set(rendered))
    unexpected = sorted(set(rendered) - expected_tools)
    duplicates = sorted({name for name in rendered if rendered.count(name) > 1})
    if missing:
        problems.append(f"missing rendered tool rows: {', '.join(missing)}")
    if unexpected:
        problems.append(f"unexpected rendered tool rows: {', '.join(unexpected)}")
    if duplicates:
        problems.append(f"duplicate rendered tool rows: {', '.join(duplicates)}")
    return problems


if __name__ == "__main__":
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/_site").resolve()
    errors = check(site)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print(f"Quarto site: {len(list(site.rglob('*.html')))} pages, "
          f"{len(public_tool_names())} tool rows, local links and anchors OK")
