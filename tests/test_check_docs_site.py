"""Regression checks for the rendered documentation gate."""

from pathlib import Path

from scripts.check_docs_site import REQUIRED_PAGES, check


def _site(tmp_path: Path) -> Path:
    for name in REQUIRED_PAGES:
        page = tmp_path / name
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text('<h1 id="title">Title</h1>', encoding="utf-8")
    (tmp_path / ".nojekyll").touch()
    rows = "".join(f"<tr><td>tool_{i}()</td><td>Purpose</td></tr>" for i in range(51))
    (tmp_path / "tools.html").write_text(f"<table>{rows}</table>", encoding="utf-8")
    return tmp_path


def test_valid_rendered_site_passes(tmp_path: Path) -> None:
    assert check(_site(tmp_path)) == []


def test_literal_markdown_table_fails(tmp_path: Path) -> None:
    site = _site(tmp_path)
    (site / "tools.html").write_text("<p>| Function | Purpose |</p>", encoding="utf-8")
    assert any("literal Markdown" in error for error in check(site))
    assert any("expected 51" in error for error in check(site))


def test_broken_page_anchor_and_asset_fail(tmp_path: Path) -> None:
    site = _site(tmp_path)
    (site / "index.html").write_text(
        '<a href="tools.html#missing">Tool section</a>'
        '<a href="manual/missing.html">Missing page</a>'
        '<img src="images/missing.png">',
        encoding="utf-8",
    )
    errors = check(site)
    assert any("broken anchor" in error for error in errors)
    assert sum("broken local link" in error for error in errors) == 2
