# Jupyter AI directories and permissions: measured prior art

Research date: **2026-09-24**. Supports the
[subscription integration spec](chatgpt_subscription_integration.md). No runtime
feature or release was added. Only synthetic files were used; port 8888 and
personal notebooks/configuration were untouched.

## Different directories have different purposes

Jupyter AI persists its conversation as a separate chat document. That document
can be in a different folder from the notebook being discussed. A chat document
in `course/` and a notebook in `course/week2/` therefore need not imply the same
agent working directory. nbinlineai's conversation lives in the notebook itself,
so the analogous working directory is the notebook's parent.

Working directory controls relative paths; permissions control actual access.
Neither a notebook parent nor the Lab content root automatically confines Python.

## Experiment 1: real Jupyter session and Python kernel

Used the repository environment: JupyterLab **4.6.4**, Jupyter Server **2.21.1**.
Started an owned isolated Jupyter Server with the Lab extension on **8897**,
temporary configuration/data/runtime/kernel specification, synthetic token and
notebook, and no provider request. Created a real session through the authenticated
Jupyter REST API and executed Python over its authenticated kernel channel.

| Item | Observed value/result |
| --- | --- |
| Server process cwd | `<temporary>/launcher/` |
| Configured ServerApp root | `<temporary>/course/` |
| Effective filesystem ContentsManager root | `<temporary>/course/` |
| Notebook session path | `week2/lesson.ipynb` |
| Initial kernel cwd | `<temporary>/course/week2/` |
| Read synthetic file in course root | Succeeded |
| Read synthetic sibling file outside course root | Succeeded |
| Write synthetic sibling file outside course root | Succeeded |
| Change kernel cwd to course root | Succeeded |

macOS canonicalizes `/tmp` through `/private/tmp`; comparisons accounted for that.
The owned session/server were stopped and port 8897 was confirmed released.
This measured kernel behavior, not a model's choice of file operations.

## Experiment 2: actual Jupyter AI ACP session setup, fake transport

Installed released **jupyter-ai-acp-client 0.3.0** in a disposable uv environment.
Invoked real `PersonaManager.get_chat_dir`, `BasePersona.get_chat_dir`, and
`JaiAcpClient.create_session/load_session` with a recording fake ACP connection.
No agent process, model call, login or Jupyter server was needed.

The test kept all locations different: server root, server process cwd,
`server-root/course/chat/assistant.chat`, and
`server-root/course/notebooks/lesson.ipynb`.

Both session creation and loading sent **the chat document's parent** as ACP
`cwd`: `server-root/course/chat/`. Neither sent a sandbox or permission setting.
The empty MCP-server list in this synthetic fixture does not imply real sessions
have no MCP server. The agent executable launch omits process cwd, while the
later ACP session request explicitly supplies the chat directory.

Source evidence at
[`b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0`](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/tree/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0):

- [`default_acp_client.py`](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/blob/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0/jupyter_ai_acp_client/default_acp_client.py): session cwd; permission callback; file reads/writes use supplied paths without root containment (direct `.ipynb` writes are rejected).
- [`base_acp_persona.py`](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/blob/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0/jupyter_ai_acp_client/base_acp_persona.py): executable startup and session lifecycle.
- [`routes.py`](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/blob/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0/jupyter_ai_acp_client/routes.py) and [`tool-calls.tsx`](https://github.com/jupyter-ai-contrib/jupyter-ai-acp-client/blob/b27e2fd932613fcfbbd75c9b8c5920abc9e84ef0/src/tool-calls.tsx): resolve and display permission choices when the adapter requests them. This is not an extra check on every already-allowed tool call.

## Adapter defaults: source inspection, not live inference tests

The locally available **codex-acp 1.13.1** defaults to its `agent` mode unless
`INITIAL_AGENT_MODE` or session state selects another mode. That preset combines
workspace-write, disabled command network access, on-request approvals and
automatic approval review. The currently reviewed official
[`AgentMode.ts`](https://github.com/agentclientprotocol/codex-acp/blob/7fee150a55098f7140a03907fec5f11edbe45086/src/AgentMode.ts)
and [`CodexAcpClient.ts`](https://github.com/agentclientprotocol/codex-acp/blob/7fee150a55098f7140a03907fec5f11edbe45086/src/CodexAcpClient.ts)
show the session cwd and per-turn policy forwarding. A workspace-write preset
alone does not establish outside-workspace read denial.

The locally available **claude-agent-acp 0.81.1** uses explicit options or Claude
settings to select permission mode, falling back to `default` (Manual). Official
[`permissions/modes.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/5dbb453c63a89746627799b2b06b31ba01a1b674/src/permissions/modes.ts)
and [`acp-agent.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/5dbb453c63a89746627799b2b06b31ba01a1b674/src/acp-agent.ts)
show cwd, permission callback and settings handling; they do not impose a universal
chat-folder-only sandbox. User/project/admin settings can change the result.
Neither adapter was launched and no personal settings were read for this check.

## Experiment 3: restricted Codex commands without a model

Used the desktop-bundled Codex executable **0.155.0-alpha.9.2** with a temporary
Codex state directory and synthetic course/sibling directories. The command was
`codex sandbox -P course -C <course/week2> -- /bin/sh ...`; this executable's
sandbox command has no `macos` subcommand. It applied a named permission profile
with platform-minimum reads, course workspace read/write, and network disabled.
The profile was supplied in temporary state, not the user's Codex configuration.

| Synthetic operation | Result |
| --- | --- |
| Read course file | Allowed |
| Write course file | Allowed |
| Read sibling file outside course | Denied |
| Write sibling file outside course | Denied |
| Read outside through a symlink inside course | Denied |
| Write outside through a symlink inside course | Denied |

The sandbox command exited successfully; the outside directory retained only its
original synthetic file. No model inference or API billing was involved.

This proves direct command containment for this profile/executable on this Mac.
The six checks were repeated against the freshly installed SDK-bundled
**Codex 0.156.1** executable, with the same results and unchanged outside files.
It does not prove every SDK version/OS, native tool, app, MCP server or external
kernel is confined. In particular, nbinlineai tools dispatched to ordinary Python
remain outside that command sandbox. See official
[permission profiles](https://learn.chatgpt.com/docs/permissions).

## Design consequence

No ACP dependency is proposed for nbinlineai; these are prior-art observations.
Use notebook parent for nbinlineai's working directory. Offer the notebook folder
or Lab project/course root for direct Codex file access, with the course root as
the proposed default for the user's course workflow. Resolve both on the server.
Keep the ordinary trusted-Python model; do not promise a whole-Jupyter sandbox.
The project-access setting is useful even with that explicit kernel exception.
Retain the original live notebook bridge for unsaved document operations.
