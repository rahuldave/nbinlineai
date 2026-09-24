# Jupyter AI 3.2.0 alongside nbinlineai 0.1.9

Reviewed **2026-09-23**. This is a compatibility investigation, not a new
integration contract. It distinguishes code-level findings from isolated
co-install smokes. Those smokes made no agent, model, or provider request; a
separate [authenticated Codex ACP example](codex_acp_example_run.md) did use
an agent and is identified below.

## Versions and primary sources

- [Jupyter AI 3.2.0](https://pypi.org/project/jupyter-ai/3.2.0/) is the latest
  stable PyPI release checked on this date, published **2026-09-03** (after the
  3.2.0 release candidates). The released metapackage source is
  [tag `v3.2.0`, commit `995b53b`](https://github.com/jupyterlab/jupyter-ai/tree/995b53b651c39bf9a7744bfe0d2d85b0967b672c).
  Its [release notes](https://github.com/jupyterlab/jupyter-ai/blob/995b53b651c39bf9a7744bfe0d2d85b0967b672c/docs/source/releases/v3.2.0.md)
  say real-time collaboration became optional, while agent notebook operations
  work through frontend commands without it.
- The released dependency bounds are in
  [Jupyter AI's `pyproject.toml`](https://github.com/jupyterlab/jupyter-ai/blob/995b53b651c39bf9a7744bfe0d2d85b0967b672c/pyproject.toml):
  `jupyter_ai_acp_client>=0.3,<0.4`, `jupyter_ai_tools>=0.7,<0.8`,
  `jupyterlab_commands_toolkit>=0.2,<0.3`, and `jupyterlab_chat>=0.25,<0.26`.
  `%ai`/`%%ai` magics and RTC are optional extras.
- Representative pinned component source: [ACP client 0.3.0,
  `b27e2fd`](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/tree/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0),
  [notebook tools 0.7.0,
  `4d1c823`](https://github.com/jupyter-ai-contrib/jupyter-ai-tools/tree/4d1c823ed9e2d58c2a5690c8b7c440045df1ee01),
  [commands toolkit 0.2.0,
  `6651eb6`](https://github.com/jupyter-ai-contrib/jupyterlab-commands-toolkit/tree/6651eb6efd20689987f761d6e93178b6a7bb5d29),
  [JupyterLab AI commands 0.4.0,
  `a281ddb`](https://github.com/jupyter-ai-contrib/jupyterlab-ai-commands/tree/a281ddb0a6d79e518ff7dc33e9ad7d032375075f),
  and [Jupyter Chat 0.25.0,
  `6081b7d`](https://github.com/jupyterlab/jupyter-chat/tree/6081b7d6eaa8249171ba9be6bc51b287e131ab8b).
  These are the released versions or version floors examined, not claims about
  every later allowed patch release.
- nbinlineai reference: published **0.1.9**; local checkout at investigation
  start `6a1d9a3de3308258f08aa1dc0904f5f71923465c`. See
  [`src/index.ts`](../src/index.ts), [`nbinlineai/handlers.py`](../nbinlineai/handlers.py),
  and [`AGENTS.md`](../AGENTS.md).

## What ACP Claude and Codex actually require

Jupyter AI's [stable getting-started instructions](https://jupyter-ai.readthedocs.io/en/stable/getting-started.html)
say the metapackage does **not** install an agent. Claude Code needs the
`claude-agent-acp` executable supplied by
`@agentclientprotocol/claude-agent-acp`; Codex needs `codex-acp` supplied by
`@agentclientprotocol/codex-acp`. The released persona
[checks for the Codex executable](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/blob/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0/jupyter_ai_acp_client/acp_personas/codex.py)
and [does the same for Claude](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/blob/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0/jupyter_ai_acp_client/acp_personas/claude.py).
Their repository README still names the older `@zed-industries/*` npm scope;
follow the versioned Jupyter AI getting-started page, and confirm the installed
adapter supplies the expected executable. Jupyter AI's
[troubleshooting instructions](https://jupyter-ai.readthedocs.io/en/stable/users/troubleshooting.html)
say to authenticate through the agent CLI and restart JupyterLab if a persona
does not reply. Codex's released persona also accepts an `OPENAI_API_KEY` or
`CODEX_API_KEY` environment variable, or a `codex login` session; Claude's
persona points to `claude /login`. nbinlineai's saved OpenAI/Anthropic keys
are a separate server-side store and do **not** configure these ACP adapters.
ACP chat also does not change nbinlineai's API-only provider backend.

## Collision and interaction matrix

| Surface | Confirmed source behavior | Consequence |
| --- | --- | --- |
| Notebook executor and Run All | nbinlineai [provides `INotebookCellExecutor`](../src/index.ts) and routes native runs through its per-notebook queue. Searches of Jupyter AI's released frontend components found no competing provider. Its [MCP `run_all_cells`](https://github.com/jupyter-ai-contrib/jupyter-ai-tools/blob/4d1c823ed9e2d58c2a5690c8b7c440045df1ee01/jupyter_ai_tools/toolkits/jupyterlab.py) invokes core `notebook:run-all-cells`. | No provider-token collision. If a Jupyter AI agent invokes Run All, core JupyterLab should reach nbinlineai's executor, including AI questions, with nbinlineai's Keep/cancel/error rules and possible provider cost. Agent permissions are separate from nbinlineai's Keep policy and tool registration. The combined Run All path passed a deterministic browser smoke, described below. |
| Individual Run Cell | Jupyter AI's [MCP `run_cell`](https://github.com/jupyter-ai-contrib/jupyter-ai-tools/blob/4d1c823ed9e2d58c2a5690c8b7c440045df1ee01/jupyter_ai_tools/toolkits/jupyterlab.py) uses `jupyterlab-ai-commands:run-cell` in the default RTC-free setup. That command [calls `CodeCell.execute` directly for code and returns `no-op` for Markdown](https://github.com/jupyter-ai-contrib/jupyterlab-ai-commands/blob/a281ddb0a6d79e518ff7dc33e9ad7d032375075f/src/notebook-commands.ts). With RTC it instead invokes core `notebook:run-cell`. | **Concrete semantic mismatch:** default Jupyter AI single-cell runs bypass nbinlineai's ordered queue for code, and treat an AI question (Markdown with `metadata.nbinlineai.isPromptCell`) as a no-op. In the RTC path, the core command should reach our executor. Do not tell an ACP agent that its default single-cell tool can run an inline AI question. |
| Commands and shortcuts | nbinlineai commands use the `nbinlineai:*` namespace and adds no custom keybinding; native shortcuts use the executor. Jupyter AI's command bridge uses `jupyterlab-commands-toolkit:*` and `jupyterlab-ai-commands:*`; Jupyter Chat's [declared shortcut](https://github.com/jupyterlab/jupyter-chat/blob/6081b7d6eaa8249171ba9be6bc51b287e131ab8b/packages/jupyterlab-chat-extension/schema/commands.json) is `Accel Shift 1` to focus chat. | No command-ID or declared shortcut collision found. Jupyter AI agents can intentionally invoke generic JupyterLab commands; their effects are shared with the user's notebook. |
| Notebook mutations, metadata, and decorations | nbinlineai identifies AI cells and settings under `metadata.nbinlineai` and renders prefixed controls. Jupyter AI's [notebook tools](https://github.com/jupyter-ai-contrib/jupyter-ai-tools/blob/4d1c823ed9e2d58c2a5690c8b7c440045df1ee01/jupyter_ai_tools/toolkits/notebook.py) read/edit/add/delete real cells. Jupyter Chat's [insert/replace actions](https://github.com/jupyterlab/jupyter-chat/blob/6081b7d6eaa8249171ba9be6bc51b287e131ab8b/packages/jupyter-chat/src/active-cell-manager.ts) operate on the active cell/source. The Jupyter AI add-cell command creates new cells with ordinary metadata; set-cell-content changes source. | No namespace/decorator collision found. Mutating or deleting a tagged AI question/answer may change its meaning, break answer pairing, or change what a later nbinlineai run sees. Separate live agents can race with an inline run's frozen context snapshot; reopen/preview before relying on changed context. Jupyter AI's notebook reads may include AI answers because its tools do not apply nbinlineai's context/history policy. |
| Routes, auth, and settings | nbinlineai uses base-URL-aware `/nbinlineai/*` routes with Jupyter authentication and kernel execute authorization. The ACP client has [an `ai/acp/permissions` handler](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/blob/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0/jupyter_ai_acp_client/extension_app.py); Jupyter AI chat/router/MCP use their own endpoints, chat/settings, and permission flow. | No route collision found. Authentication to the Jupyter server is shared; agent permissions and nbinlineai tool registration/credential settings are distinct. Do not assume one system's grant or API key authorizes the other. |
| Kernel comms and magics | nbinlineai's only special comm target is [`nbinlineai.insert_tools.v1`](../nbinlineai/kernel_insert_tools.py). Jupyter AI's default notebook tools use the frontend-command event bridge and MCP, not this comm. Its optional [magics extension registers `%ai` and `%%ai` and a custom exception handler](https://github.com/jupyter-ai-contrib/jupyter-ai-magic-commands/blob/427d47ed79da6d1a06723ab17a70b13d85dc6591/jupyter_ai_magic_commands/__init__.py). | No comm-target collision found. `%ai`/`%%ai` is absent from the default Jupyter AI install, and nbinlineai registers no matching magic. If the magics extra is installed, its kernel exception hook is an additional integration surface worth testing. |
| Dependency resolution and server side effects | Both accept JupyterLab 4. The actual isolated resolver chose JupyterLab 4.6.4 for nbinlineai 0.1.9 + Jupyter AI 3.2.0. Jupyter AI 3.2.0 installs its default MCP server, which started an additional local listener on port 3001 in the smoke. | Python dependencies resolved without overrides. Reserve/check the MCP port in multi-server setups; it is not nbinlineai's route. No conclusion about every existing classroom environment follows from one fresh resolution. |

The source review found no Jupyter AI notebook cell executor provider, direct
`metadata.nbinlineai` writes, `nbinlineai:*` commands/routes, or the
`nbinlineai.insert_tools.v1` target. That is evidence of **no direct namespace
collision in these pinned releases**, not a guarantee against all third-party
extensions or future Jupyter AI updates.

## Isolated co-install smoke

Used a fresh uv environment at `.venv/jupyter-ai-compat` and installed only
published `nbinlineai==0.1.9` plus `jupyter-ai==3.2.0`. Resolution installed
JupyterLab 4.6.4, Jupyter AI ACP client 0.3.0, notebook tools 0.7.0, commands
toolkit 0.2.0, JupyterLab AI commands 0.4.0, and Jupyter Chat 0.25.1.
`jupyter labextension list` reported both nbinlineai and Jupyter AI component
extensions **enabled/OK**. An isolated JupyterLab on loopback port **8898**,
with temporary root/config/data/runtime paths, loaded both server extensions.
The Lab page returned HTTP 200, `/nbinlineai/status` returned extension
`nbinlineai` version `0.1.9`, a test notebook showed an nbinlineai Run control,
and the sidebar contained **Jupyter Chat**. No provider key was configured in
the isolated store, no ACP executable was exposed on the server PATH, and no
provider/agent/tool action was requested. Both 8898 and Jupyter AI's 3001 MCP
listener were stopped after the smoke. The user server on 8888 and QA's 8897
were untouched.

This verifies installation, server loading, endpoint routing, and initial
frontend coexistence. A follow-on execution smoke, reproducible with
`node tests/support/jupyter_ai_compat_smoke.mjs`, used the same published
packages in a fresh isolated temporary server. It patched only the installed
provider completion function with a deterministic in-process fake and saved a
fake key in the temporary XDG store; there was no API or ACP network request.
The native **Run All Cells** menu action executed setup code, waited for an
AI question to call a harmless kernel `bump` function, then executed later code
that observed its changed value (`AFTER_AI 4`). It made exactly one fake
provider request and preserved a completed paired AI answer under Keep.

With JupyterLab's test-only `expose_app_in_browser` option, the smoke invoked
the registered `jupyterlab-ai-commands:run-cell` command by `cellId`.
That command executed a code cell again (its counter output changed from 1 to
2), while a tagged AI Markdown question returned `no-op` and made no inline
provider request. Editing the tagged question's source through the notebook
model retained `metadata.nbinlineai.isPromptCell`. The harness checked 8898
and 3001 before startup and stopped its own server afterward; 8888 was
untouched. This does **not** test an actual ACP adapter/login, RTC, or
concurrent agent and user notebook mutations.

A separate [authenticated Codex ACP example run](codex_acp_example_run.md)
tested the agent path on an isolated 8899 server. Codex used Jupyter AI chat
through an existing ChatGPT login to read the notebook, edit one ordinary
Python cell, and run three ordinary code cells by explicit ID; the resulting
checks passed. It did not run an inline AI question or use nbinlineai's API
provider. This confirms actual Codex ACP notebook operations, while leaving
RTC, Claude ACP, and simultaneous agent/user edits untested.

## Cell styles and visual coexistence

The released Jupyter AI components above do not define broad CSS rules for
`.jp-Cell`, `.jp-InputArea`, or `.jp-Notebook` that repaint notebook cells.
One relevant transitive extension is
[JupyterLab Cell Input Footer 0.3.2](https://github.com/jupyter-ai-contrib/jupyterlab-cell-input-footer/tree/ee242fd51f5138787c40cf983e48c67a75cc541b): its
[CSS](https://github.com/jupyter-ai-contrib/jupyterlab-cell-input-footer/blob/ee242fd51f5138787c40cf983e48c67a75cc541b/packages/cell-input-footer-extension/style/base.css)
is scoped to `.jp-cellfooter` and descendants. Its
[content factory](https://github.com/jupyter-ai-contrib/jupyterlab-cell-input-footer/blob/ee242fd51f5138787c40cf983e48c67a75cc541b/packages/cell-input-footer/src/contentfactory.ts)
adds a footer widget to notebook cells. nbinlineai's current
[cell styling](../style/index.css) instead uses prefixed AI-cell classes for
an outer tint and border, and places its controls above the cell input.
The [published 0.1.9 style](https://github.com/rahuldave/nbinlineai/blob/v0.1.9/style/index.css)
used AI borders without the current outer tint; this smoke exercised the new
local assets on a real server, rather than inferring their appearance from CSS.

A second isolated visual smoke reused the Jupyter AI 3.2.0 environment on
8898 with the locally rebuilt **0.1.10 nbinlineai frontend assets**. The
Python server package remained published 0.1.9, so this was a style/layout
check, not a test of 0.1.10 backend features. In Chromium, the Jupyter Chat
sidebar and a four-cell notebook (ordinary Markdown, ordinary code, AI
question, completed AI answer) were visible together in both JupyterLab Light
and Dark. The Context controls sat above each cell's input; the question and
answer retained their blue/green outer tints and borders; and computed editor
backgrounds remained the theme's native color. Double-clicking the answer
opened its editor without hiding its controls or changing the native editor
background. The computed `.jp-InputArea-editor` background was
`rgb(245, 245, 245)` in Light and `rgb(33, 33, 33)` in Dark, including on both
AI cells; the AI question/answer outer borders were respectively blue/green
and 3px wide. The injected `.jp-cellfooter` was hidden on all four cells and
caused no visible overlap. No ACP adapter, model, or provider request was used. The 8888
user server and 8897 QA server were untouched; 8898 and its 3001 MCP listener
were stopped afterward.

The footer [starts hidden](https://github.com/jupyter-ai-contrib/jupyterlab-cell-input-footer/blob/ee242fd51f5138787c40cf983e48c67a75cc541b/packages/cell-input-footer/src/contentfactory.ts).
Its `show-cell-footer` command calls
[`CellFooterTracker.showFooter()`](https://github.com/jupyter-ai-contrib/jupyterlab-cell-input-footer/blob/ee242fd51f5138787c40cf983e48c67a75cc541b/packages/cell-input-footer-extension/src/index.ts)
for the active cell; another extension can call the tracker with a particular
cell ID. The factory creates it for **code, Markdown, and raw cells**, so a
visible footer is not limited to code cells. In this co-install's DOM, the
hidden footer followed the input wrapper on ordinary cells but preceded the
controls and input wrapper on both AI Markdown cells. The follow-up browser
check invoked the public `show-cell-footer` command with each AI cell active.
In Light and Dark, each visible footer occupied a **22px** row immediately
above that cell's nbinlineai controls, despite the factory's intention to put
it below the input. The footer and controls had touching edges with **no
overlap**, the controls and answer stayed readable, and the answer still
entered edit mode in Light with the footer visible. Its CSS uses relative
positioning and a `--jp-cell-editor-background` toolbar background; it has no
absolute overlay rule. This closes the layout question for the empty footer
in the pinned co-install. Additional toolbar items, other themes, or future
versions could alter its size and remain outside this check.

This is evidence for the pinned extensions, current styles, two built-in
themes, and the tested notebook state. It does not cover every theme, footer
toolbar content, future component release, or simultaneous agent edits.

## Practical setup and next checks

1. For a user who wants both, install `nbinlineai==0.1.9` and stable
   `jupyter-ai==3.2.0` in the same JupyterLab environment, then restart the
   **Jupyter server**. Install one ACP adapter and authenticate it separately
   only when that agent is wanted. Keep nbinlineai's API keys configured in its
   own UI for inline answers.
2. Explain the command distinction: Jupyter AI's **single-cell** tool in the
   default setup executes code only; use nbinlineai's Run button/native
   Shift+Enter for an AI question. Jupyter AI's **Run All** routes through the
   native command and may run inline AI questions. Avoid issuing it without
   intending those runs.
3. The [Codex ACP example](codex_acp_example_run.md) covers one real
   authenticated adapter with ordinary code-cell operations. For broader
   runtime assurance, test RTC mode, Claude ACP, and concurrent agent/user
   edits separately. The deterministic combined Run All and single-cell
   command paths above cover only the default RTC-free setup, using a fake
   provider and temporary configuration.

## 0.1.11 Extension Manager update investigation

On 2026-09-23, a reported in-app update hang was investigated in another isolated
Python 3.12.10 environment. This test installed published nbinlineai 0.1.10,
Jupyter AI 3.2.0, JupyterLab 4.6.4, jupyter-server-mcp 0.3.0 and pip 26.2.1,
then clicked **Update to 0.1.11** in the actual Extension Manager. The manager's
initial blank-query catalogue took approximately 35 seconds to load; the
nbinlineai status endpoint returned HTTP 200 throughout. The update POST returned
HTTP 201, status `ok`, and `needs_restart` including frontend and server. A fresh
installed-extension listing reported both installed and latest version 0.1.11.
The package compatibility check passed for all 175 installed distributions.

After restarting only this isolated server, the combined deterministic execution
smoke passed: native Run All ordered code, inline tool effects and later code;
Keep avoided repeating an answer; Jupyter AI's single-cell command executed code
and left AI Markdown as a no-op; source edits retained nbinlineai metadata. No
real provider or ACP agent was called. Matched startup/shutdown checks with and
without Jupyter AI also exited after two SIGINT signals, including while a real
blank-query catalogue request remained pending. These checks do not reproduce
an already engaged ACP session or an interrupted pip transaction.

The reported screenshot contains two independent pending states. JupyterLab's
thin animated blue bar represents a pending action such as an install POST;
Discover's “Updating extensions list…” represents a catalogue GET. Its PyPI
manager runs pip dry-run and installation in executor threads without a process
timeout, while catalogue enumeration uses an XML-RPC call without an explicit
network timeout. This identifies plausible places to inspect a stalled request;
it does **not** establish the cause in the reported environment. The normal
successful frontend update path explicitly refreshes the installed list, so a
simple missing-cache-invalidation explanation is insufficient.

The available user-level Jupyter configuration was inspected read-only. The
active Python settings were nbdev notebook pre-save hooks, and the extension
manager acknowledgement was enabled; no user-level nbinlineai frontend override
was found. No user configuration, package installation or notebook was changed.
The reported launcher was `uv run jupyter lab .`; its originating project folder
and exact environment were still unconfirmed at this point. Do not confuse the
source repository's editable development environment with that user environment.

For a stuck package manager, a temporary launch with
`uv run --no-sync jupyter lab --LabApp.extension_manager=readonly .` avoids the
PyPI manager and uv's automatic environment synchronization without rewriting a
configuration file. An upgrade in a uv project should also update its declared
requirements/lockfile when applicable; do not blindly perform an exact `uv sync`
that can remove unrelated extensions. Check the actual launch environment before
making changes. The user's server on port 8888 was not accessed or stopped.

### Matched Python 3.14 follow-up

The user subsequently identified the course project's launch environment. A
read-only distribution inventory established Python **3.14.0**, nbinlineai
**0.1.10**, JupyterLab **4.6.4**, Jupyter AI **3.2.0**, Jupyter Server **2.21.1**,
and pip **26.2.1**. Fastcore **2.2.30** was already installed; that snapshot does
not establish when it arrived. Neither rgapi nor exhash was installed. The
extension packages were installed additions rather than declared project
dependencies. No project files, installed packages, configuration or personal
notebooks were changed during inspection.

Both native dependencies were introduced directly by nbinlineai **0.1.11**:
`rgapi` implements `search_files` / `search_notebooks`, and `exhash` implements
`document_outline` / `read_document_section`. They are independent Answer.AI packages
identified in the dialoghelper research, not dependencies introduced by Jupyter
AI. At investigation time, [rgapi 0.1.30](https://pypi.org/project/rgapi/0.1.30/#files)
and [exhash 0.4.16](https://pypi.org/project/exhash/0.4.16/#files) had macOS ARM
wheels through CPython 3.13 but no CPython 3.14 wheel. Pip therefore selected
their source archives. Both use maturin/PyO3 and require Rust 1.91 or newer; the
test host's Rust 1.95 satisfied that requirement. The other new native
dependencies, ast-grep-py and libcst, had applicable prebuilt wheels.

A disposable Python 3.14.0 environment reproduced all **183 published package
versions** from the inventory, excluding only the user's local project package.
Using JupyterLab's pinned-version pip constraint, a dry run completed in **7.6
seconds**. Actual installation then completed successfully in **106.9 seconds**:
the exhash Rust build took **52.33 seconds**, and rgapi took **46.53 seconds**.
These figures are observations on this host, not an installation-time guarantee.
The source builds populated pip's normal wheel cache; the user's course
environment was not upgraded. The installed-package smoke verified the 55-tool
registry, eight groups, representative search/AST/documentation/execution tools,
12 packaged notebooks and 18 illustrations. All **190 installed distributions**
passed the dependency compatibility check.

A second fresh environment with the same baseline versions exercised the actual
Extension Manager upgrade on port 8897, with Jupyter AI enabled and an ephemeral
MCP port. With the newly built wheels cached, the update POST succeeded with HTTP
201 in **3.891 seconds**, requested frontend/server restart, and a refreshed
installed-extension listing reported 0.1.11. The nbinlineai status endpoint
remained responsive during catalogue loading. Only owned test servers were
stopped; no real provider/ACP agent was called.

After restarting that upgraded Python 3.14 environment, the deterministic real
kernel/browser coexistence smoke also passed: native Run All ordered code, an
inline tool effect and later code; Keep preserved a completed answer; Jupyter
AI's single-cell command executed code and treated an AI Markdown question as a
no-op; editing question source preserved its nbinlineai metadata.

This reproduces a substantial first-install delay caused by the release's new
native dependencies and concealed by JupyterLab's quiet pip invocation. It does
not by itself reproduce an indefinite freeze or the reported Ctrl-C failure.
The initial Python 3.12 release checks missed this source-build path. Do not
describe the successful cached update as proof that every cold installation or
every engaged Jupyter AI session shuts down correctly.

### Controlled shutdown probe

A separate Python 3.14 probe used a real JupyterLab server, an actual extension
install POST and a pseudo-terminal. Only the isolated bootstrap's
`jupyterlab.extensions.pypi.run` was replaced with a controlled **14-second**
blocking dry-run result, so no package was installed or removed. All Jupyter
configuration/runtime directories were disposable, the HTTP port was 8897, and
the Jupyter AI MCP port was explicitly ephemeral.

The status endpoint returned HTTP 200 before and during the simulated wait.
The first terminal Ctrl-C displayed the normal shutdown confirmation, and the
second was accepted as `received signal 2, stopping`. The HTTP request then
disconnected, but the process did not exit until the worker's wait ended:
**14.266 seconds after the accepted second Ctrl-C**. The owned server and MCP
listener exited, and scratch files were retained.

This demonstrates a conditional shutdown delay: the PyPI manager runs blocking
work through an executor, and Python waits for surviving executor threads at
interpreter shutdown. It is a simulated blocked installation, not a reproduced
native-build deadlock. Real pip/cargo child processes in the terminal's foreground
process group can themselves receive Ctrl-C. That distinction, network waits and
an already engaged ACP agent remain outside this probe; the exact reported
Ctrl-C failure is still unconfirmed.
