"""Read live notebook outputs and capture supported visible surfaces.

Direct Python calls return mutable receipts before the browser result arrives.
Inspect them in a later cell. Model tools receive bounded initial status and
descriptors, not image pixels. Output IDs and revisions guard changed output.
"""

from __future__ import annotations

from typing import Any

from .browser_receipt import BrowserReceipt, request_browser_operation


def read_notebook_view() -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Describe the originating notebook's active, selected and visible cells."""
    return request_browser_operation('read_notebook_view', {})


def read_selection(
    max_chars: int = 2000,  # Maximum selected characters to return, up to 3000.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Read selected text only when its editor belongs to this notebook."""
    return request_browser_operation('read_selection', {'max_chars': max_chars})


def list_outputs(
    cell_id: str,  # Stable ID of a live code cell in the originating notebook.
    cursor: str = '',  # Page cursor from the preceding result, or empty for the first page.
    limit: int = 10,  # Maximum output descriptors, from 1 through 20.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """List existing outputs of a live code cell without materializing renderers."""
    return request_browser_operation('list_outputs', {'cell_id': cell_id, 'cursor': cursor, 'limit': limit})


def read_output(
    cell_id: str,  # Stable ID of a live code cell in the originating notebook.
    output_id: str,  # ID of an existing output from list_outputs.
    revision: int,  # Output revision from list_outputs; a changed output is rejected.
    mime: str = 'text/plain',  # Requested text or structured MIME type in this output.
    start: int = 0,  # Zero-based character offset in the selected representation.
    max_chars: int = 2000,  # Maximum characters in this slice, from 1 through 3000.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Read bounded text or structured data from one unchanged output."""
    return request_browser_operation('read_output', {'cell_id': cell_id, 'output_id': output_id,
        'revision': revision, 'mime': mime, 'start': start, 'max_chars': max_chars})


def export_output(
    cell_id: str,  # Stable ID of a live code cell in the originating notebook.
    output_id: str,  # ID of an existing output from list_outputs.
    revision: int,  # Output revision from list_outputs; a changed output is rejected.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    mime: str = '',  # MIME type to export, or empty for the supported default.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Export an existing image, SVG, or bounded data MIME without rerunning its cell."""
    return request_browser_operation('export_output', {'cell_id': cell_id, 'output_id': output_id,
        'revision': revision, 'save_to': save_to, 'mime': mime})


def list_canvases(
    cell_id: str,  # Stable ID of a live code cell in the originating notebook.
    output_id: str,  # ID of an existing output from list_outputs.
    revision: int,  # Output revision from list_outputs; a changed output is rejected.
    cursor: str = '',  # Page cursor from the preceding result, or empty for the first page.
    limit: int = 10,  # Maximum canvas descriptors, from 1 through 20.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """List supported live canvases in this output's materialized renderer."""
    return request_browser_operation('list_canvases', {'cell_id': cell_id, 'output_id': output_id,
        'revision': revision, 'cursor': cursor, 'limit': limit})


def capture_canvas(
    canvas: dict[str, Any],  # Bound canvas reference returned by list_canvases.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    max_size: int = 1280,  # Maximum longest image edge in pixels, from 1 through 4096.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Request a still from one origin-clean bound canvas.

    With save_to=None, the completed Python result is a PIL image.
    """
    return request_browser_operation('capture_canvas', {'canvas': canvas, 'save_to': save_to,
        'max_size': max_size})


def export_canvas(
    canvas: dict[str, Any],  # Bound canvas reference returned by list_canvases.
    save_to: str | None = 'auto',  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    max_size: int = 1280,  # Maximum longest image edge in pixels, from 1 through 4096.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Save a still from one bound canvas, or retain it in memory with None."""
    return request_browser_operation('export_canvas', {'canvas': canvas, 'save_to': save_to,
        'max_size': max_size})


def start_canvas(
    canvas: dict[str, Any],  # Bound canvas reference returned by list_canvases.
    frame_rate: int = 30,  # Requested canvas rate, from 1 through 60 frames per second.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Open a video-only canvas source for the shared recorder."""
    return request_browser_operation('start_canvas', {'canvas': canvas, 'frame_rate': frame_rate})


def capture_notebook_region(
    cell_ids: list[str],  # One through twelve distinct live cell IDs with visible supported outputs.
    save_to: str | None = None,  # None keeps media in memory; auto or a server-root-relative path saves a new file.
    max_size: int = 1280,  # Maximum longest image edge in pixels, from 1 through 4096.
) -> BrowserReceipt:  # Mutable browser receipt; inspect its later status and result.
    """Capture supported visible output surfaces from the originating notebook."""
    return request_browser_operation('capture_notebook_region', {'cell_ids': cell_ids,
        'save_to': save_to, 'max_size': max_size})


BROWSER_OUTPUT_TOOL_FUNCTIONS = {
    name: globals()[name] for name in (
        'read_notebook_view', 'read_selection', 'list_outputs', 'read_output', 'export_output',
        'list_canvases', 'capture_canvas', 'export_canvas', 'start_canvas', 'capture_notebook_region')
}
