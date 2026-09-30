"""Offline Edge/Chrome smoke checks for the static portfolio demo.

Run after npm run build: python scripts/browser_smoke.py --browser <browser executable>
Uses an ephemeral local server, an isolated browser profile, and CDP.
Does not invoke Gemini, TTS, or deployed APIs.
"""

import argparse
import asyncio
import functools
import http.server
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.request

import websockets


ROOT = Path(__file__).resolve().parents[1]


class Handler(http.server.SimpleHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError):
            pass

    def do_GET(self):
        if self.path.split("?")[0] in ("/sample", "/configure", "/dashboard", "/voice"):
            self.path = "/index.html"
        super().do_GET()

    def log_message(self, *_):
        pass


async def probe(socket_url, base_url):
    async with websockets.connect(socket_url, max_size=10_000_000) as socket:
        request_id = 0

        async def command(method, params=None):
            nonlocal request_id
            request_id += 1
            current = request_id
            await socket.send(json.dumps({"id": current, "method": method, "params": params or {}}))
            while True:
                result = json.loads(await socket.recv())
                if result.get("id") == current:
                    if "error" in result:
                        raise RuntimeError(result["error"])
                    return result.get("result", {})

        async def evaluate(expression):
            response = await command("Runtime.evaluate", {"expression": expression, "returnByValue": True})
            if "exceptionDetails" in response:
                raise RuntimeError(response["exceptionDetails"])
            return response["result"].get("value")

        async def navigate(path):
            await command("Page.navigate", {"url": base_url + path})
            for _ in range(60):
                if await evaluate("!!document.querySelector('h1')"):
                    return
                await asyncio.sleep(0.1)
            raise AssertionError(f"Page did not render: {path}")

        await command("Network.enable")
        await command("Network.setBlockedURLs", {"urls": ["*onrender.com*", "*googleapis.com*", "*/api/*", "*/health"]})
        await command("Page.enable")
        for width, height in [(1440, 1000), (390, 844)]:
            await command("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width < 600})
            await navigate("/")
            assert "A qualified lead" in await evaluate("document.querySelector('h1').textContent")
            assert await evaluate("!!document.querySelector('a[href=\"/voice\"]')")
            await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Hinglish').click()")
            await asyncio.sleep(0.1)
            assert await evaluate("document.querySelector('[aria-live=polite]').textContent.includes('Interest hai')")
            assert await evaluate("document.querySelector('[aria-pressed=true]').textContent.trim() === 'Hinglish'")
            assert await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
            await navigate("/sample")
            assert "explainable handoff" in await evaluate("document.querySelector('h1').textContent")
            for _ in range(4):
                await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Next turn')).click()")
                await asyncio.sleep(0.05)
            assert await evaluate("document.querySelectorAll('article').length") == 5
            await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Inspect sample handoff')).click()")
            await asyncio.sleep(0.1)
            assert await evaluate("!!document.querySelector('[role=dialog]')")
            assert await evaluate("document.body.textContent.includes('Transcript evidence')")
            assert await evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)")
            assert await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
            await command("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
            await asyncio.sleep(0.1)
            assert not await evaluate("!!document.querySelector('[role=dialog]')")
            assert await evaluate("document.activeElement.textContent.includes('Inspect sample handoff')")
            await navigate("/configure")
            assert await evaluate("document.querySelectorAll('label').length") == 5
            assert await evaluate("document.querySelector('button[type=submit]').textContent.includes('voice')")
            assert await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
            await navigate("/voice")
            assert await evaluate("document.body.textContent.includes('Example Academy')")
            assert await evaluate("document.querySelector('select').value === 'gemini-3.8-live'")
            assert await evaluate("document.querySelector('a[href=\"/voice/classic\"]') !== null")
            assert await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
            print(f"PASS {width}px: hero language toggle, CTA, sample turns, evidence dialog, Escape, configuration labels, overflow")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, required=True)
    args = parser.parse_args()
    assert args.browser.is_file(), "Browser executable missing"
    assert (ROOT / "frontend/dist/index.html").is_file(), "Build the frontend first"
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT / "frontend/dist")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="rupeezy-browser-") as profile:
        process = subprocess.Popen([str(args.browser), "--headless", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9238", f"--user-data-dir={profile}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(60):
                try:
                    with urllib.request.urlopen("http://127.0.0.1:9238/json") as response:
                        targets = json.load(response)
                    target = next(item for item in targets if item["type"] == "page")
                    break
                except (OSError, StopIteration):
                    time.sleep(0.1)
            else:
                raise RuntimeError("Browser debugging endpoint unavailable")
            asyncio.run(probe(target["webSocketDebuggerUrl"], f"http://127.0.0.1:{server.server_port}"))
        finally:
            process.terminate()
            process.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()
