"""Read existing live notebook output and view state through browser receipts."""

from __future__ import annotations

from typing import Any

from .browser_receipt import BrowserReceipt, request_browser_operation


def read_notebook_view() -> BrowserReceipt:
    """Describe the originating notebook's active, selected and visible cells."""
    return request_browser_operation('read_notebook_view', {})


def read_selection(max_chars: int = 2000) -> BrowserReceipt:
    """Read selected text only when its editor belongs to this notebook."""
    return request_browser_operation('read_selection', {'max_chars': max_chars})


def list_outputs(cell_id: str, cursor: str = '', limit: int = 10) -> BrowserReceipt:
    """List existing outputs of a live code cell without materializing renderers."""
    return request_browser_operation('list_outputs', {'cell_id': cell_id, 'cursor': cursor, 'limit': limit})


def read_output(cell_id: str, output_id: str, revision: int, mime: str = 'text/plain',
                start: int = 0, max_chars: int = 2000) -> BrowserReceipt:
    """Read bounded text or structured data from one unchanged output."""
    return request_browser_operation('read_output', {'cell_id': cell_id, 'output_id': output_id,
        'revision': revision, 'mime': mime, 'start': start, 'max_chars': max_chars})


def export_output(cell_id: str, output_id: str, revision: int, save_to: str | None = None,
                  mime: str = '') -> BrowserReceipt:
    """Export an existing image, SVG, or bounded data MIME without rerunning its cell."""
    return request_browser_operation('export_output', {'cell_id': cell_id, 'output_id': output_id,
        'revision': revision, 'save_to': save_to, 'mime': mime})


def list_canvases(cell_id: str, output_id: str, revision: int, cursor: str = '',
                  limit: int = 10) -> BrowserReceipt:
    """List supported live canvases in this output's materialized renderer."""
    return request_browser_operation('list_canvases', {'cell_id': cell_id, 'output_id': output_id,
        'revision': revision, 'cursor': cursor, 'limit': limit})


def capture_canvas(canvas: dict[str, Any], save_to: str | None = None,
                   max_size: int = 1280) -> BrowserReceipt:
    """Capture one origin-clean bound canvas as an in-memory PIL image."""
    return request_browser_operation('capture_canvas', {'canvas': canvas, 'save_to': save_to,
        'max_size': max_size})


def export_canvas(canvas: dict[str, Any], save_to: str | None = 'auto',
                  max_size: int = 1280) -> BrowserReceipt:
    """Save a still from one bound canvas, or retain it in memory with None."""
    return request_browser_operation('export_canvas', {'canvas': canvas, 'save_to': save_to,
        'max_size': max_size})


def start_canvas(canvas: dict[str, Any], frame_rate: int = 30) -> BrowserReceipt:
    """Open a video-only canvas source for the shared recorder."""
    return request_browser_operation('start_canvas', {'canvas': canvas, 'frame_rate': frame_rate})


def capture_notebook_region(cell_ids: list[str], save_to: str | None = None,
                            max_size: int = 1280) -> BrowserReceipt:
    """Capture supported visible output surfaces from the originating notebook."""
    return request_browser_operation('capture_notebook_region', {'cell_ids': cell_ids,
        'save_to': save_to, 'max_size': max_size})


BROWSER_OUTPUT_TOOL_FUNCTIONS = {
    name: globals()[name] for name in (
        'read_notebook_view', 'read_selection', 'list_outputs', 'read_output', 'export_output',
        'list_canvases', 'capture_canvas', 'export_canvas', 'start_canvas', 'capture_notebook_region')
}
