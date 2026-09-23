"""Public-only, bounded web page retrieval without live network access."""

import socket
from email.message import Message

import pytest

from nbinlineai import web_tools


def _headers(content_type: str = "text/html", location: str = "") -> Message:  # HTTP test headers
    """Build simple HTTP metadata for an intercepted page response."""
    headers = Message()
    headers["Content-Type"] = content_type
    if location:
        headers["Location"] = location
    return headers


def test_public_ip_filter_rejects_private_literals_and_mixed_dns(
    monkeypatch: pytest.MonkeyPatch,  # Replace DNS without network access.
) -> None:
    """A host with any private answer cannot be used by a fetch."""
    for host in ("localhost", "127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "192.168.1.4"):
        with pytest.raises(ValueError, match="public"):
            web_tools._public_addresses(host, 80)

    def mixed_dns(
        host: str,  # queried hostname
        port: int,  # queried port
        **kwargs: object,  # socket resolver hints
    ) -> list[tuple]:
        """Return one public and one private address for the same name."""
        assert host == "mixed.example" and port == 443
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443)),
        ]

    monkeypatch.setattr(socket, "getaddrinfo", mixed_dns)
    with pytest.raises(ValueError, match="public"):
        web_tools._public_addresses("mixed.example", 443)


def test_fetch_converts_html_after_void_images_and_excludes_active_content(
    monkeypatch: pytest.MonkeyPatch,  # Intercept the HTTP response.
) -> None:
    """An image does not suppress useful later text, and scripts/media vanish."""
    html = (
        "<html><body><h1>Python lesson</h1><img src='autoplay.png'>"
        "<p>Useful paragraph after the image.</p>"
        "<p>Escaped example: &lt;img src='literal.png'&gt;</p>"
        "<script>alert('secret script')</script><nav>Skip navigation</nav>"
        "<pre>print(2)</pre><p>Final explanation.</p></body></html>"
    )

    def fake_download(
        url: str,  # requested page
        deadline: float,  # overall fetch deadline
    ) -> tuple[int, Message, bytes]:
        """Return a local HTML body with no network operation."""
        assert url == "https://docs.python.org/3/tutorial/" and deadline > 0
        return 200, _headers(), html.encode()

    monkeypatch.setattr(web_tools, "_download_once", fake_download)
    result = web_tools.fetch_url_markdown("https://docs.python.org/3/tutorial/")
    assert result.startswith("Source: https://docs.python.org/3/tutorial/")
    for expected in ("# Python lesson", "Useful paragraph after the image.", "print(2)", "Final explanation."):
        assert expected in result
    for excluded in ("autoplay.png", "secret script", "Skip navigation", "<img", "<script"):
        assert excluded not in result
    assert "&lt;img src='literal.png'&gt;" in result


def test_redirects_recheck_each_url_and_content_type_is_bounded(
    monkeypatch: pytest.MonkeyPatch,  # Intercept redirect hops.
) -> None:
    """Use only the final source URL and reject non-page MIME types."""
    requested: list[str] = []

    def redirected(
        url: str,  # current redirect hop
        deadline: float,  # shared overall deadline
    ) -> tuple[int, Message, bytes]:
        """Return one redirect followed by short Markdown."""
        assert deadline > 0
        requested.append(url)
        if len(requested) == 1:
            return 302, _headers(location="/3/library/"), b""
        return 200, _headers("text/markdown"), b"# Library\nUseful details."

    monkeypatch.setattr(web_tools, "_download_once", redirected)
    result = web_tools.fetch_url_markdown("https://docs.python.org/3/")
    assert requested == ["https://docs.python.org/3/", "https://docs.python.org/3/library/"]
    assert result.startswith("Source: https://docs.python.org/3/library/")
    assert "Useful details." in result

    monkeypatch.setattr(web_tools, "_download_once", lambda url, deadline: (
        200, _headers("application/pdf"), b"%PDF"
    ))
    with pytest.raises(ValueError, match="HTML, Markdown, or plain text"):
        web_tools.fetch_url_markdown("https://docs.python.org/manual.pdf")


def test_plain_markdown_strips_inline_and_reference_images(
    monkeypatch: pytest.MonkeyPatch,  # Replace public page fetch.
) -> None:
    """A remote Markdown page cannot turn image embeds into notebook media."""
    markdown = (
        "# Lesson\nUseful text.\n"
        "![inline](https://cdn.example/picture.png)\n"
        "![reference][photo]\n[photo]: https://cdn.example/picture.png\n"
        "<img src='https://cdn.example/other.png'>\n"
    )
    monkeypatch.setattr(web_tools, "_download_once", lambda url, deadline: (
        200, _headers("text/markdown"), markdown.encode()
    ))
    result = web_tools.fetch_url_markdown("https://docs.python.org/3/")
    assert "Useful text." in result
    assert "![" not in result and "<img" not in result


def test_redirect_to_private_host_is_rejected_before_connecting(
    monkeypatch: pytest.MonkeyPatch,  # Intercept the first public response.
) -> None:
    """A public page cannot redirect a note fetch into a loopback service."""
    original = web_tools._download_once

    def first_public_then_validate(
        url: str,  # redirect hop
        deadline: float,  # shared overall deadline
    ) -> tuple[int, Message, bytes]:
        """Let the real URL validator handle the private second hop."""
        if url == "https://docs.python.org/3/":
            return 302, _headers(location="https://127.0.0.1/internal"), b""
        return original(url, deadline)

    monkeypatch.setattr(web_tools, "_download_once", first_public_then_validate)
    with pytest.raises(ValueError, match="public"):
        web_tools.fetch_url_markdown("https://docs.python.org/3/")

    monkeypatch.setattr(web_tools, "_download_once", lambda url, deadline: (
        302, _headers(location="http://example.com/plain"), b""
    ))
    with pytest.raises(ValueError, match="insecure HTTP"):
        web_tools.fetch_url_markdown("https://docs.python.org/3/")


def test_slow_trickle_hits_total_deadline(
    monkeypatch: pytest.MonkeyPatch,  # Fake transport and clock.
) -> None:
    """An active socket cannot keep a page fetch alive with endless tiny reads."""
    class FakeSocket:
        """Record read timeout changes without opening a connection."""

        def settimeout(self, value: float) -> None:  # value: seconds left in request
            """Accept the tightened timeout."""
            assert value > 0

    class FakeResponse:
        """Return one byte each time to simulate a slow trickle."""

        status = 200
        headers = _headers()

        def getheader(self, name: str) -> None:  # name: requested HTTP header
            """Declare no Content-Length."""

        def read1(self, size: int) -> bytes:  # size: bounded read size
            """Keep the response alive with a tiny chunk."""
            return b"x"

    class FakeConnection:
        """Expose a socket and response without network I/O."""

        def __init__(
            self,
            host: str,  # validated host
            port: int,  # HTTP port
            address: str,  # pinned public IP
        ) -> None:
            """Set up the fake transport."""
            self.sock = FakeSocket()
            self.timeout = 8.0

        def request(self, method: str, target: str, headers: dict[str, str]) -> None:  # HTTP request metadata
            """Accept the outgoing request."""
            assert method == "GET"

        def getresponse(self) -> FakeResponse:
            """Provide a slowly streaming page."""
            return FakeResponse()

        def close(self) -> None:
            """Close the fake connection."""

    clock = iter((0.0, 0.5, 1.5))
    monkeypatch.setattr(web_tools, "_public_addresses", lambda host, port: ["93.184.216.34"])
    monkeypatch.setattr(web_tools, "_PinnedHTTPConnection", FakeConnection)
    monkeypatch.setattr(web_tools.time, "monotonic", lambda: next(clock))
    with pytest.raises(ValueError, match="time limit"):
        web_tools._download_once("http://example.com/", deadline=1.0)


def test_fetch_rejects_non_http_urls_and_credential_authorities() -> None:
    """Reject unsafe schemes and URL-embedded credentials before DNS."""
    for url, error in (
        ("file:///etc/passwd", "HTTP or HTTPS"),
        ("http://127.0.0.1/private", "public"),
        ("https://user:secret@example.com/", "credentials"),
        ("https://example.com/\nprivate", "public HTTP"),
    ):
        with pytest.raises(ValueError, match=error):
            web_tools.fetch_url_markdown(url)
