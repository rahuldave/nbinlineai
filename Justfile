set shell := ["bash", "-euo", "pipefail", "-c"]

# Bootstrap/build ordering is documented in docs/development.md.
lint:
    uv run --no-sync ruff check nbinlineai tests scripts
    uv lock --check

typecheck:
    uv run --no-sync jlpm exec tsc --noEmit

test:
    uv run --no-sync pytest
    uv run --no-sync jlpm test:unit

build:
    uv run --no-sync jlpm build:prod
    uv run --no-sync jupyter-builder develop . --overwrite

browser: build
    uv run --no-sync jlpm test:e2e

diff-check:
    git diff --check

docs:
    uv run --no-sync smalldocs api check --dir docs
    uv run --no-sync python scripts/build_docs_site.py
    uv run --no-sync python scripts/check_docs_site.py docs/_site

verify: lint typecheck test browser diff-check
