# Version 0.1.19 release and review record

Status: **published and verified on November 12, 2026**.

[Version 0.1.19 on PyPI](https://pypi.org/project/nbinlineai/0.1.19/) packages
the tool documentation and starter tutorial merged after 0.1.18. Models receive
parameter descriptions from Docments, the convention that puts descriptions
beside typed Python parameters. The release also includes complete function
docstrings and revised notebook instructions.

## Scope and source

The approved baseline was main `04e2a70bdaa42f359f4246055515741af031270d`,
the merge of PR #55. The preceding release tag `v0.1.18` points to
`bbedb3430a03c8b688147195bfd716dd261f6b86`. PR #53 repaired project prose, and PR #54 added the worked starter tutorial.
PR #55 completed Docments and the generated API reference. This release excludes notebook-agent experiments.

[Release PR #56](https://github.com/rahuldave/nbinlineai/pull/56) merged as
`567a558f191321d1d76b4643cf9e26c80132bcb4`. Its tree matches independently
reviewed head `fad61417f24568b1ca39e9ed7c3680397de980f7`. The pushed annotated
[`v0.1.19` tag](https://github.com/rahuldave/nbinlineai/tree/v0.1.19) points to
that merge. Its tag object is `9c420a74101931ff4c0e570bd4f4ec2698e57cf5`.

Root prepared the release in `/Users/rahul/Projects/nbinlineai-release-0.1.19`
on `codex/lnkwnzos-release-0-1-19`, targeting main. After integration, the same
owned worktree carried this publication record on
`codex/lnkwnzos-0-1-19-publication`, based on the release merge. The primary
checkout stayed on main. Gest parent `lnkwnzos` and iteration `oxklowpv` track
preparation, verification, independent review, publication and cleanup.

## Changes delivered

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

## Review and verification

Independent source and artifact review covered base `04e2a70` through final
head `fad6141`. Review findings about stale tutorial status and implementation
branch provenance were fixed before integration. The final review found no
remaining blockers. A separate Nossaifd and Declaude pass checked the changed
prose and preservation of factual claims.

All required PR checks passed at the final head:

- [Source validation](https://github.com/rahuldave/nbinlineai/actions/runs/43158480306)
  passed 733 Python, 102 frontend and 110 browser tests. Two optional subscription
  cases were skipped in that run.
- [Runtime compatibility](https://github.com/rahuldave/nbinlineai/actions/runs/43158480230)
  passed all 14 platform and musl variants.
- [Documentation validation](https://github.com/rahuldave/nbinlineai/actions/runs/43158480211)
  passed the native API coverage check, documentation build and site checks.

Local release verification also passed 733 Python and 102 frontend tests,
Ruff, TypeScript, lockfile checks and internal Markdown links. Both optional
deterministic offline ChatGPT scenarios passed separately with the audited
wheel. They covered ordered notebook execution with tools and Keep, plus
cancellation isolation between notebooks whose cells share an ID.

The first local optional run used an environment without the extension and
failed setup. Installing the audited wheel into that environment corrected the
setup. The passing run followed. The primary environment was restored to its
own main source and frontend link. No product change resulted from this issue.

Preservation checks found the original 30 notebooks' 374 tagged AI cells,
274 outputs and 296 execution counts unchanged. Their code, cell IDs and
metadata were also preserved. No new paid-model or physical-device acceptance
is claimed. Test servers used owned port 8897 and were stopped. Port 8888 was
not used.

## Distribution audit and publication

Strict Twine metadata checks and the repository archive checks passed.
Independent review checked 353 source-archive files and 146 wheel entries.
All 352 source files backed by the checkout matched the final reviewed source. The remaining source file was generated package metadata. Wheel RECORD hashes
and sizes passed, including the packaged docs, examples and Jupyter extension
configuration. The archives retain GPL-3.0-only and exclude internal documents,
environments and credentials.

The artifacts were built at `c82d733cf47bca5dcdf991724f47d1f3644dd02c`.
Later release commits changed only `todo.md` and internal documentation, which
are excluded from the distributions. The archive audit confirmed that all
packaged source still matched final head `fad6141`.

| Public file | Bytes | SHA-256 |
| --- | ---: | --- |
| `nbinlineai-0.1.19-py3-none-any.whl` | 2,582,439 | `bb8eff102b587f52487d7eb4bb2d653c86e5d2404367e45fe73d11efe4221d57` |
| `nbinlineai-0.1.19.tar.gz` | 3,044,027 | `763500bfdac2f9abf28a92345a77bf30b01b2a02defdd0efe554799e215c05d1` |

PyPI accepted the wheel at 05:24:51 UTC and the source archive at 05:24:53 UTC
on November 12. Both public downloads matched the audited local sizes and
hashes. Neither file was yanked. Public metadata reported 0.1.19 as the latest
release. The public PyPI page rendered the README, its screenshot and the new
version paragraph with tutorial and API links.

The audited local wheel passed a clean Python 3.14 installation, extension
discovery, server status and packaged quickstart UI. A separate fresh Python
3.14 environment installed exactly 0.1.19 from the public PyPI index without
cached packages. All 113 installed packages were compatible.

Imports came
from that environment's site-packages. Both extensions were enabled and OK.
The installed package contained all 96 tools, a source-derived parameter
description, the starter tutorial and the API guide. The downloaded public
wheel then passed the isolated quickstart UI check in that environment.

Sanitized build, audit, download and installation reports are retained locally
at `/Users/rahul/.codex/artifacts/nbinlineai/0.1.19`.

## Live documentation

[Pages run 43161060942](https://github.com/rahuldave/nbinlineai/actions/runs/43161060942)
built and published the release source successfully. A public-site crawl
fetched all 109 expected public files. The check passed all 69 HTML pages,
13 API pages, 31 notebook pages, 96 catalog tools and 161 catalog API links.
Local asset links, anchors, notebook cell IDs and saved-output counts passed.
The live home page displayed version 0.1.19.

This publication record changes internal Markdown only. It follows the required
documentation-only PR path. The complete source and runtime results above
belong to release PR #56.
