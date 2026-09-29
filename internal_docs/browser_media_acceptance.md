# Browser-media acceptance inventory (source checkpoints)

Status: working acceptance record for 96 public functions and three setup helpers in the combined source catalog. PR 32 has merged Phase B into `main` at `b38d684b2f2b503f2e515961d9dd369f43c95c7e`; draft PR 33 carries Phase C at source checkpoint `b215ae8f9d84275e6e06ccc0f03cdadc8c98c382`, with a later local browser-fixture repair at `8155e4e8d128d69b6c4428de8393b3a9bc3e92e5`. This is **source implementation evidence**, not a package release. PR 33 still needs independent repair review, final CI and merge; a catalog mapping alone is not a browser pass.

Approved prework: browser-media spec at committed `main` `61fa3fe517999d8f88ff328a99fc86a34dfb470b`; selected task prompt `e3fcf33b20ec10cd511129cd1672b98d307e4a5c` (merged as PR 26). The current Quarto notebook-gallery policy is recorded at `8ce8e2e618f0ce04bba8bcbb9522d2122b62f9e1` (PR 30). The initial PR 31 catalog `e5ba74f2c38f0e66c6cc7aec9ac43916929b5367` mapped 83 public functions and three helpers; PR 31 merged to `main` as `11eae2ba02f670335842d3e1363bf5cff7c42733`. The combined catalog at independently accepted `fee308d` maps all 96 public functions and three helpers. The source-only additions do not change the published PyPI 0.1.15 package or constitute a release.

Each row names a real notebook section and stable **call cell**. A `→` names its later inspection cell. Executable Python call cells invoke the named function, while model-facing Markdown cells contain concrete AI questions that request the named tool; the evidence keys below distinguish their execution coverage. Browser receipt rows inspect `status` later. The Quarto site renders every `examples/*.ipynb` as `notebooks/<stem>.html` and checks cell anchors. The repository notebooks are the source of truth until their delivery PR merges. `tests/test_tool_catalog_coverage.py` dynamically compares all 96 public names and signatures with `TOOL_FUNCTIONS` and checks all 99 public/helper mappings for sections, appropriate calls or questions, later receipt inspections and canonical URLs. The catalog checkpoint rendered 24 notebooks, 46 pages and 96 tool rows and passed 47 catalog/site checks; its mappings and docs received independent review. Ownership by delivery slice: catalog Sol owns the PR 27 rows and final shared mapping; foundation Sol owns the five prerequisite APIs; capture Sol owns Group 2; outputs Sol owns Group 3; playback and transforms Sol owns Groups 4 and 5; attachment Sol owns Group 6. The root orchestrator owns PR integration and final acceptance.

Evidence keys used in **each row**:

- `K`: that catalog cell was executed in an isolated kernel by `tests/test_examples.py`. `M`: the catalog AI question is concrete and the same registered call passed a focused isolated JupyterLab regression; the catalog question itself was not necessarily rerun. `D`: exact catalog `list_cells` question ran with a deterministic provider in real JupyterLab. `I`: `insert_tools` has a focused browser regression; its catalog UI cell was skipped headlessly. `N`: network example is a concrete optional question, with no public-network call in routine checks. `E`: environment-dependent tmux/skill question is concrete, with no assumed local service/skill. `U`: existing `insert_markdown` browser coverage was not rerun for PR 27. These 51 original tools and three helpers are the PR 27 catalog slice; their independent catalog/source review and CI passed before merge, while the per-row limits just stated remain.
- `F`: foundation five-tool public notebook and kernel completed in isolated Chromium, Firefox and WebKit (9/9 focused cases per engine at accepted `c876fd4`); independent Sol source review accepted. Its final PR 29 CI at `65e7eea` passed 343 Python, 84 browser cases with two explicit skips, all 14 runtime variants and the Quarto check. PR 29 merged to `main` as `90c5aeed050bcb577072917d4f657ef08529a971`. `C`: capture's exact 17-tool notebook completed within the independent ten-case combined Chromium run at PR 31 source `e5ba74f`; B independently accepted capture runtime. `O`: the exact ten-tool outputs notebook completed in that same independent combined Chromium run; Python/source/frontend checks and independent Sol repair review `81ef159` also passed. PR 31 source CI at `e5ba74f` was green with 381 Python and 94 browser cases plus two explicit skips, all 14 runtime variants and Quarto; PR 31 merged to `main` as `11eae2b`. This is source delivery, not a PyPI release. `P`: playback's exact nine-tool notebook completed in authored isolated Chromium and WebKit JupyterLab/kernel runs, with Firefox import/clipboard/image cases but its valid WAV stalled at `readyState=1`; independent Sol review accepted lifecycle repair `ce479b4`. `T`: transform exact three-tool notebook completed authored Chromium and WebKit actual-pixel/frame runs; Firefox VP9 fixture decode was unsupported while PNG cases passed. Independent Sol reviewed source and accepted the race/timestamp repair `1dbb764`; the Phase B combined output/transform Chromium cases later passed 2/2 at `8e8d43c`. PR 32 source CI passed after the duration repair and merged. `A`: attachment has focused registry/model/HTTP fixtures and its exact public notebook passed one isolated Chromium/kernel browser case at `59e8fdd` after a reserved result-key repair; C independently accepted that repair and the Phase C source integration at `529855b`. PR 33 CI passed the exact attachment notebook and native-image integration; its unrelated foundation duplicate-operation browser assertion has a locally passing fixture repair awaiting independent review and final CI.

Universal limits: no paid/live provider, personal-media, real camera/microphone/display hardware, mobile browser, branded Edge or actual Safari test has been claimed for these media additions. Headless Firefox WAV and VP9 fixture limitations are scoped to those pinned test browsers and codecs, not claims about branded browser/device support. Browser permission and chooser actions always require the user. No apps/widgets, inline-JS app adapters, JupyterLite, execution handoff, RLM or successor work is in this inventory. Memory receipts, saved files and model-visible descriptors have distinct lifetimes; see the foundation handoff for ownership and expiry. PR 29, PR 31 and PR 32 are merged source checkpoints. Draft PR 33's local browser-fixture repair still requires independent review, final CI and merge. None is a package release.

## PR27 original inspection — `tool-catalog-inspection.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `search_kernel_names` | `search_kernel_names`; `catalog-demo-search_kernel_names` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `inspect_python` | `inspect_python`; `catalog-demo-inspect_python` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `show_doc` | `show_doc`; `catalog-demo-show_doc` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `api_names` | `api_names`; `catalog-demo-api_names` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `search_docs` | `search_docs`; `catalog-demo-search_docs` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `inspect_value` | `inspect_value`; `catalog-demo-inspect_value` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `search_value` | `search_value`; `catalog-demo-search_value` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `source_files` | `source_files`; `catalog-demo-source_files` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `list_skills` | `list_skills`; `catalog-demo-list_skills` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `read_skill` | `read_skill`; `catalog-demo-read_skill` | E | PR 27 reviewed/merged; see evidence key for runtime scope |
| `trace_function` | `trace_function`; `catalog-demo-trace_function` | K | PR 27 reviewed/merged; see evidence key for runtime scope |

## PR27 original files — `tool-catalog-files.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `path_info` | `path_info`; `catalog-demo-path_info` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `list_files` | `list_files`; `catalog-demo-list_files` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `view_file` | `view_file`; `catalog-demo-view_file` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `create_file` | `create_file`; `catalog-demo-create_file` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `file_str_replace` | `file_str_replace`; `catalog-demo-file_str_replace` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `file_insert_line` | `file_insert_line`; `catalog-demo-file_insert_line` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `file_replace_lines` | `file_replace_lines`; `catalog-demo-file_replace_lines` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `search_files` | `search_files`; `catalog-demo-search_files` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `source_doc` | `source_doc`; `catalog-demo-source_doc` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `document_outline` | `document_outline`; `catalog-demo-document_outline` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `read_document_section` | `read_document_section`; `catalog-demo-read_document_section` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `file_strs_replace` | `file_strs_replace`; `catalog-demo-file_strs_replace` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `view_file_hashes` | `view_file_hashes`; `catalog-demo-view_file_hashes` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `file_replace_checked` | `file_replace_checked`; `catalog-demo-file_replace_checked` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `tool_catalog` | `Work with disposable saved files`; `catalog-setup-tool_catalog` | K | PR 27 reviewed/merged; see evidence key for runtime scope |

## PR27 original saved notebooks — `tool-catalog-saved-notebooks.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `list_notebooks` | `list_notebooks`; `catalog-demo-list_notebooks` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `find_notebook_cells` | `find_notebook_cells`; `catalog-demo-find_notebook_cells` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `read_notebook_cell` | `read_notebook_cell`; `catalog-demo-read_notebook_cell` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `search_notebooks` | `search_notebooks`; `catalog-demo-search_notebooks` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `notebook_outline` | `notebook_outline`; `catalog-demo-notebook_outline` | K | PR 27 reviewed/merged; see evidence key for runtime scope |

## PR27 original live notebook — `tool-catalog-live-notebook.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `list_cells` | `list_cells`; `catalog-demo-list_cells` | D | PR 27 reviewed/merged; see evidence key for runtime scope |
| `read_cell` | `read_cell`; `catalog-demo-read_cell` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `find_cells` | `find_cells`; `catalog-demo-find_cells` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `insert_markdown` | `insert_markdown`; `catalog-demo-insert_markdown` | U | PR 27 reviewed/merged; see evidence key for runtime scope |
| `insert_code` | `insert_code`; `catalog-demo-insert_code` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `replace_cell` | `replace_cell`; `catalog-demo-replace_cell` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `cell_str_replace` | `cell_str_replace`; `catalog-demo-cell_str_replace` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `cell_insert_line` | `cell_insert_line`; `catalog-demo-cell_insert_line` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `cell_replace_lines` | `cell_replace_lines`; `catalog-demo-cell_replace_lines` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `delete_cell` | `delete_cell`; `catalog-demo-delete_cell` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `move_cell` | `move_cell`; `catalog-demo-move_cell` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `copy_cell` | `copy_cell`; `catalog-demo-copy_cell` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `split_cell` | `split_cell`; `catalog-demo-split_cell` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `merge_cells` | `merge_cells`; `catalog-demo-merge_cells` | M | PR 27 reviewed/merged; see evidence key for runtime scope |
| `tools_markdown` | `Inspect and edit this live notebook`; `catalog-setup-tools_markdown` | K | PR 27 reviewed/merged; see evidence key for runtime scope |

## PR27 original web — `tool-catalog-web.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `read_url` | `read_url`; `catalog-demo-read_url` | N | PR 27 reviewed/merged; see evidence key for runtime scope |
| `read_url_section` | `read_url_section`; `catalog-demo-read_url_section` | N | PR 27 reviewed/merged; see evidence key for runtime scope |
| `url_to_note` | `url_to_note`; `catalog-demo-url_to_note` | M | PR 27 reviewed/merged; see evidence key for runtime scope |

## PR27 original processes — `tool-catalog-processes.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `run_python` | `run_python`; `catalog-demo-run_python` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `run_shell` | `run_shell`; `catalog-demo-run_shell` | K | PR 27 reviewed/merged; see evidence key for runtime scope |
| `tmux_sessions` | `tmux_sessions`; `catalog-demo-tmux_sessions` | E | PR 27 reviewed/merged; see evidence key for runtime scope |
| `tmux_read` | `tmux_read`; `catalog-demo-tmux_read` | E | PR 27 reviewed/merged; see evidence key for runtime scope |

## PR27 setup helper — `live-variables-and-tools.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `insert_tools` | `Optional: add a declaration from Python`; `live-insert-tools-optional` | I | PR 27 reviewed/merged; see evidence key for runtime scope |

## foundation prerequisite / PR 29 — `browser-media-foundation.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `browser_capabilities` | `browser_capabilities`; `media-capabilities-call` → `media-capabilities-inspect` | F | PR 29 merged; PyPI unchanged |
| `save_media` | `save_media`; `media-save-call` → `media-save-inspect` | F | PR 29 merged; PyPI unchanged |
| `operation_status` | `operation_status`; `media-status-call` → `media-status-inspect` | F | PR 29 merged; PyPI unchanged |
| `cancel_operation` | `cancel_operation`; `media-cancel-call` → `media-cancel-inspect` | F | PR 29 merged; PyPI unchanged |
| `release_media` | `release_media`; `media-release-call` → `media-release-inspect` | F | PR 29 merged; PyPI unchanged |

## Group 2 capture / PR 31 — `browser-media-capture.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `list_media_sources` | `list_media_sources`; `capture-list_media_sources-call` → `capture-list_media_sources-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `start_camera` | `start_camera`; `capture-start_camera-call` → `capture-start_camera-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `start_microphone` | `start_microphone`; `capture-start_microphone-call` → `capture-start_microphone-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `capture_camera` | `capture_camera`; `capture-capture_camera-call` → `capture-capture_camera-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `stop_source` | `stop_source`; `capture-stop_source-call` → `capture-stop_source-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `start_recording` | `start_recording`; `capture-start_recording-call` → `capture-start_recording-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `pause_recording` | `pause_recording`; `capture-pause_recording-call` → `capture-pause_recording-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `resume_recording` | `resume_recording`; `capture-resume_recording-call` → `capture-resume_recording-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `stop_recording` | `stop_recording`; `capture-stop_recording-call` → `capture-stop_recording-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `record_camera` | `record_camera`; `capture-record_camera-call` → `capture-record_camera-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `record_microphone` | `record_microphone`; `capture-record_microphone-call` → `capture-record_microphone-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `read_audio_levels` | `read_audio_levels`; `capture-read_audio_levels-call` → `capture-read_audio_levels-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `setup_share` | `setup_share`; `capture-setup_share-call` → `capture-setup_share-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `start_share` | `start_share`; `capture-start_share-call` → `capture-start_share-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `capture_screen` | `capture_screen`; `capture-capture_screen-call` → `capture-capture_screen-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `capture_tool` | `capture_tool`; `capture-capture_tool-call` → `capture-capture_tool-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `stop_share` | `stop_share`; `capture-stop_share-call` → `capture-stop_share-inspect` | C | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |

## Group 3 outputs / PR 31 — `browser-media-outputs.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `read_notebook_view` | `Inspect the existing notebook`; `view-call` → `view-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `read_selection` | `Inspect the existing notebook`; `selection-call` → `selection-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `list_outputs` | `An already-rendered canvas`; `canvas-output-list-call` → `canvas-output-list-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `read_output` | `Inspect the existing notebook`; `output-read-call` → `output-read-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `export_output` | `Inspect the existing notebook`; `output-export-call` → `output-export-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `list_canvases` | `An already-rendered canvas`; `canvas-list-call` → `canvas-list-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `capture_canvas` | `An already-rendered canvas`; `canvas-capture-call` → `canvas-capture-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `export_canvas` | `An already-rendered canvas`; `canvas-export-call` → `canvas-export-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `start_canvas` | `An already-rendered canvas`; `canvas-start-call` → `canvas-start-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |
| `capture_notebook_region` | `Capture a supported visible output region`; `region-call` → `region-inspect` | O | independent exact notebook passed at `e5ba74f`; PR 31 merged; no release |

## Group 4 playback / dependent topic — `browser-media-playback.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `choose_file` | `choose_file`; `playback-choose-call` → `playback-choose-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |
| `open_media` | `open_media`; `playback-open-call` → `playback-open-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |
| `play_media` | `play_media`; `playback-play-call` → `playback-play-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |
| `pause_media` | `pause_media`; `playback-pause-call` → `playback-pause-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |
| `seek_media` | `seek_media`; `playback-seek-call` → `playback-seek-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |
| `set_media_volume` | `set_media_volume`; `playback-volume-call` → `playback-volume-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |
| `close_media` | `close_media`; `playback-close-call` → `playback-close-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |
| `copy_text` | `copy_text`; `playback-copy-call` → `playback-copy-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |
| `paste_content` | `paste_content`; `playback-paste-call` → `playback-paste-inspect` | P | author browser complete; independent source accepted; PR 32 CI green and merged as source |

## Group 5 transforms / dependent topic — `browser-media-transforms.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `extract_frames` | `extract_frames`; `transform-frames-call` → `transform-frames-inspect` | T | author Chromium/WebKit notebook complete; independent source accepted; Phase B cross-family Chromium 2/2; PR 32 CI green and merged as source |
| `crop_image` | `crop_image`; `transform-crop-call` → `transform-crop-inspect` | T | author Chromium/WebKit notebook complete; independent source accepted; Phase B cross-family Chromium 2/2; PR 32 CI green and merged as source |
| `annotate_image` | `annotate_image`; `transform-annotate-call` → `transform-annotate-inspect` | T | author Chromium/WebKit notebook complete; independent source accepted; Phase B cross-family Chromium 2/2; PR 32 CI green and merged as source |

## Group 6 attachment / dependent topic — `browser-media-attachment.ipynb`

| Function | Section; call → later inspection | Evidence | Review / status |
| --- | --- | --- | --- |
| `attach_media` | `attach_media — confirm the image for this question`; `attachment-call` → `attachment-inspect` | A | exact notebook Chromium 1/1 at `59e8fdd`; independent repair review accepted; final Phase C PR/CI pending |

## Evidence locations and final reconciliation

- PR 27 original tool catalog: `examples/tool-coverage.json`, `tests/test_tool_catalog_coverage.py`, `tests/test_examples.py`, `tests/e2e/tool-catalog-live.spec.ts` and the six `tool-catalog-*.ipynb` notebooks. Optional web/tmux/skills cases retain their explicit `N`/`E` scope.
- Foundation: `tests/test_browser_media.py`, `tests/test_browser_media_handlers.py`, `tests/e2e/browser-media-foundation.spec.ts`, and `internal_docs/browser_media_foundation_handoff.md` at accepted `c876fd4` (later narrow fixes reviewed separately).
- Capture: `tests/test_browser_capture_tools.py`, `tests/frontend/browserMediaRecorder.test.ts`, `tests/e2e/browser-media-capture.spec.ts`, `examples/browser-media-capture.ipynb`; runtime author tree through Unicode label repair `c30c623`. The exact 17-tool notebook passed within the independent ten-case Chromium source run at `e5ba74f`; PR 31 merged; retain package-release boundary.
- Outputs: `tests/test_browser_output_tools.py`, `tests/frontend/browserNotebookOutputs.test.ts`, `tests/e2e/browser-media-outputs-notebook.spec.ts`, `examples/browser-media-outputs.ipynb`; independently reviewed repair `81ef159`. The exact ten-tool notebook passed in the same independent source run at `e5ba74f`; PR 31 merged; retain package-release boundary.
- Playback: `tests/test_browser_playback_tools.py`, `tests/frontend/browserMediaDecoder.test.ts`, `tests/e2e/browser-media-playback.spec.ts`, `examples/browser-media-playback.ipynb`; independent review accepted `8037e7a..ce479b4`, with later bounded Unicode paste in the transform topic. Its Firefox WAV limitation remains pending codec-specific investigation only.
- Transforms/storage: `tests/test_browser_transform_tools.py`, `tests/test_browser_media_provenance.py`, `tests/frontend/browserMediaTransforms.test.ts`, `tests/e2e/browser-media-transforms.spec.ts`, `examples/browser-media-transforms.ipynb`; independent review accepted `c0574fd..1dbb764` repair after finding a frame callback/bitmap mismatch and a source-release race. The repaired exact notebook ran on Chromium and WebKit; Firefox VP9 fixture decode remains unsupported in the pinned headless engine.
- Attachment: `tests/test_browser_attachment_tools.py`, `tests/e2e/browser-media-attachment.spec.ts`, `examples/browser-media-attachment.ipynb`, and its topic handoff at `e822e5e`. Exact notebook Chromium 1/1 passed at `59e8fdd`; C independently accepted the repair and Phase C `529855b` source integration. The final PR gate remains pending.
- Cross-family output-to-question flow: `examples/browser-media-integration.ipynb`, `tests/e2e/browser-media-integration.spec.ts`, the bounded `E2E_MEDIA_NATIVE_IMAGE` branch in `tests/support/e2e_server.py`, and `tests/test_e2e_media_native_image.py`. After the Phase C `0a4eaa4` merge, one isolated Chromium/JupyterLab/kernel case passed: a disposable existing output was exported to owned memory, previewed, cropped to verified 4×4 pixels, then explicitly saved with its exact provenance sidecar and confirmed for one question. A separate earlier question received zero native images; text-only preview reported bounded ordinary context, and both confirmed-image previews reported numeric `round_wire_chars` within 64,000. Preview did not execute the question or rerun the source/export/crop/save cells. The explicit Run click delivered exactly one native `InputImage` to the deterministic provider entry with SHA-256 equal to the crop descriptor. The generated file and sidecar were removed. This offline fixture does not exercise a paid/live API or prove provider wire serialization or comparative image-budget growth; `tests/test_browser_attachment_transport.py` and the attachment budget tests separately cover payload construction and exact cost. B independently accepted the final native-image test at `2be92b6`; the final Phase C PR and CI remain pending.

The combined frontend unit suite passed 96 tests at `2be92b6`. B's attachment compatibility repair `332998230c49123805d53c2b199cdec86b8445a0` passed the full 452-test Python suite on Python 3.14; C independently accepted it after 75 focused tests, and root integrated it cleanly into final Phase C source head `3e17e8cef0c89a48713be37997bab74e388d63b4`. PR 33 source run `36507603446` subsequently passed 452 Python and 97 frontend tests. Its overall source gate failed on the separate duplicate-operation browser assertion described below, so final CI and merge remain pending.

The combined source catalog at `fee308d` maps all 96 `TOOL_FUNCTIONS` names plus three setup helpers in `examples/tool-coverage.json`; the 96 public rows are also present in `docs/tools.md`. The catalog checkpoint rendered 24 notebooks, 46 pages and 96 tool rows and passed 47 catalog/site checks; its mappings and docs received independent review. An earlier PR 32 Linux Chromium CI run (`36504677613`) failed its 900 ms synthetic canvas recording → `extract_frames` case because the recorded WebM reported nonfinite duration before decoding. The bounded, abortable browser end-seek repair and reset-cancellation regression reached independently accepted `4074f3e1abfd22a44c53ab3c565f64b49f566fcc`; rebuilt local Chromium reran the recording and public transforms notebook cases successfully (2/2). PR 32 source run `36507558071` then passed on Linux with 420 Python, 97 frontend and 102 browser cases plus two explicit skips; all 14 runtime variants and Quarto passed. PR 32 merged to `main` as `b38d684b2f2b503f2e515961d9dd369f43c95c7e` at 01:43 UTC. Draft PR 33 source run `36507603446` at `b215ae8f9d84275e6e06ccc0f03cdadc8c98c382` passed 103 browser cases, including the exact attachment notebook and native-image integration, with two skips; one foundation duplicate-operation assertion failed because its UI completion-message count was one rather than the expected four. Its documentation and all 14 runtime variants passed. The fixture had registered four private names although the 40 public family handlers left only three registration slots; the last `fixture_release_replay` registration was unsupported. Local repair `8155e4e8d128d69b6c4428de8393b3a9bc3e92e5` consolidated that assertion into `fixture_dedup` without changing the production cap or its exact-once, stable-ID, concurrent-release and terminal-replay checks. After a fresh build and relink, the targeted Chromium case passed once and on three repeats, and the full foundation browser file passed 9/9 locally. Independent repair review and PR 33 final CI and merge remain pending. These source merges do not change published PyPI 0.1.15.

The interim Phase B source merge `dc0fc7c32fd41fea10df78b5f5c63a89ecac187f` (then main ancestry `b57531fd52c3b6b7b2a20c73640e21c03e68bc95`) received an independent merge-resolution review: shared operation registration, recorder admission, bounded output saving, transform provenance, and the original family tests were preserved; 109 focused cross-family Python tests passed in the independent review tree. The playback/transform catalog and two combined Chromium cases subsequently passed at `8e8d43c`; that earlier merge checkpoint did not itself deliver PR 32.
