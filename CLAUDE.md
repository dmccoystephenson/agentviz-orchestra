# CLAUDE.md

agentviz-orchestra: Claude Code sessions drawn as a concert stage (Strata web kit).
Part of the agentviz family: https://github.com/dmccoystephenson/agentviz

- Data comes only from `/api/agents` (vendor/agentfeed; schema in the agentviz repo's docs/FEED.md).
- Shared pieces come from the agentviz kit (docs/KIT.md there): `vendor/agentviz-kit/` and the
  `web/agentviz-*` copies. Never edit `vendor/` or `web/agentviz-*`; re-vendor from an agentviz
  checkout with `tools/vendor-kit.sh <this repo>`. `tests/test_serve.py` checks the PINs.
- Page: `web/orchestra-stage.js` lays out ensembles, conductors and musicians and eases them;
  `web/orchestra-frame.js` packs each frame in the agentviz wire format; `web/orchestra-audio.js`
  is the opt-in sound; `web/page.js` boots the feed client, HUD, labels, camera and per-call notes;
  `web/index.html` holds the theme and the legend.
- Scene: `scene/main.cpp` decodes the wire (`agentviz.h`) and calls `hall.h`, `conductor.h`,
  `musician.h` (with `instruments.h`, `draw_util.h`). Build:
  `EMSDK=/path/to/emsdk vendor/agentviz-kit/scene/build-scene.sh scene/kit.conf`
  (emsdk 6.0.11, Strata 0.10.0). The built `web/orchestra-engine.*` are committed.
- Run: `python3 -m vendor.agentfeed serve --web web --port 8849 [--fixture]`.
- Tests: `python3 -m unittest discover -s tests`; browser tests after `npm ci` and
  `npx playwright install chromium`: `npm run smoke`, `npm run screenshots` (Pillow from
  requirements-dev.txt for the GIF). Tests use port 9129 (`ORCHESTRA_TEST_PORT` overrides).
- Audio is OFF by default: no AudioContext exists until the "Sound on" button. Never autoplay.
- Screenshots come from the FIXTURE feed only, never live sessions.
