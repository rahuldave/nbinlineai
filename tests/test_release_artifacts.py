"""Exercise release contents with a rendered/dirty documentation tree."""

import copy
import io
import json
import tarfile
import zipfile
from pathlib import Path

import pytest
import tomllib
from hatchling.builders.sdist import SdistBuilder
from hatchling.builders.wheel import WheelBuilder

from scripts import check_release_artifacts as release

ROOT = Path(__file__).resolve().parents[1]


def _dirty_project(root: Path) -> dict:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())
    config = copy.deepcopy(config)
    # Exercise the actual file-selection configuration without rebuilding the
    # frontend or resolving the project's runtime dependencies in a unit test.
    config["tool"]["hatch"]["build"].pop("hooks", None)
    files = {
        "LICENSE": "GPL-3.0-only",
        "README.md": "# Release fixture\n",
        "nbinlineai/__init__.py": "__version__ = '0.1.16'\n",
        "nbinlineai/labextension/package.json": "{}",
        "install.json": "{}",
        "jupyter-config/server-config/nbinlineai.json": "{}",
        "docs/index.md": "# Fixture\n",
        "docs/tool-applications.md": "# Applications\n",
        "docs/example-audit.md": "# Audit\n",
        "docs/manual/setup.md": "# Setup\n",
        "docs/assets/css/site.css": ".fixture { color: red; }\n",
        "docs/.nojekyll": "",
        "examples/demo.ipynb": json.dumps({"cells": [], "nbformat": 4}),
        "examples/data/fixture.ipynb": json.dumps({"cells": [], "nbformat": 4}),
        "examples/media/clip.webm": "encoded fixture",
        "docs/.quarto/idx/index.md.json": "render cache",
        "examples/.ipynb_checkpoints/demo-checkpoint.ipynb": "checkpoint backup",
        "docs/_site/index.html": "generated site",
        "docs/site_libs/generated.js": "generated library",
        "examples/demo_files/figure.png": "generated notebook figure",
    }
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data)
    return config


@pytest.mark.parametrize("kind", ("sdist", "wheel"))
def test_build_excludes_rendered_caches_but_keeps_sources(tmp_path: Path, kind: str) -> None:
    config = _dirty_project(tmp_path)
    out = tmp_path / "dist"
    builder = SdistBuilder if kind == "sdist" else WheelBuilder
    filename = next(builder(str(tmp_path), config=config).build(directory=str(out)))
    if kind == "sdist":
        with tarfile.open(out / filename) as archive:
            paths = {"/".join(Path(member.name).parts[1:]) for member in archive.getmembers()
                     if member.isfile()}
    else:
        with zipfile.ZipFile(out / filename) as archive:
            paths = {name.split("share/doc/nbinlineai/", 1)[-1] for name in archive.namelist()}
    required = {
        "docs/index.md", "docs/tool-applications.md", "docs/example-audit.md",
        "docs/manual/setup.md", "docs/assets/css/site.css", "docs/.nojekyll",
        "examples/demo.ipynb", "examples/data/fixture.ipynb", "examples/media/clip.webm",
    }
    assert required <= paths
    leaked = {path for path in paths if any(part in {".quarto", ".ipynb_checkpoints", "_site", "site_libs"}
                                          or part.endswith("_files") for part in Path(path).parts)}
    assert not leaked


@pytest.mark.parametrize("relative", (
    "docs/.quarto/idx/index.md.json",
    "examples/.ipynb_checkpoints/demo-checkpoint.ipynb",
    "docs/_site/index.html",
    "docs/site_libs/generated.js",
    "examples/demo_files/figure.png",
))
@pytest.mark.parametrize("prefix", ("nbinlineai-0.1.16/", "nbinlineai.data/data/share/doc/nbinlineai/"))
def test_archive_gate_rejects_render_output(relative: str, prefix: str) -> None:
    with pytest.raises(SystemExit, match="Forbidden archive entries"):
        release._check_forbidden([prefix + relative])


COMPANIONS = (
        "examples/media/owned-notebook-tab-2087303b97be.webm",
        "examples/tool-coverage.json",
        "docs/tool-applications.md",
        "docs/example-audit.md",
)


def _valid_archive_files(kind: str) -> dict[str, bytes]:
    source = {name: b"fixture" for name in release.SOURCE_REQUIRED | set(COMPANIONS)}
    source["README.md"] = b"# Fixture\n"
    source["pyproject.toml"] = b'[project]\ndependencies = ["openai-codex==0.156.1"]\n'
    source["docs/user-guide.md"] = "\n".join(
        f"![Control {i}](images/control-{i}.png)" for i in range(9)
    ).encode()
    for i in range(9):
        source[f"docs/images/control-{i}.png"] = b"image fixture"
    discovery = json.dumps({"jupyterlab": {"discovery": {"server": {
        "base": {"name": "nbinlineai"}, "managers": ["pip"],
    }}}}).encode()
    source["package.json"] = source["nbinlineai/labextension/package.json"] = discovery
    if kind == "sdist":
        return source
    wheel = {name: b"fixture" for name in release.WHEEL_REQUIRED_SUFFIXES}
    wheel.update({f"share/doc/nbinlineai/{name}": data for name, data in source.items()
                  if name.startswith(("docs/", "examples/"))})
    wheel["share/jupyter/labextensions/nbinlineai/package.json"] = discovery
    wheel["nbinlineai-0.1.16.dist-info/METADATA"] = (
        b"Metadata-Version: 2.4\nName: nbinlineai\nVersion: 0.1.16\n"
        b"Requires-Dist: openai-codex==0.156.1\n"
    )
    wheel["nbinlineai-0.1.16.dist-info/licenses/LICENSE"] = b"GPL-3.0-only"
    return wheel


def _archive(path: Path, files: dict[str, bytes], kind: str) -> None:
    if kind == "sdist":
        with tarfile.open(path, "w:gz") as archive:
            for name, data in files.items():
                member = tarfile.TarInfo("nbinlineai-0.1.16/" + name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
    else:
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in files.items():
                archive.writestr(name, data)


@pytest.mark.parametrize("kind", ("sdist", "wheel"))
@pytest.mark.parametrize("missing", COMPANIONS)
def test_archive_gate_rejects_missing_companion(tmp_path: Path, kind: str, missing: str) -> None:
    # Start with an accepted archive, then remove exactly one offline resource.
    path = tmp_path / ("fixture.tar.gz" if kind == "sdist" else "fixture.whl")
    files = _valid_archive_files(kind)
    _archive(path, files, kind)
    if kind == "sdist":
        release.check_sdist(path)
    else:
        images = {name: set() for name in release.IMAGE_DOCS}
        images["docs/user-guide.md"] = {f"docs/images/control-{i}.png" for i in range(9)}
        release.check_wheel(path, images)
    files.pop(missing if kind == "sdist" else "share/doc/nbinlineai/" + missing)
    _archive(path, files, kind)
    with pytest.raises(SystemExit, match="missing"):
        if kind == "sdist":
            release.check_sdist(path)
        else:
            release.check_wheel(path, images)
