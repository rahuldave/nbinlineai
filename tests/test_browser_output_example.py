"""Public output notebook is a real, ordered ten-tool walkthrough."""

import ast
import json
from pathlib import Path

from nbinlineai.browser_output_tools import BROWSER_OUTPUT_TOOL_FUNCTIONS

EXAMPLE = Path(__file__).resolve().parents[1] / 'examples/browser-media-outputs.ipynb'
PAIRS = {
    'read_notebook_view': ('view-call', 'view-inspect'),
    'read_selection': ('selection-call', 'selection-inspect'),
    'list_outputs': ('outputs-list-call', 'outputs-list-inspect'),
    'read_output': ('output-read-call', 'output-read-inspect'),
    'export_output': ('output-export-call', 'output-export-inspect'),
    'list_canvases': ('canvas-list-call', 'canvas-list-inspect'),
    'capture_canvas': ('canvas-capture-call', 'canvas-capture-inspect'),
    'export_canvas': ('canvas-export-call', 'canvas-export-inspect'),
    'start_canvas': ('canvas-start-call', 'canvas-start-inspect'),
    'capture_notebook_region': ('region-call', 'region-inspect'),
}


def test_each_output_tool_is_called_and_inspected_later():
    notebook = json.loads(EXAMPLE.read_text())
    cells = {cell['id']: (index, cell) for index, cell in enumerate(notebook['cells'])}
    assert set(PAIRS) == set(BROWSER_OUTPUT_TOOL_FUNCTIONS)
    assert len(cells) == len(notebook['cells'])
    for name, (call_id, inspect_id) in PAIRS.items():
        call_index, call = cells[call_id]
        inspect_index, inspect = cells[inspect_id]
        assert call_index < inspect_index
        source = ''.join(call['source'])
        tree = ast.parse(source)
        assert any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                   and node.func.id == name for node in ast.walk(tree)), name
        assert 'status' in ''.join(inspect['source'])
        assert 'nbinlineai-ui-only' in call['metadata']['tags']
        assert 'nbinlineai-ui-only' in inspect['metadata']['tags']
    for fixture in ('output-raster', 'output-text', 'output-vector', 'output-canvas', 'region-raster'):
        assert fixture in cells
    assert 'fixture_' not in EXAMPLE.read_text()
