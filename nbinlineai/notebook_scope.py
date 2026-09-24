"""Resolve a notebook's local working folder and direct file-access boundary."""

from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from jupyter_server.services.contents.filemanager import FileContentsManager


@dataclass(frozen=True)
class NotebookScope:
    session_id: str
    notebook_path: str
    working_folder: Path
    project_root: Path
    file_access_root: Path
    access: str


def local_project_root(contents_manager: object) -> Path:
    """Use the effective local ContentsManager root, never a browser path."""
    if not isinstance(contents_manager, FileContentsManager):
        raise ValueError("ChatGPT file access requires a local JupyterLab project folder")  # noqa: TRY004
    configured = getattr(contents_manager, "root_dir", None)
    if not isinstance(configured, (str, Path)) or not configured:
        raise ValueError("JupyterLab project folder is unavailable")
    root = Path(configured).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("JupyterLab project folder is unavailable")
    return root


def resolve_notebook_scope(
    contents_manager: object, session: dict, *, access: str = "project"
) -> NotebookScope:
    """Resolve the authenticated session's notebook parent under the local root.

    The session is obtained from Jupyter's SessionManager by session ID.  The
    caller must never construct it from notebook metadata or a browser path.
    Resolving symlinks also rejects a notebook or parent that escapes the root.
    """
    return NotebookScopeResolver(contents_manager).resolve(session, access=access)


class NotebookScopeResolver:
    """Freeze the server's effective project root; refresh session paths per run."""

    def __init__(self, contents_manager: object):
        self.project_root = local_project_root(contents_manager)

    def resolve(self, session: dict, *, access: str = "project") -> NotebookScope:
        return _resolve_session_path(self.project_root, session, access=access)


def _resolve_session_path(root: Path, session: dict, *, access: str) -> NotebookScope:
    if access not in ("project", "notebook"):
        raise ValueError("Invalid ChatGPT file access choice")
    if not isinstance(session, dict) or session.get("type") != "notebook":
        raise ValueError("A notebook session is required")
    session_id = session.get("id")
    notebook_path = session.get("path")
    if not isinstance(session_id, str) or not session_id:
        raise ValueError("Notebook session is unavailable")
    if not isinstance(notebook_path, str) or not notebook_path:
        raise ValueError("Notebook path is unavailable")
    relative = PurePosixPath(notebook_path)
    if (relative.is_absolute() or any(part in ("", ".", "..") for part in notebook_path.split("/"))
            or "\\" in notebook_path):
        raise ValueError("Notebook path is outside the JupyterLab project folder")
    try:
        notebook_file = (root / Path(*relative.parts)).resolve(strict=True)
        notebook_file.relative_to(root)
    except (OSError, ValueError) as exc:
        raise ValueError("Notebook is outside the JupyterLab project folder or unavailable") from exc
    if not notebook_file.is_file():
        raise ValueError("Notebook path is unavailable")
    working_folder = notebook_file.parent
    return NotebookScope(
        session_id=session_id,
        notebook_path=notebook_path,
        working_folder=working_folder,
        project_root=root,
        file_access_root=root if access == "project" else working_folder,
        access=access,
    )
