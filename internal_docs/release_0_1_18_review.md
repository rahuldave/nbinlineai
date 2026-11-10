# Version 0.1.18 release and review record

Status: **release candidate; publication pending**, November 10, 2026.

## Scope and provenance

The user requested that a selected code cell include its displayed output, including direct results, prints/stdout and stderr, and that a catalog group can be inserted as an editable Markdown declaration after the calling cell. This mainline patch excludes notebook-agent experiments. The output requirement supersedes the historical 0.1.8 source-only snapshot contract.

Approved pre-work and implementation baseline: clean main `5806f51f30affb309a591fb3cd1d566ef9700ce7`, checked against origin. Primary `/Users/rahul/Projects/nbinlineai` stays on main. Root owns `/Users/rahul/.codex/worktrees/print-context-catalog/nbinlineai`, branch `codex/print-output-tool-catalog`, PR base main. The bounded output implementation uses a separate worker-owned topic worktree `/Users/rahul/.codex/worktrees/printed-context-worker/nbinlineai`, branch `codex/printed-context`, before integration into the release topic. Gest parent `zqwqzsnv`, iteration `plousuwk`; [issue #50](https://github.com/rahuldave/nbinlineai/issues/50).

## Implemented behavior

- Selected source and displayed textual output form one context unit. Streams, direct/display results, errors and rich text/data fallbacks preserve order and carry labels. Empty-source code with output is eligible. Live output contributes to preview revisions and request validation. Each cell's displayed output is bounded to 12,000 characters with a truncation marker; snapshot and submission limits still apply. Images/binary payloads retain the explicit attachment/media path.
- Output is read from the live model, including unsaved/offscreen cells, without rerunning code. It can be stale relative to edited source. Output text never declares tools or resolves live variables.
- `insert_tool_catalog(group="starter")` delegates to the existing execution-bound `insert_tools` transport. It inserts an ordinary editable Markdown declaration immediately below the calling cell. Starter is 19 tools; named groups remain within the 20-name tool/variable limit. Imports, normal saves and later receipt inspection remain explicit.
- Public context, privacy, tools, FAQ, architecture, README and notebook examples describe these behaviors. The new example's execution evidence is gathered with a deterministic isolated JupyterLab run.

## Verification and review

Pending final integration, independent adversarial review, full local checks, required PR CI and artifact checks. No paid model/device test is claimed. Test servers use owned isolated port 8897; the user's port 8888 is untouched.

## Publication

Pending reviewed merge, checked artifacts and clean installation, PyPI upload, tag, public download hashes and documentation-site verification. PyPI remains 0.1.17 at this candidate checkpoint.
