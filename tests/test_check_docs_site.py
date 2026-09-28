"""Regression checks for the rendered documentation gate."""

import json
from pathlib import Path

from scripts.check_docs_site import REQUIRED_PAGES, check


def _catalog(tmp_path: Path, names: tuple[str, ...] = ('alpha', 'beta')) -> Path:
    path = tmp_path / 'coverage.json'
    path.write_text(json.dumps({**{name: {} for name in names},
                                'tool_catalog': {'setup_helper': True}}), encoding='utf-8')
    return path


def _site(tmp_path: Path, names: tuple[str, ...] = ('alpha', 'beta')) -> Path:
    for name in REQUIRED_PAGES:
        page = tmp_path / name
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text('<h1 id="title">Title</h1>', encoding="utf-8")
    (tmp_path / ".nojekyll").touch()
    rows = "".join(f"<tr><td>{name}()</td><td>Purpose</td></tr>" for name in names)
    (tmp_path / "tools.html").write_text(f"<table>{rows}</table>", encoding="utf-8")
    return tmp_path


def test_valid_rendered_site_passes(tmp_path: Path) -> None:
    assert check(_site(tmp_path), _catalog(tmp_path)) == []


def test_catalog_growth_requires_the_new_tool_identity(tmp_path: Path) -> None:
    site = _site(tmp_path)
    catalog = _catalog(tmp_path, ('alpha', 'beta', 'gamma'))
    assert 'missing rendered tool rows: gamma' in check(site, catalog)
    (site / 'tools.html').write_text('<table><tr><td>alpha()</td></tr>'
                                     '<tr><td>beta()</td></tr><tr><td>gamma()</td></tr></table>',
                                     encoding='utf-8')
    assert check(site, catalog) == []


def test_wrong_or_duplicate_name_fails_even_when_count_matches(tmp_path: Path) -> None:
    site = _site(tmp_path)
    catalog = _catalog(tmp_path)
    (site / 'tools.html').write_text('<table><tr><td>alpha()</td></tr>'
                                     '<tr><td>wrong()</td></tr></table>', encoding='utf-8')
    errors = check(site, catalog)
    assert 'missing rendered tool rows: beta' in errors
    assert 'unexpected rendered tool rows: wrong' in errors
    (site / 'tools.html').write_text('<table><tr><td>alpha()</td></tr>'
                                     '<tr><td>alpha()</td></tr></table>', encoding='utf-8')
    assert 'duplicate rendered tool rows: alpha' in check(site, catalog)


def test_literal_markdown_table_fails(tmp_path: Path) -> None:
    site = _site(tmp_path)
    (site / "tools.html").write_text("<p>| Function | Purpose |</p>", encoding="utf-8")
    assert any("literal Markdown" in error for error in check(site, _catalog(tmp_path)))
    assert any("missing rendered tool rows" in error for error in check(site, _catalog(tmp_path)))


def test_broken_page_anchor_and_asset_fail(tmp_path: Path) -> None:
    site = _site(tmp_path)
    (site / "index.html").write_text(
        '<a href="tools.html#missing">Tool section</a>'
        '<a href="manual/missing.html">Missing page</a>'
        '<img src="images/missing.png">',
        encoding="utf-8",
    )
    errors = check(site, _catalog(tmp_path))
    assert any("broken anchor" in error for error in errors)
    assert sum("broken local link" in error for error in errors) == 2


def test_links_in_new_rendered_pages_are_checked(tmp_path: Path) -> None:
    site = _site(tmp_path)
    catalog = _catalog(tmp_path)
    (site / 'browser-media-foundation.html').write_text(
        '<a href="../examples/browser-media-foundation.ipynb">Notebook</a>'
        '<a href="tools.html#missing-anchor">Tools</a>', encoding='utf-8')
    errors = check(site, catalog)
    assert any('browser-media-foundation.html: broken local link' in error for error in errors)
    assert any('browser-media-foundation.html: broken anchor' in error for error in errors)
