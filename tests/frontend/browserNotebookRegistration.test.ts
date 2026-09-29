import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBrowserOperation } from '../../src/browserMediaClient';
import { registerBrowserNotebookOutputs } from '../../src/browserNotebookOutputs';
import { registerBrowserNotebookViews } from '../../src/browserNotebookViews';
import { registerBrowserNotebookCanvas } from '../../src/browserNotebookCanvas';
import { registerBrowserNotebookRegion } from '../../src/browserNotebookRegion';

test('plugin startup explicitly registers every output operation once', () => {
  for (const register of [registerBrowserNotebookOutputs, registerBrowserNotebookViews,
    registerBrowserNotebookCanvas, registerBrowserNotebookRegion]) {
    register();
    register();
  }
  for (const name of ['read_notebook_view', 'read_selection', 'list_outputs', 'read_output',
    'export_output', 'list_canvases', 'capture_canvas', 'export_canvas', 'start_canvas',
    'capture_notebook_region']) assert.equal(hasBrowserOperation(name), true, name);
});
