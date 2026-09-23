"""Bounded public HTTP(S) page retrieval for opt-in notebook tools."""

import http.client
import ipaddress
import re
import socket
import ssl
import time
from email.message import Message
from html import escape
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

MAX_WEB_BYTES = 1_000_000
MAX_WEB_CHARS = 8_000
MAX_REDIRECTS = 3
WEB_TIMEOUT_SECONDS = 8
MAX_WEB_TOTAL_SECONDS = 20
ALLOWED_TYPES = {"text/html", "application/xhtml+xml", "text/plain", "text/markdown"}
REDIRECTS = {301, 302, 303, 307, 308}
EXCLUDED_TAGS = {"script", "style", "noscript", "iframe", "svg", "img", "video", "audio", "source",
                 "picture", "canvas", "form", "nav", "footer", "header", "aside", "object", "embed"}
VOID_EXCLUDED_TAGS = {"img", "source", "embed"}


def _public_addresses(
    host: str,  # Hostname from a validated HTTP(S) URL.
    port: int,  # URL port to resolve.
) -> list[str]:  # Public literal addresses safe to connect to.
    """Resolve a host and reject every non-public address before connecting."""
    if not host or len(host) > 253 or any(char.isspace() for char in host) or "%" in host:
        raise ValueError("URL host is invalid")
    if host.lower() == "localhost" or host.lower().endswith((".localhost", ".local", ".internal")):
        raise ValueError("URL host must be public")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not literal.is_global:
            raise ValueError("URL host must be public")
        return [str(literal)]
    try:
        resolved = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise ValueError("Could not resolve public URL host") from exc
    addresses = list(dict.fromkeys(item[4][0] for item in resolved))
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("URL host must resolve only to public addresses")
    return addresses


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """Connect to a validated IP while retaining the requested Host header."""

    def __init__(
        self,
        host: str,  # Original URL hostname.
        port: int,  # URL port.
        address: str,  # Previously validated public IP.
    ) -> None:
        """Bind one request to its validated DNS result."""
        super().__init__(host, port, timeout=WEB_TIMEOUT_SECONDS)
        self._pinned_address = address

    def connect(self) -> None:
        """Avoid a second DNS lookup that could rebound to a private host."""
        self.sock = socket.create_connection((self._pinned_address, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect to a validated IP with TLS verification for the original name."""

    def __init__(
        self,
        host: str,  # Original URL hostname and TLS identity.
        port: int,  # URL port.
        address: str,  # Previously validated public IP.
    ) -> None:
        """Keep the requested hostname for certificate checks and SNI."""
        super().__init__(host, port, timeout=WEB_TIMEOUT_SECONDS, context=ssl.create_default_context())
        self._pinned_address = address

    def connect(self) -> None:
        """Validate TLS against the URL host after connecting to the pinned IP."""
        raw = socket.create_connection((self._pinned_address, self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def _download_once(
    url: str,  # One HTTP(S) URL, with redirects handled by the caller.
    deadline: float,  # Monotonic deadline shared across redirects and body reads.
) -> tuple[int, Message, bytes]:  # HTTP status, headers, and bounded body.
    """Fetch one validated public URL without a proxy or ambient credentials."""
    parsed = urlsplit(url)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise ValueError("URL must use public HTTP or HTTPS")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URL credentials are not allowed")
    try:
        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    except ValueError as exc:
        raise ValueError("URL port is invalid") from exc
    if not 1 <= port <= 65535:
        raise ValueError("URL port is invalid")
    host = parsed.hostname.encode("idna").decode("ascii")
    address = _public_addresses(host, port)[0]
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ValueError("Page fetch exceeded the 20-second time limit")
    connection = (_PinnedHTTPSConnection if parsed.scheme.lower() == "https" else _PinnedHTTPConnection)(
        host, port, address
    )
    connection.timeout = min(WEB_TIMEOUT_SECONDS, remaining)
    target = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
    try:
        connection.request("GET", target, headers={
            "Accept": "text/html, text/markdown, text/plain;q=0.9",
            "Accept-Encoding": "identity",
            "User-Agent": "nbinlineai/1.0 (read-only documentation fetch)",
        })
        response = connection.getresponse()
        headers = response.headers
        if response.status not in REDIRECTS:
            declared = response.getheader("Content-Length")
            if declared and declared.isdecimal() and int(declared) > MAX_WEB_BYTES:
                raise ValueError("Page exceeds the 1 MB download limit")
        chunks: list[bytes] = []
        total = 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("Page fetch exceeded the 20-second time limit")
            if connection.sock is not None:
                connection.sock.settimeout(min(WEB_TIMEOUT_SECONDS, remaining))
            chunk = response.read1(min(65_536, MAX_WEB_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_WEB_BYTES:
                raise ValueError("Page exceeds the 1 MB download limit")
        return response.status, headers, b"".join(chunks)
    except (OSError, TimeoutError, ssl.SSLError, http.client.HTTPException) as exc:
        raise ValueError("Could not fetch public URL") from exc
    finally:
        connection.close()


class _PageMarkdown(HTMLParser):
    """Extract readable page text without scripts, media, or navigation."""

    def __init__(self) -> None:
        """Start a bounded Markdown text accumulator."""
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.excluded_depth = 0
        self.preformatted = 0
        self.length = 0

    def _append(self, value: str) -> None:  # value: safe text or Markdown spacing
        """Stop accumulating after enough text for the final bounded result."""
        if self.length < MAX_WEB_CHARS * 2:
            self.parts.append(value)
            self.length += len(value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:  # attrs: ignored
        """Keep headings, paragraphs, lists, and code while excluding active content."""
        if tag in EXCLUDED_TAGS:
            if tag not in VOID_EXCLUDED_TAGS:
                self.excluded_depth += 1
            return
        if self.excluded_depth:
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "li":
            self._append("\n- ")
        elif tag in ("p", "div", "section", "article", "blockquote"):
            self._append("\n\n")
        elif tag == "br":
            self._append("\n")
        elif tag == "pre":
            self.preformatted += 1
            self._append("\n\n```\n")
        elif tag == "code" and not self.preformatted:
            self._append("`")

    def handle_endtag(self, tag: str) -> None:
        """Close Markdown blocks, including skipped active-content regions."""
        if tag in EXCLUDED_TAGS:
            if tag not in VOID_EXCLUDED_TAGS:
                self.excluded_depth = max(0, self.excluded_depth - 1)
            return
        if self.excluded_depth:
            return
        if tag == "pre" and self.preformatted:
            self.preformatted -= 1
            self._append("\n```\n\n")
        elif tag == "code" and not self.preformatted:
            self._append("`")
        elif tag in ("p", "div", "section", "article", "blockquote") or tag.startswith("h"):
            self._append("\n\n")

    def handle_data(self, data: str) -> None:
        """Add readable text and collapse layout whitespace outside code blocks."""
        if not self.excluded_depth:
            readable = data if self.preformatted else re.sub(r"\s+", " ", data)
            self._append(escape(readable, quote=False))

    def markdown(self) -> str:
        """Normalize the extracted Markdown without emitting active HTML."""
        text = "".join(self.parts).replace("\x00", "")
        text = re.sub(r"[ \t]+\n", "\n", text)
        return re.sub(r"\n{3,}", "\n\n", text).strip()


def _sanitize_plain(
    text: str,  # Remote plain text or Markdown.
) -> str:  # Content without active HTML or image embeds.
    """Remove active content from remotely supplied text before note insertion."""
    text = re.sub(r"<\s*(script|style|iframe|svg|video|audio|object|embed)\b[^>]*>.*?<\s*/\s*\1\s*>",
                  "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<\s*(script|style|iframe|svg|video|audio|object|embed)\b[^>]*?/\s*>",
                  "", text, flags=re.IGNORECASE)
    text = re.sub(r"<\s*(script|style|iframe|svg|video|audio|object|embed)\b[^>]*>.*$",
                  "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<\s*(img|source|picture)\b[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"!\[[^\]]*\]\[[^\]]*\]", "", text)
    text = re.sub(r"\]\(\s*javascript:[^)]*\)", "]", text, flags=re.IGNORECASE)
    return text.replace("\x00", "").strip()


def fetch_url_markdown(
    url: str,  # Public HTTP(S) page to read.
    selector: str = "",  # Optional CSS selector for one HTML section.
    extract_section: bool = False,  # Use the URL fragment when selector is omitted.
) -> str:  # Source-attributed page Markdown, bounded to 8,000 characters.
    """Fetch a public page as short sanitized Markdown for a tool or note."""
    if (not isinstance(url, str) or not url.strip() or len(url) > 2_000
            or any(ord(char) < 32 or ord(char) == 127 for char in url)):
        raise ValueError("url must be a public HTTP(S) URL of at most 2000 characters")
    if not isinstance(selector, str) or len(selector) > 200:
        raise ValueError("selector must be text of at most 200 characters")
    current = url.strip()
    deadline = time.monotonic() + MAX_WEB_TOTAL_SECONDS
    for redirect in range(MAX_REDIRECTS + 1):
        status, headers, raw = _download_once(current, deadline)
        if status in REDIRECTS:
            location = headers.get("Location")
            if not location or redirect == MAX_REDIRECTS:
                raise ValueError("Page redirected too many times")
            next_url = urljoin(current, location)
            if urlsplit(current).scheme.lower() == "https" and urlsplit(next_url).scheme.lower() == "http":
                raise ValueError("HTTPS page redirected to insecure HTTP")
            current = next_url
            continue
        if status != 200:
            raise ValueError(f"Page returned HTTP {status}")
        if headers.get("Content-Encoding", "identity").lower() != "identity":
            raise ValueError("Compressed page content is not supported")
        if not headers.get("Content-Type"):
            raise ValueError("Page must declare an HTML, Markdown, or plain text content type")
        content_type = headers.get_content_type().lower()
        if content_type not in ALLOWED_TYPES:
            raise ValueError("Page must be HTML, Markdown, or plain text")
        charset = headers.get_content_charset() or "utf-8"
        try:
            text = raw.decode(charset, errors="replace")
        except LookupError as exc:
            raise ValueError("Page declared an unsupported text encoding") from exc
        if content_type in ("text/html", "application/xhtml+xml"):
            fragment = unquote(urlsplit(url).fragment) if extract_section else ""
            if selector or fragment:
                text = _selected_html(text, selector, fragment)
            parser = _PageMarkdown()
            parser.feed(text)
            body = parser.markdown()
        else:
            if selector:
                raise ValueError("CSS selectors require an HTML page")
            body = _sanitize_plain(text)
        source = urlunsplit(urlsplit(current)._replace(fragment=""))
        result = f"Source: {source}\n\n{body or '[No readable text on page]'}"
        if len(result) > MAX_WEB_CHARS:
            result = result[:MAX_WEB_CHARS - 42] + "\n[truncated; open the source URL for more]"
        return result
    raise AssertionError("Redirect loop exhausted without returning")


def _selected_html(
    html: str,  # Previously downloaded size-bounded HTML.
    selector: str,  # Explicit CSS selector, or empty for a fragment ID.
    fragment: str,  # Decoded original URL fragment.
) -> str:  # The first selected element, or heading and its section siblings.
    """Extract a page section before the existing sanitized Markdown conversion."""
    from bs4 import BeautifulSoup, Tag
    from soupsieve import SelectorSyntaxError

    soup = BeautifulSoup(html, "html.parser")
    try:
        selected = soup.select_one(selector) if selector else soup.find(id=fragment)
    except SelectorSyntaxError as exc:
        raise ValueError("Invalid CSS selector") from exc
    if selected is None:
        raise ValueError("No page element matches the selector or URL fragment")
    if selected.name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        level = int(selected.name[1])
        parts = [str(selected)]
        for sibling in selected.next_siblings:
            if (isinstance(sibling, Tag) and sibling.name in {"h1", "h2", "h3", "h4", "h5", "h6"}
                    and int(sibling.name[1]) <= level):
                break
            parts.append(str(sibling))
        return "".join(parts)
    return str(selected)


def read_url_section(
    url: str,  # Public page URL, optionally including a section fragment.
    selector: str = "",  # Optional CSS selector for one HTML element or heading section.
) -> str:  # Bounded source-attributed section text.
    """Read one public web-page section using a CSS selector or URL fragment."""
    from ._tool_helpers import _bounded

    return _bounded(fetch_url_markdown(url, selector, extract_section=True))
