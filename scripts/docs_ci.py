"""Conservative CI routing and local-link validation for internal Markdown."""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit


def _git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


def _safe_doc(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return (
        len(parts) >= 2
        and parts[0] == "internal_docs"
        and parts[-1].endswith(".md")
        and all(part not in (".", "..") for part in parts)
        and not path.startswith("/")
        and "\\" not in path
    )


def docs_only(base: str, head: str) -> bool:
    if not re.fullmatch(r"[0-9a-f]{40}", base) or not re.fullmatch(r"[0-9a-f]{40}", head):
        return False
    if base == head:
        return False
    try:
        raw = _git("diff", "--raw", "-z", "--no-ext-diff", "--no-textconv", "-M", base, head, "--")
    except (OSError, subprocess.CalledProcessError):
        return False
    entries = raw.split(b"\0")
    if entries[-1:] != [b""]:
        return False
    entries.pop()
    if not entries:
        return False
    index = 0
    while index < len(entries):
        try:
            metadata = entries[index].decode("ascii")
            old_mode, new_mode, _old_sha, _new_sha, status = metadata[1:].split(" ")
            index += 1
            count = 2 if status.startswith(("R", "C")) else 1
            paths = [entries[index + offset].decode("utf-8") for offset in range(count)]
            index += count
        except (UnicodeDecodeError, ValueError, IndexError):
            return False
        if (
            not metadata.startswith(":")
            or status[0] not in "AMDRC"
            or count == 2
            and status[0] not in "RC"
        ):
            return False
        if old_mode not in ("000000", "100644") or new_mode not in ("000000", "100644"):
            return False
        if not all(_safe_doc(path) for path in paths):
            return False
    return True


_REFERENCE = re.compile(r"^ {0,3}\[([^\]]+)\]:[ \t]*(.*)$", re.MULTILINE)
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
_INLINE_CODE = re.compile(r"(`+)(?:(?!\1).)*?\1")


def _destination(text: str, start: int, *, inline: bool) -> tuple[str, int] | None:
    """Read a Markdown destination, including escapes and balanced parentheses."""
    if start >= len(text):
        return None
    chars = []
    angle = text[start] == "<"
    index = start + int(angle)
    depth = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text):
            chars.append(text[index + 1])
            index += 2
            continue
        if angle:
            if char == ">":
                return "".join(chars), index + 1
            if char in "\n\r<":
                return None
        else:
            if char == "(" and inline:
                depth += 1
            elif char == ")" and inline:
                if depth == 0:
                    break
                depth -= 1
            elif char.isspace():
                break
        chars.append(char)
        index += 1
    if not chars or depth:
        return None
    return "".join(chars), index


def _inline_targets(text: str):
    index = 0
    while index < len(text):
        if text[index] != "[" or index > 0 and text[index - 1] == "\\":
            index += 1
            continue
        depth = 1
        cursor = index + 1
        while cursor < len(text) and depth:
            if text[cursor] == "\\":
                cursor += 2
                continue
            if text[cursor] == "[":
                depth += 1
            elif text[cursor] == "]":
                depth -= 1
            cursor += 1
        if depth == 0 and cursor < len(text) and text[cursor] == "(":
            parsed = _destination(text, cursor + 1, inline=True)
            if parsed:
                destination, end = parsed
                rest = text[end:]
                if rest.startswith(")") or re.match(r"\s+(['\"]).*?\1\s*\)", rest):
                    yield destination
        index = max(cursor, index + 1)


def _targets(content: str):
    lines = []
    fence = None
    for line in content.splitlines():
        marker = _FENCE.match(line)
        if marker:
            chars = marker.group(1)
            if fence is None:
                fence = chars
            elif chars[0] == fence[0] and len(chars) >= len(fence):
                fence = None
            lines.append("")
        elif fence:
            lines.append("")
        else:
            lines.append(_INLINE_CODE.sub("", line))
    prose = "\n".join(lines)
    yield from _inline_targets(prose)
    for match in _REFERENCE.finditer(prose):
        if not match.group(1).startswith("^"):
            parsed = _destination(match.group(2), 0, inline=False)
            if parsed:
                yield parsed[0]


def check_docs(root: Path) -> list[str]:
    errors = []
    docs = root / "internal_docs"
    if not docs.is_dir():
        return ["internal_docs is missing"]
    for source in docs.rglob("*.md"):
        if source.is_symlink():
            errors.append(f"{source.relative_to(root)}: symlink Markdown file")
            continue
        content = source.read_text(encoding="utf-8")
        for link in _targets(content):
            parsed = urlsplit(link)
            if parsed.scheme or parsed.netloc or link.startswith(("//", "mailto:")):
                continue
            pathname = unquote(parsed.path)
            if not pathname and not parsed.fragment:
                continue
            target = (source.parent / pathname).resolve() if pathname else source.resolve()
            if not target.is_relative_to(root.resolve()) or not target.exists():
                errors.append(f"{source.relative_to(root)}: missing local link {link}")
                continue
    if not list(docs.rglob("*.md")):
        errors.append("internal_docs contains no Markdown")
    return errors


def gate(
    kind: str,
    classify: str,
    docs_only_value: str,
    docs: str,
    full: str = "",
    musl: str = "",
    markers: Path | None = None,
) -> bool:
    if classify != "success":
        return False
    if docs_only_value == "true":
        return docs == "success" and full == "skipped" and (kind == "source" or musl == "skipped")
    if docs_only_value != "false" or docs != "skipped" or full != "success":
        return False
    if kind == "source":
        return True
    expected = {
        f"passed-{runner}-{python}"
        for runner in (
            "macos-15",
            "macos-15-intel",
            "ubuntu-24.04",
            "ubuntu-24.04-arm",
            "windows-2025",
            "windows-11-arm",
        )
        for python in ("3.12", "3.14")
    }
    expected.update({"passed-alpine-ubuntu-24.04", "passed-alpine-ubuntu-24.04-arm"})
    return (
        musl == "success"
        and markers is not None
        and markers.is_dir()
        and {p.name for p in markers.iterdir() if p.is_file()} == expected
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    classify = sub.add_parser("classify")
    classify.add_argument("--base", required=True)
    classify.add_argument("--head", required=True)
    sub.add_parser("check-docs")
    gate_parser = sub.add_parser("gate")
    gate_parser.add_argument("--kind", choices=("source", "runtime"), required=True)
    gate_parser.add_argument("--classify", required=True)
    gate_parser.add_argument("--docs-only", required=True)
    gate_parser.add_argument("--docs", required=True)
    gate_parser.add_argument("--full", required=True)
    gate_parser.add_argument("--musl", default="")
    gate_parser.add_argument("--markers", type=Path)
    args = parser.parse_args()
    if args.command == "classify":
        value = "true" if docs_only(args.base, args.head) else "false"
        print(f"docs_only={value}")
        if output := os.environ.get("GITHUB_OUTPUT"):
            with open(output, "a", encoding="utf-8") as stream:
                stream.write(f"docs_only={value}\n")
        return 0
    if args.command == "gate":
        passed = gate(
            args.kind, args.classify, args.docs_only, args.docs, args.full, args.musl, args.markers
        )
        print(f"{args.kind} validation gate: {'passed' if passed else 'failed'}")
        return 0 if passed else 1
    errors = check_docs(Path.cwd())
    for error in errors:
        print(error, file=sys.stderr)
    print(f"Checked internal Markdown links: {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
