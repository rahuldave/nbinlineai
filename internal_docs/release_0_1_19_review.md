# Version 0.1.19 release and review record

Status: **release candidate prepared**. Publication remains pending.

Version 0.1.19 packages the tool documentation and starter tutorial merged after
0.1.18. Models receive parameter descriptions from Docments, the convention
that puts descriptions beside typed Python parameters. The release also
includes complete function docstrings and revised notebook instructions.

## Scope and source

The approved baseline is main `04e2a70bdaa42f359f4246055515741af031270d`,
the merge of PR #55. The preceding release tag `v0.1.18` points to
`bbedb3430a03c8b688147195bfd716dd261f6b86`. PR #53 repaired project prose;
PR #54 added the worked starter tutorial; PR #55 completed Docments and the
generated API reference. This release excludes notebook-agent experiments.

Root owns `/Users/rahul/Projects/nbinlineai-release-0.1.19`, branch
`codex/lnkwnzos-release-0-1-19`, with PR base main. The primary checkout stays
on main. Gest parent `lnkwnzos` and iteration `oxklowpv` track preparation,
verification, independent review, publication and the final record.

## Changes delivered by the candidate

- Model tools use parameter descriptions from source comments when Fastcore
  and source are available. Missing source, parser errors and invalid
  descriptions retain the existing parameter-name fallback. Parsing does not
  evaluate string annotations or call the function. Descriptions stay within
  the existing request budget.
- The native documentation check covers all 155 symbols in 13 defining
  modules. They have types, parameter comments, return comments and docstrings.
  The public API reference covers 96 tools, four setup helpers and two existing
  utilities. Public signatures, defaults and tool effects are preserved.
- The starter tutorial inserts 19 default declarations as editable Markdown,
  then uses selected file, saved-notebook and live-cell tools. Its five AI
  questions include genuine saved answers and observed-tool tables.
- The prose repairs keep prior notebook code and saved evidence. The tutorial
  remains a separate notebook, and generated example code stays unexecuted.
- The inherited-tool browser tests wait for a successful save response before
  reading saved declarations. This removes the test save/read race found after
  PR #54 without changing product save behavior.

## Verification boundary

The approved baseline passed 733 Python, 102 frontend and 110 browser tests.
Two optional subscription cases were skipped. All 14 runtime variants passed,
and the documentation deployment passed its native API and site checks.
These baseline results do not replace candidate release verification.

The candidate must pass required PR checks and independent review before
integration. Final artifacts must pass strict metadata checks, archive-content
and source comparisons, and an isolated wheel installation. The publication
record will give their hashes, source commit, tag and public download checks.

The documentation site already includes the API reference and starter lesson.
The release still requires PyPI publication and a pushed version tag. No new
paid-model or physical-device acceptance is claimed.
