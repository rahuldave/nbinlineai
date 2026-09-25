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

verify: lint typecheck test browser diff-check
