"""Check that the public wheel and source archive contain only release material."""

from __future__ import annotations

import argparse
import json
import re
import tarfile
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

FORBIDDEN_PARTS = {
    ".git", ".venv", "node_modules", "internal_docs", "test-results",
    "playwright-report", ".pytest_cache", ".ruff_cache", "__pycache__",
}
FORBIDDEN_FILES = {".env", "credentials.json", ".pypirc"}
EXAMPLE_DIR = Path(__file__).resolve().parents[1] / "examples"
EXAMPLE_REQUIRED = {
    "examples/README.md", "examples/bundled-tools.ipynb", "examples/data/ecosystem-lesson.ipynb",
} | {f"examples/{path.relative_to(EXAMPLE_DIR).as_posix()}" for path in EXAMPLE_DIR.rglob("*.ipynb")}
SOURCE_REQUIRED = {
    "LICENSE", "README.md", "docs/user-guide.md", "docs/architecture.md", "docs/faq.md",
    "docs/tools.md",
    "pyproject.toml", "package.json", "yarn.lock",
    "src/index.ts", "src/context.ts", "src/contextControls.ts", "src/frontendActions.ts", "src/insertTools.ts",
    "src/insertToolsProtocol.ts", "style/index.css", "schema/plugin.json",
    "nbinlineai/__init__.py", "nbinlineai/handlers.py", "nbinlineai/tools.py",
    "nbinlineai/frontend_bridge.py", "nbinlineai/web_tools.py",
    "nbinlineai/context_budget.py", "nbinlineai/context_selection.py", "nbinlineai/prompt_focus.py",
    "nbinlineai/kernel_insert_tools.py",
    "nbinlineai/labextension/package.json", "examples/quickstart.ipynb",
} | EXAMPLE_REQUIRED
WHEEL_REQUIRED_SUFFIXES = {
    "nbinlineai/__init__.py", "nbinlineai/handlers.py", "nbinlineai/tools.py",
    "nbinlineai/frontend_bridge.py", "nbinlineai/web_tools.py",
    "nbinlineai/context_budget.py", "nbinlineai/context_selection.py", "nbinlineai/prompt_focus.py",
    "nbinlineai/kernel_insert_tools.py",
    "share/jupyter/labextensions/nbinlineai/package.json",
    "etc/jupyter/jupyter_server_config.d/nbinlineai.json",
    "share/doc/nbinlineai/docs/user-guide.md",
    "share/doc/nbinlineai/docs/architecture.md",
    "share/doc/nbinlineai/docs/faq.md",
    "share/doc/nbinlineai/docs/tools.md",
} | {f"share/doc/nbinlineai/{path}" for path in EXAMPLE_REQUIRED}
MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)")
REFERENCE_IMAGE = re.compile(r"!\[([^\]]*)\]\[([^\]]*)\]")
REFERENCE_TARGET = re.compile(r"^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)", re.MULTILINE)
HTML_IMAGE = re.compile(r"<img\b[^>]*\bsrc\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|([^\s>]+))", re.IGNORECASE)


def _image_targets(markdown: str) -> list[str]:
    """Find Markdown and HTML image URLs, including Markdown reference links."""
    targets = [match.group(1) for match in MARKDOWN_IMAGE.finditer(markdown)]
    targets += [next(value for value in match.groups() if value) for match in HTML_IMAGE.finditer(markdown)]
    references = {name.casefold(): target for name, target in REFERENCE_TARGET.findall(markdown)}
    for match in REFERENCE_IMAGE.finditer(markdown):
        label = (match.group(2) or match.group(1)).casefold()
        if label in references:
            targets.append(references[label])
    return [target.removeprefix("<").removesuffix(">") for target in targets]


def _docs_image_path(target: str, *, remote: bool) -> str | None:
    url = urlsplit(target)
    if bool(url.scheme) != remote:
        return None
    path = unquote(url.path).removeprefix("./").removeprefix("/")
    marker = "docs/images/"
    if remote:
        if url.scheme != "https" or marker not in path:
            return None
        path = path[path.index(marker):]
    elif path.startswith("images/"):
        path = "docs/" + path
    else:
        raise SystemExit(f"Documentation image must use an images/ relative path: {target}")
    if not path.startswith(marker) or any(part in ("", ".", "..") for part in Path(path).parts):
        raise SystemExit(f"Invalid documentation image path: {target}")
    return path


def _check_doc_images(markdown: str, packaged: set[str], origin: str,
                      prefix: str = "", minimum: int = 0) -> set[str]:
    referenced = {
        path for target in _image_targets(markdown)
        if (path := _docs_image_path(target, remote=False)) is not None
    }
    if len(referenced) < minimum:
        raise SystemExit(f"{origin} references fewer than {minimum} screenshots")
    missing = {prefix + path for path in referenced} - packaged
    if missing:
        raise SystemExit(f"{origin} missing documentation images: {', '.join(sorted(missing))}")
    return referenced


def _check_readme_images(markdown: str, source_files: set[str]) -> None:
    targets = _image_targets(markdown)
    if len(targets) > 2:
        raise SystemExit("README has more than two screenshots")
    for target in targets:
        path = _docs_image_path(target, remote=True)
        if path is None:
            raise SystemExit(f"README image must use an HTTPS docs/images URL: {target}")
        if path not in source_files:
            raise SystemExit(f"README remote image has no packaged source: {path}")


def _check_server_discovery(raw: bytes, origin: str) -> None:
    package = json.loads(raw)
    server = package.get("jupyterlab", {}).get("discovery", {}).get("server", {})
    if server.get("base", {}).get("name") != "nbinlineai" or "pip" not in server.get("managers", []):
        raise SystemExit(f"{origin} missing JupyterLab pip server discovery metadata")


def _check_forbidden(names: list[str]) -> None:
    bad = []
    for name in names:
        parts = Path(name).parts
        if any(part in FORBIDDEN_PARTS for part in parts):
            bad.append(name)
        if any(part in FORBIDDEN_FILES or part.startswith(".env.") for part in parts):
            bad.append(name)
    if bad:
        raise SystemExit("Forbidden archive entries:\n" + "\n".join(sorted(set(bad))))


def check_sdist(path: Path) -> dict[str, set[str]]:
    with tarfile.open(path, "r:gz") as archive:
        names = [member.name for member in archive.getmembers() if member.isfile()]
        relative = {"/".join(Path(name).parts[1:]): name for name in names}
        doc_images: dict[str, set[str]] = {}
        for suffix in ("package.json", "nbinlineai/labextension/package.json"):
            if suffix in relative:
                content = archive.extractfile(relative[suffix])
                if content is None:
                    raise SystemExit(f"Source archive could not read {suffix}")
                _check_server_discovery(content.read(), f"Source archive {suffix}")
        for filename in ("docs/user-guide.md", "docs/tools.md", "README.md"):
            content = archive.extractfile(relative[filename]) if filename in relative else None
            if content is None:
                raise SystemExit(f"Source archive could not read {filename}")
            markdown = content.read().decode("utf-8")
            if filename.startswith("docs/"):
                doc_images[filename] = _check_doc_images(
                    markdown, set(relative), f"Source archive {filename}",
                    minimum=9 if filename == "docs/user-guide.md" else 0,
                )
            else:
                _check_readme_images(markdown, set(relative))
    _check_forbidden(names)
    missing = SOURCE_REQUIRED - relative.keys()
    if missing:
        raise SystemExit(f"Source archive missing: {', '.join(sorted(missing))}")
    print(f"Source archive OK: {path.name} ({len(names)} files)")
    return doc_images


def check_wheel(path: Path, source_doc_images: dict[str, set[str]]) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        manifest = next((name for name in names if name.endswith("share/jupyter/labextensions/nbinlineai/package.json")), None)
        if manifest is not None:
            _check_server_discovery(archive.read(manifest), "Wheel labextension manifest")
        for filename in ("docs/user-guide.md", "docs/tools.md"):
            page = next((name for name in names if name.endswith("share/doc/nbinlineai/" + filename)), None)
            if page is not None:
                prefix = page.removesuffix(filename)
                wheel_images = _check_doc_images(
                    archive.read(page).decode("utf-8"), set(names), f"Wheel {filename}", prefix,
                    minimum=9 if filename == "docs/user-guide.md" else 0,
                )
                if wheel_images != source_doc_images[filename]:
                    raise SystemExit(f"Wheel and source archive {filename} image references differ")
    _check_forbidden(names)
    missing = {suffix for suffix in WHEEL_REQUIRED_SUFFIXES if not any(name.endswith(suffix) for name in names)}
    if missing:
        raise SystemExit(f"Wheel missing: {', '.join(sorted(missing))}")
    if not any(name.endswith("/licenses/LICENSE") for name in names):
        raise SystemExit("Wheel missing GPL LICENSE")
    print(f"Wheel OK: {path.name} ({len(names)} files)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dist", nargs="?", default="dist", type=Path)
    args = parser.parse_args()
    sdists = sorted(args.dist.glob("nbinlineai-*.tar.gz"))
    wheels = sorted(args.dist.glob("nbinlineai-*.whl"))
    if len(sdists) != 1 or len(wheels) != 1:
        raise SystemExit("Expected exactly one nbinlineai source archive and one wheel; clean dist/ first")
    doc_images = check_sdist(sdists[0])
    check_wheel(wheels[0], doc_images)


if __name__ == "__main__":
    main()
