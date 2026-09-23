"""Live notebook tools dispatched through the authenticated JupyterLab bridge."""

from collections.abc import Callable, Mapping
from types import MappingProxyType


def _browser_only(name: str) -> str:
    raise RuntimeError(
        f"{name} requires an AI question in an open JupyterLab notebook; "
        "it cannot be called directly from Python"
    )


def find_cells(
    query: str,  # Case-insensitive text to find in live cell sources.
    cell_type: str = "",  # Optional code, markdown, or raw filter.
    limit: int = 20,  # Maximum returned matches.
) -> str:  # Bounded matching cell IDs and source previews.
    """Find live notebook cells containing text, including unsaved edits."""
    return _browser_only("find_cells")


def replace_cell(
    cell_id: str,  # Stable ID of an ordinary notebook cell.
    expected_source: str,  # Exact current source required before editing.
    new_source: str,  # Replacement source, at most 8000 characters.
) -> str:  # Live-model edit acknowledgement.
    """Replace an ordinary cell only when its source still matches."""
    return _browser_only("replace_cell")


def cell_str_replace(
    cell_id: str,  # Stable ID of an ordinary notebook cell.
    old_str: str,  # Exact literal to replace.
    new_str: str,  # Replacement literal.
    expected_matches: int = 1,  # Required occurrence count.
) -> str:  # Live-model edit acknowledgement.
    """Replace an exact string when its occurrence count matches."""
    return _browser_only("cell_str_replace")


def cell_insert_line(
    cell_id: str,  # Stable ID of an ordinary notebook cell.
    line: int,  # One-based line before which content is inserted.
    content: str,  # Text to insert.
    expected_source: str,  # Exact current source required before editing.
) -> str:  # Live-model edit acknowledgement.
    """Insert content before a line in an unchanged ordinary cell."""
    return _browser_only("cell_insert_line")


def cell_replace_lines(
    cell_id: str,  # Stable ID of an ordinary notebook cell.
    start_line: int,  # First one-based source line, inclusive.
    end_line: int,  # Last one-based source line, inclusive.
    content: str,  # Replacement source text.
    expected_source: str,  # Exact current source required before editing.
) -> str:  # Live-model edit acknowledgement.
    """Replace inclusive source lines in an unchanged ordinary cell."""
    return _browser_only("cell_replace_lines")


def delete_cell(
    cell_id: str,  # Stable ID of an ordinary notebook cell.
    expected_source: str,  # Exact current source required before deletion.
) -> str:  # Live-model deletion acknowledgement.
    """Delete an ordinary cell only when its source still matches."""
    return _browser_only("delete_cell")


def move_cell(
    cell_id: str,  # Stable ID of an ordinary notebook cell.
    after_cell_id: str,  # Stable anchor ID.
) -> str:  # Live-model move acknowledgement.
    """Move an ordinary cell after another cell without executing it."""
    return _browser_only("move_cell")


def copy_cell(
    cell_id: str,  # Stable ID of an ordinary notebook cell.
    after_cell_id: str,  # Stable anchor ID.
) -> str:  # Live-model copy acknowledgement with a new ID.
    """Copy an ordinary cell after another cell without execution results."""
    return _browser_only("copy_cell")


def split_cell(
    cell_id: str,  # Stable ID of an ordinary notebook cell.
    line: int,  # One-based line beginning the new cell.
    expected_source: str,  # Exact current source required before splitting.
) -> str:  # Live-model split acknowledgement with a new ID.
    """Split an unchanged ordinary cell before a source line."""
    return _browser_only("split_cell")


def merge_cells(
    first_cell_id: str,  # Stable ID of the first ordinary cell.
    second_cell_id: str,  # Stable ID of the adjacent second ordinary cell.
    expected_first: str,  # Exact current source of the first cell.
    expected_second: str,  # Exact current source of the second cell.
) -> str:  # Live-model merge acknowledgement.
    """Merge adjacent same-type cells when both sources match."""
    return _browser_only("merge_cells")


NOTEBOOK_TOOL_FUNCTIONS: Mapping[str, Callable[..., str]] = MappingProxyType({
    name: globals()[name] for name in (
        "find_cells", "replace_cell", "cell_str_replace", "cell_insert_line",
        "cell_replace_lines", "delete_cell", "move_cell", "copy_cell",
        "split_cell", "merge_cells",
    )
})

__all__ = [
    "NOTEBOOK_TOOL_FUNCTIONS",
    "cell_insert_line",
    "cell_replace_lines",
    "cell_str_replace",
    "copy_cell",
    "delete_cell",
    "find_cells",
    "merge_cells",
    "move_cell",
    "replace_cell",
    "split_cell",
]
