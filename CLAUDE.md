# agentviz-orchestra

One visualization in the [agentviz](https://github.com/dmccoystephenson/agentviz) family:
Claude Code sessions drawn as a concert stage with Strata's web kit.

- Data comes ONLY from `/api/agents` (vendor/agentfeed, schema in agentviz docs/FEED.md).
  Never edit `vendor/agentfeed/`; re-vendor with `agentviz/tools/vendor-feed.sh`.
- Scene: `scene/main.cpp` (draws rows the page writes), page: `web/index.html` +
  `web/orchestra.js` (layout, easing, picking, panel, audio). Build with `scene/build.sh`;
  the built `web/orchestra-engine.{js,wasm}` and kit scripts are committed.
- Run: `python3 -m vendor.agentfeed serve --web web --port 8849 [--fixture]`. Port 8849 only
  (8949 for tests).
- Test: `python3 -m unittest discover -s tests` and
  `NODE_PATH=/root/arcade-watch/node_modules node tests/smoke.cjs`.
- Audio is OFF by default and only starts from the "Sound on" button. Never autoplay.
- Screenshots come from the fixture feed only, never live sessions.
