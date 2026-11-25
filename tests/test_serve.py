"""Serves the fixture feed next to web/ and checks the page, its assets, the
feed, the vendored copies and the repo's hygiene. Stdlib only:
    python3 -m unittest discover -s tests"""
import json
import os
import re
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("ORCHESTRA_TEST_PORT", "9129"))
BASE = "http://127.0.0.1:%d" % PORT

KIT_SCRIPTS = ("strata-loader.js", "strata-kit.js", "agentviz-feed.js", "agentviz-screen.js", "agentviz-hud.js",
               "agentviz-wire.js")
OWN_SCRIPTS = ("orchestra-audio.js", "orchestra-stage.js", "orchestra-frame.js", "page.js")
PAGE_SCRIPTS = KIT_SCRIPTS + OWN_SCRIPTS


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def read(*parts):
    with open(os.path.join(REPO, *parts), encoding="utf-8") as fh:
        return fh.read()


class ServeFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.Popen(
            [sys.executable, "-m", "vendor.agentfeed", "serve", "--web", "web", "--port", str(PORT), "--fixture"],
            cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                socket.create_connection(("127.0.0.1", PORT), timeout=0.5).close()
                return
            except OSError:
                time.sleep(0.1)
        cls.proc.kill()
        raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)

    def test_page_loads_the_kit_in_order(self):
        status, ctype, body = get("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        html = body.decode()
        positions = [html.index('src="%s"' % name) for name in PAGE_SCRIPTS]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("agentviz-hud.css", html)

    def test_assets(self):
        for asset in PAGE_SCRIPTS + ("agentviz-hud.css", "orchestra-engine.js"):
            status, _, body = get("/" + asset)
            self.assertEqual(status, 200, asset)
            self.assertGreater(len(body), 500, asset)
        status, ctype, body = get("/orchestra-engine.wasm")
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "application/wasm")
        self.assertEqual(body[:4], b"\0asm")

    def test_engine_exports_only_the_wire_setter(self):
        _, _, body = get("/page.js")
        self.assertIn("createOrchestra", body.decode())
        _, _, body = get("/orchestra-engine.js")
        self.assertIn("_agentviz_frame", body.decode())
        self.assertNotIn("_orc_set_", body.decode())

    def test_feed_parses(self):
        status, ctype, body = get("/api/agents?fixture=1")
        self.assertEqual(status, 200)
        self.assertIn("json", ctype)
        doc = json.loads(body)
        self.assertEqual(doc["version"], 1)
        self.assertTrue(doc["fixture"])
        states = {s["state"] for s in doc["sessions"]}
        self.assertTrue({"busy", "idle", "waiting", "offline"} <= states)
        for s in doc["sessions"]:
            for key in ("id", "name", "state", "action", "place", "followers", "seed"):
                self.assertIn(key, s)
            for f in s["followers"]:
                self.assertIn(f["state"], ("active", "resting"))
        reasons = {s.get("waitingReason") for s in doc["sessions"] if s["state"] == "waiting"}
        self.assertEqual(reasons, {"question", "permission"})
        self.assertTrue(any(f.get("stalled") for s in doc["sessions"] for f in s["followers"]))
        self.assertTrue(any(s.get("lastToolAt") for s in doc["sessions"]))

    def test_no_escape_from_web(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            get("/../vendor/agentfeed/feed.py")
        self.assertEqual(e.exception.code, 404)


class PageScriptTest(unittest.TestCase):
    def test_no_comment_only_catch(self):
        # The kit's guard catches empty blocks; this also catches a catch holding only a comment.
        for name in OWN_SCRIPTS:
            self.assertIsNone(re.search(r"catch\s*(\([^)]*\))?\s*\{\s*/\*.*?\*/\s*\}", read("web", name), re.S), name)

    def test_no_audio_context_before_sound_on(self):
        # The only AudioContext is created in Band.enable(), which only the Sound on button calls.
        audio, page = read("web", "orchestra-audio.js"), read("web", "page.js")
        self.assertEqual(audio.count("new AC("), 1)
        self.assertNotIn("AudioContext", page)
        self.assertEqual(page.count("band.enable()"), 1)
        self.assertIn('addEventListener("click"', page[page.index("function soundButton"):page.index("band.enable()")])


class VendoredCopiesTest(unittest.TestCase):
    def test_vendored_copies_match_their_pins(self):
        result = subprocess.run([sys.executable, os.path.join(REPO, "vendor", "agentviz-kit", "check_vendor.py"), REPO],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
