# Tool Docments and API reference

Status: implemented on the main-based topic `codex/unokszrs-tool-docments`,
awaiting PR acceptance into main. No release is requested. The package
version and PyPI remain 0.1.18.

## Source and scope

Approved context comes from main `0feacd8ab5edf24d7a5314286d25471e1224506a`,
the merge of the starter-tools tutorial PR #54. This work follows that merge.
The primary checkout stays on main. Implementation lives in the owned worktree
`/Users/rahul/Projects/nbinlineai-docments-tools`; its PR base is main.

The audit found docstrings, parameter types and return types on all 96 tools.
Only 26 tools had complete parameter and return descriptions. The native
smalldocs check also includes private helpers and methods in the 13 defining
modules. It found 314 gaps across 155 symbols, including one missing private
return annotation.

All 155 symbols now pass that check. The public reference contains 96 tools,
four setup helpers and two existing utilities. Function bodies, argument names,
defaults and public return annotations keep their behavior. The private
`source_tools._document` helper now declares its parsed `Document` result type.

## Documentation and model descriptions

Each function uses typed parameters with adjacent descriptive comments, a typed
return with a result comment, and a docstring. smalldocs generates 13 API pages
from the defining modules. The tool catalog retains its notebook demonstrations
and links function names to the generated reference.

Kernel introspection reads Docments parameter descriptions when Fastcore and
source are available. It uses `eval_str=False`, so it does not evaluate string
annotations. Inspection retains its existing signature type and default
mapping, docstring summary and special-tool identity checks. It does not call
the inspected function.

Source longer than 64,000 characters skips Docments parsing. Missing Fastcore,
unavailable source, parser errors and invalid descriptions use parameter names
as the fallback. Each description and the existing function summary are capped
at 1,000 characters. These descriptions count within the existing context
budget.

The builder stages notebooks and generated API files in a temporary project.
An in-memory API root points to the chosen source checkout. The build leaves
source configuration and notebooks intact and writes only ignored `docs/_site`.
API generation imports Python modules but invokes no tool functions. It does
not execute saved notebook cells or contact a model.

The documentation workflow installs locked Python dependencies without building
or installing the project. It runs the native Docments gate before rendering.
It retains the required **Documentation site / Render and check Quarto site**
context. Static documentation PRs keep their existing routing; source changes
still require full validation.

## Verification and review

Test-first checks observed missing schema descriptions and a staged build that
could not import the selected source. New tests cover Docments descriptions,
type/default preservation, source and parser fallbacks, annotation handling,
description limits and generated source links. The real-kernel collection test
checks parameter descriptions for every registered tool and a function defined
in a notebook cell.

Independent factual and Declaude review corrected claims about saved cell IDs,
file line endings, text-search scope, web length checks and the server's role
in media saving. It also restored PIL result types and recording-source
cleanup details. The Nossaifd guide and Declaude skill come from the clean
`nossaifd` checkout at `d6d5c90b5a279ce43f84fda6374c746b75544ef4`.

The native API check reports 155 of 155 symbols. The site build produces 69
pages, including 13 API pages and 31 saved notebooks; its local-link and catalog
checks pass. The locked documentation environment also passes the native check
and build without installing or building the extension. The frontend's 102 unit
tests, all 733 Python tests, TypeScript check, Ruff, lockfile and diff checks
pass. A separate real-kernel rerun also verifies notebook-defined Docments.

Independent reviewer `adversarial_review` checked the full change from the
recorded base. All findings were resolved. The PR and Gest records hold the
exact reviewed head, final Python results and required CI status. No notebook
source or saved evidence changes in this follow-up.

Main's post-merge validation also exposed a save/read race in the inherited-tool
browser tests. The test read saved Contents while a save request was in flight.
Jupyter's partial-file recovery then collided with the write and lost the file.
The live declarations and AI answer had already completed correctly. These
tests now await a successful save response before reading saved declarations.
The original capture timeout passed five local repetitions and the main rerun;
its exact receipt-delivery cause remains unproven.
