"""Check that the public wheel and source archive contain only release material."""

from __future__ import annotations

import argparse
import tarfile
import zipfile
from pathlib import Path

FORBIDDEN_PARTS = {
    ".git", ".venv", "node_modules", "internal_docs", "test-results",
    "playwright-report", ".pytest_cache", ".ruff_cache", "__pycache__",
}
FORBIDDEN_FILES = {".env", "credentials.json", ".pypirc"}
SOURCE_REQUIRED = {
    "LICENSE", "README.md", "pyproject.toml", "package.json", "yarn.lock",
    "src/index.ts", "style/index.css", "schema/plugin.json",
    "nbinlineai/__init__.py", "nbinlineai/handlers.py",
    "nbinlineai/labextension/package.json", "examples/quickstart.ipynb",
}
WHEEL_REQUIRED_SUFFIXES = {
    "nbinlineai/__init__.py", "nbinlineai/handlers.py",
    "share/jupyter/labextensions/nbinlineai/package.json",
    "etc/jupyter/jupyter_server_config.d/nbinlineai.json",
}


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


def check_sdist(path: Path) -> None:
    with tarfile.open(path, "r:gz") as archive:
        names = [member.name for member in archive.getmembers() if member.isfile()]
    _check_forbidden(names)
    relative = {"/".join(Path(name).parts[1:]) for name in names}
    missing = SOURCE_REQUIRED - relative
    if missing:
        raise SystemExit(f"Source archive missing: {', '.join(sorted(missing))}")
    print(f"Source archive OK: {path.name} ({len(names)} files)")


def check_wheel(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
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
    check_sdist(sdists[0])
    check_wheel(wheels[0])


if __name__ == "__main__":
    main()
