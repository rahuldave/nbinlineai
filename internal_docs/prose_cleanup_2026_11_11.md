# Documentation prose review, November 11, 2026

This review applies nossaifd and Declaude to nbinlineai's documentation. It changes prose for readability and preserves technical claims, quoted examples and recorded execution evidence.

The work starts from main commit `d726af176e1b3bdfa6393f6c71b91103786c4f49`. It belongs to a topic PR targeting `main`. It does not promote notebook-agent experiments or change the package version. PyPI remains at 0.1.18.

## Sources and method

The selected [nossaifd revision](https://github.com/rahuldave/nossaifd/tree/d6d5c90b5a279ce43f84fda6374c746b75544ef4) matched remote `main` when work began. The local source checkout was clean. It includes Declaude 0.14.0 by Oskar Austegard, based on upstream commit `6baa7290da972191749acda03c63297e67b3fc26`.

The first pass follows nossaifd's writing guide, fixes hard checker findings and judges the soft notes in context. A different agent then uses Declaude's linter, structural review and sentence review. Preservation comparisons check the first pass and the original source for lost claims. The final pass reruns the checker and linter.

The skills run from the selected source checkout. This change does not install skills, hooks or a new CI workflow in nbinlineai.

## Scope

| Surface | Review scope |
| --- | --- |
| Root Markdown and public guides | 28 files, including `AGENTS.md`, `README.md`, `todo.md`, `docs/` and `examples/README.md` |
| Internal records | 22 handoffs, acceptance records, release reviews and workflow pages |
| Internal research | 25 specifications, task prompts, research pages and release instructions |
| Example notebooks | All 30 notebooks, with 248 authored tutorial Markdown cells reviewed separately from saved specimens |
| Historical HTML design | Both files in `internal_docs/design/` inspected for visible prose; their executable content remains unchanged |

The Markdown inventory has 75 original project files. The review excludes vendored skills, license texts, generated site files and source-code documentation.

Notebook edits change ordinary tutorial Markdown source only. They preserve code, outputs, execution counts, cell order, stable IDs, metadata and attachments. They also preserve all 374 tagged AI question/answer cells, tool-call tables, third-party source excerpts and generated helper-insertion specimens.

## Exact text and checker limits

Some documentation contains text that software reads or that records an earlier run. Such text remains exact even when the prose checker marks its punctuation.

| Text | Disposition |
| --- | --- |
| Redirect script in `docs/user-guide.md` | Preserve the executable script. The raw checker reports two findings in its JavaScript body; a visible-prose extraction is checked separately. The raw page is not recorded as a passing page. |
| `attach_media` section heading in `examples/browser-media-attachment.ipynb` | Preserve the exact heading because `examples/tool-coverage.json` matches it. |
| `Observed in JupyterLab` notebook labels | Preserve the labels used by the saved-evidence tooling. |
| AI questions, answers, fetched source notes and generated declarations | Preserve these specimens rather than rewrite the recorded example. |
| Existing internal release and acceptance heading links | Keep the old GitHub anchors when punctuation changes in a heading. |

Linter flags are candidates for review, not proof that a passage is poor prose or that a model wrote it. Technical terms, precise negations and historical qualifications can remain when they carry a claim.

## Content questions kept separate

The prose pass does not silently resolve these earlier statements:

- Some media introductions and `examples/README.md` retain conditional installation advice for 0.1.16. The selected main handoff records 0.1.18 as published.
- Some notebook introductions say they have no saved AI answers or remain unrun, although the notebooks contain later saved evidence.
- `examples/context-selection.ipynb` says code outputs are never included automatically. The 0.1.18 release record describes displayed text outputs in selected context.
- `todo.md` retains a conditional saved-answer task and a reference to the Quarto filter. Main's handoff records saved gallery answers and the smalldocs site.
- The superseded FastLLM proposal says no subscription backend has shipped. Its dated proposal status needs to remain distinct from the later subscription release.
- The examples guide says the integration notebook's attachment and image question remain for the reader, while the example audit describes a saved final red-image answer.
- Several older internal notes use present-tense release or implementation labels beside later completion records. The one-kernel RLM research also refers to three execution forms after describing A, B, C and D.

These points need a factual documentation update with explicit decisions about current instructions and historical records. They are recorded here so that an editorial rewrite does not choose a new technical claim.

## Factual follow-up on the later main revision

The documentation follow-up starts from main commit `64c81d0de9bb454cb53bbeed9882b2d2b765af01`. The public guide now treats the five application notebooks as saved worked examples. It uses the published 0.1.18 installation advice and identifies the saved blue-image and red-image answers. The examples guide separates the new starter tutorial's unanswered exercises from those older saved runs. It also updates the current collection to 31 notebooks, with 30 gallery pages and one supporting fixture. The October audit's 29-notebook result remains a dated record.

The current `todo.md` names smalldocs and the already published saved-answer panels. The FastLLM proposal labels its no-subscription statement as historical, and the one-kernel research now calls A, B, C and D four execution forms. Notebook introduction corrections belong with the notebook sources. Older acceptance and release records still describe their original events; they do not serve as current installation instructions.

## Newcomer review

A separate reader reviewed the public pages without Git history or implementation notes. The final wording defines an updating receipt at its first use in the README and site index. The manual names the insertion helper in its import instruction. Architecture and context descriptions state the relevant behavior before referring to older formats.

The reader also requested more standalone media examples, definitions of browser terminology and clearer paths to stable cell IDs. Those additions need a separate documentation change that verifies the examples and instructions. The media pages remain companions to their linked notebooks. This prose pass preserves their snippets and exact interface labels.

The reader's cross-page status contradictions are included in the content questions above. Release history remains in the architecture, compatibility and audit references where it identifies a supported format or dated evidence. Simplifying those statements must preserve that scope.

## Validation record

The site renders 54 pages and all 30 saved notebooks without execution. Its checker confirms 96 tool rows, the gallery, AI panels, local links and anchors. Internal Markdown link validation, Ruff, the lockfile check, TypeScript and all 102 frontend tests pass.

The first local Python run passed 714 of 718 tests. Restoring the exact tool-coverage heading fixed one failure. Two isolated-kernel cases passed focused reruns. The remaining direct-probe readiness test also fails with isolated configuration while the owned kernel process remains alive. Its script and test have the same Git blobs as the selected main revision.

The local browser attempt failed two cases, interrupted one and left 108 unrun before it was stopped. It is not browser acceptance evidence. The owned server on port 8897 shut down; port 8888 was untouched. The PR requires full source and runtime CI because notebook files changed.

Independent review and the PR's exact base/head commits are recorded with the PR and Gest task. This record does not claim package publication or a deployed documentation update.
