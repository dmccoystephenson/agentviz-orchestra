"""Serves the fixture on the test port and checks the page, its assets and the feed."""
import json
import os
import subprocess
import sys
import time
import unittest
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("ORCHESTRA_TEST_PORT", "8949"))
BASE = "http://127.0.0.1:%d" % PORT


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


class ServeFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.Popen(
            [sys.executable, "-m", "vendor.agentfeed", "serve", "--web", "web", "--port", str(PORT), "--fixture"],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                get("/api/agents")
                return
            except OSError:
                time.sleep(0.2)
        cls.proc.kill()
        raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.proc.stdout.close()

    def test_page_and_assets(self):
        for path, ctype in [("/", "text/html"), ("/orchestra.js", "javascript"), ("/orchestra-audio.js", "javascript"),
                            ("/strata-kit.js", "javascript"), ("/strata-loader.js", "javascript"),
                            ("/orchestra-engine.js", "javascript"), ("/orchestra-engine.wasm", "application/wasm")]:
            status, got, body = get(path)
            self.assertEqual(status, 200, path)
            self.assertIn(ctype, got, path)
            self.assertGreater(len(body), 100, path)

    def test_page_references(self):
        _, _, body = get("/")
        html = body.decode()
        for name in ["strata-loader.js", "strata-kit.js", "orchestra-audio.js", "orchestra.js", 'id="sound"',
                     'aria-pressed="false"', 'id="panel"']:
            self.assertIn(name, html)

    def test_sound_never_autoplays(self):
        _, _, body = get("/orchestra-audio.js")
        src = body.decode()
        # The only AudioContext is made inside enable(), which only the button calls.
        self.assertEqual(src.count("new AC("), 1)
        _, _, page_js = get("/orchestra.js")
        self.assertEqual(page_js.decode().count("band.enable()"), 1)

    def test_feed_parses(self):
        status, ctype, body = get("/api/agents")
        self.assertEqual(status, 200)
        doc = json.loads(body)
        self.assertEqual(doc["version"], 1)
        self.assertTrue(doc["fixture"])
        states = {s["state"] for s in doc["sessions"]}
        self.assertTrue({"busy", "idle", "waiting", "offline"} <= states)
        actions = {s["action"] for s in doc["sessions"]} | {f["action"] for s in doc["sessions"] for f in s["followers"]}
        self.assertTrue({"edit", "run", "read", "web", "delegate", "think"} <= actions)
        self.assertEqual(sum(len(s["followers"]) for s in doc["sessions"]), 11)

    def test_no_escape_from_web(self):
        with self.assertRaises(urllib.error.HTTPError):
            get("/../vendor/agentfeed/feed.py")


if __name__ == "__main__":
    unittest.main()
