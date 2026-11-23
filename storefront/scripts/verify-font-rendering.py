#!/usr/bin/env python3
"""Check compiled font CSS and actual production-rendered preload links."""
import os
from html.parser import HTMLParser
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True
from font_contract import validate_compiled_css, validate_preload_html

ROOT = Path(__file__).resolve().parents[1]


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict[str, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "link":
            self.links.append(dict(attrs))


def fetch(url: str, timeout: int = 10) -> tuple[int, bytes]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.status, response.read()


def main() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/nonexistent"),
        "NODE_ENV": "production",
        "NEXT_TELEMETRY_DISABLED": "1",
    }
    command = ["node", "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", str(port)]
    server = subprocess.Popen(
        command,
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    origin = f"http://127.0.0.1:{port}"
    try:
        response_body: bytes | None = None
        for attempt in range(40):
            if server.poll() is not None:
                raise RuntimeError(f"next start exited with {server.returncode}")
            try:
                status, response_body = fetch(origin + "/it/privacy", timeout=20)
                if status != 200:
                    raise RuntimeError(f"production route returned HTTP {status}")
                break
            except urllib.error.HTTPError as exc:
                raise RuntimeError(f"production route returned HTTP {exc.code}") from exc
            except (ConnectionError, TimeoutError, urllib.error.URLError):
                if attempt == 39:
                    raise RuntimeError("production server did not serve /it/privacy")
                time.sleep(0.25)
        if response_body is None:
            raise RuntimeError("production route returned no HTML")

        html = response_body.decode("utf-8", "replace")
        validate_preload_html(html)
        parser = _LinkParser()
        parser.feed(html)
        stylesheet_hrefs = [
            link.get("href") for link in parser.links
            if "stylesheet" in (link.get("rel") or "").lower().split() and link.get("href")
        ]
        if not stylesheet_hrefs:
            raise RuntimeError("rendered HTML contains no stylesheet links")

        matching_stylesheets = 0
        for href in stylesheet_hrefs:
            url = urllib.parse.urljoin(origin, href or "")
            status, data = fetch(url)
            if status != 200:
                raise RuntimeError(f"compiled CSS returned HTTP {status}: {href}")
            css = data.decode("utf-8", "replace")
            try:
                validate_compiled_css(css)
            except ValueError:
                continue
            matching_stylesheets += 1
        if matching_stylesheets != 1:
            raise RuntimeError(f"found {matching_stylesheets} linked stylesheets with the baseline font contract")

        print("PASS: GET /it/privacy returned production HTML (HTTP 200)")
        print("PASS: rendered HTML contains exactly the three baseline latin font preload links")
        print("PASS: fetched linked CSS contains the 54-face baseline descriptor/unicode fingerprint")
        return 0
    finally:
        try:
            os.killpg(server.pid, signal.SIGTERM)
            server.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(server.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            server.wait(timeout=5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL: {error}", file=__import__("sys").stderr)
        raise SystemExit(1)
