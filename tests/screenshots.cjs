// Regenerates every README image in docs/media/ from the DEMO feed (never live):
//   npm run screenshots [-- name ...]
// Stills are drawn with ?drive=1 (the kit draws one frame on demand at a
// chosen scene time), so they repeat. The GIF steps scene time frame by frame
// and hands the page a new demo snapshot every second, so tool calls pop
// their notes; it is encoded with Pillow (tests/make_gif.py).
const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");
const h = require("../vendor/agentviz-kit/tests/harness.cjs");
const screens = require("../vendor/agentviz-kit/tests/screens.cjs");

const REPO = path.resolve(__dirname, "..");
const MEDIA = path.join(REPO, "docs/media");
const PORT = Number(process.env.ORCHESTRA_TEST_PORT || 9129);
const READY = "window.__page && window.__page.polls > 0 && window.__orchestra.figs.size > 0";
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const DESKTOP = {viewport: {width: 1600, height: 900}};
const PHONE = {viewport: {width: 390, height: 844}, dpr: 3, mobile: true};

// Camera helpers run in the page: frame the stage or a figure, draw at scene time T.
const HELPERS = `
window.__shots = {
  T: 3,
  at(t) { const s = window.__orchestra; for (let x = s.lastT || 0; x < t; x += 0.25) window.__strataKit.drive(x); this.T = t; },
  cam(c) { window.__page.hold(); Object.assign(window.__page.kit.cam, c); },
  fit(c) { window.__page.fit(true); window.__page.hold(); this.cam(c || {}); },
  fig(id, c) { const f = window.__orchestra.figs.get(id).target;
    this.cam(Object.assign({tx: f.x + (c.dx || 0), ty: f.y + (c.dy != null ? c.dy : 0.8), tz: f.z + (c.dz || 0)}, c)); },
  // A new tool call by each id, then scene time to just after the last note starts.
  calls(ids) { const p = window.__page, doc = JSON.parse(JSON.stringify(p.doc));
    for (const id of ids) { const [sid, fid] = id.split("/"), s = doc.sessions.find((x) => x.id === sid);
      if (fid) s.followers.find((f) => f.id === fid).toolCount += 1; else s.lastToolAt += 1; }
    p.feed(doc);
    const at = Math.max(...ids.map((id) => window.__orchestra.calls.get(id).at));
    this.at(at + 0.12); },
  draw() { window.__strataKit.drive(this.T); },
};`;

async function openPage(browser, server, options) {
  const opened = await h.open(browser, `${server.base}/?fixture=1&drive=1`, Object.assign({ready: READY}, options));
  await h.stillAnimations(opened.page);
  await opened.page.evaluate(() => window.__page.stopPolling());
  await opened.page.evaluate(HELPERS);
  await opened.page.evaluate(() => window.__shots.at(3));
  return opened;
}

async function shoot(page, name, setup) {
  if (!want(name)) return;
  await page.evaluate(setup);
  await screens.still(page, path.join(MEDIA, name + ".png"), () => window.__shots.draw());
}

const Y = "Math.PI / 2";
// Stalled flash at its peak: pulse(t, 0.7) is 1 at t = (k + 0.25) / 0.7.
const STALL_PEAK = (7 + 0.25) / 0.7;
const DESKTOP_SHOTS = [
  ["hero", "window.__shots.fit()"],
  ["angle-side", `window.__shots.fit({yaw: ${Y} + 0.75, pitch: 0.5})`],
  ["angle-top", `window.__shots.fit({yaw: ${Y} - 0.35, pitch: 1.22})`],
  ["closeup-lead", `window.__shots.fig('demo-lead-b', {dz: -2.4, yaw: ${Y} + 0.25, pitch: 0.6, dist: 12})`],
  ["closeup-waiting", `window.__shots.fig('demo-waiting', {dz: 0.6, dx: 0.7, dy: 1.4, yaw: ${Y} - 0.3, pitch: 0.45, dist: 6.5})`],
  ["closeup-question", `window.__shots.fig('demo-asker', {dz: 0.6, dx: 0.7, dy: 1.6, yaw: ${Y} + 0.3, pitch: 0.4, dist: 6.5})`],
  ["closeup-idle-offline", `window.__shots.fig('demo-idle', {dx: -1.6, dz: -0.6, yaw: ${Y} + 0.2, pitch: 0.75, dist: 9})`],
  ["closeup-resting", `window.__shots.fig('demo-lead-a', {dz: -2.0, dx: 1.5, yaw: ${Y} - 0.45, pitch: 0.55, dist: 9})`],
  ["closeup-stalled", `window.__shots.at(${STALL_PEAK}); window.__shots.fig('demo-stalled', {dy: 1.2, yaw: ${Y} + 0.3, pitch: 0.45, dist: 7.5})`],
  ["closeup-stalled-musician", `window.__shots.fig('demo-lead-b/demo-b7', {dy: 1.0, yaw: ${Y} - 0.5, pitch: 0.5, dist: 6.5})`],
  ["closeup-call", `window.__shots.calls(['demo-solo']);
    window.__shots.fig('demo-solo', {dx: 0.4, dy: 1.6, yaw: ${Y} + 0.1, pitch: 0.42, dist: 6})`],
  ["panel-desktop", `window.__shots.at(${STALL_PEAK + 1}); window.__shots.fit(); window.__page.select('demo-lead-b/demo-b6')`],
];

async function desktopStills(browser, server) {
  const {ctx, page, errors} = await openPage(browser, server, DESKTOP);
  for (const [name, setup] of DESKTOP_SHOTS) await shoot(page, name, setup);
  h.assertNoErrors(errors);
  await ctx.close();
}

async function phoneStills(browser, server) {
  if (!want("phone") && !want("phone-sheet")) return;
  const {ctx, page, errors} = await openPage(browser, server, PHONE);
  await shoot(page, "phone-sheet", "window.__shots.fit(); window.__page.tap('demo-waiting')");
  await shoot(page, "phone", "window.__page.select(null); window.__shots.fit()");
  h.assertNoErrors(errors);
  await ctx.close();
}

// The GIF: Otto's and Wren's ensembles playing, a new demo snapshot every
// second (new tool calls pop notes), stepped at 10 frames a second.
async function motionGif(browser, server) {
  if (!want("motion")) return;
  const {ctx, page, errors} = await openPage(browser, server, {viewport: {width: 880, height: 495}});
  await page.evaluate(async () => {
    const base = await (await fetch("/api/agents?fixture=1")).json();
    // Each push is one more demo poll: page.js's demoCalls moves lastToolAt / toolCount.
    window.__feedDemo = () => window.__page.feed(JSON.parse(JSON.stringify(base)));
    window.__feedDemo();
    window.__shots.at(6);
    const a = window.__orchestra.figs.get("demo-lead-a").target, b = window.__orchestra.figs.get("demo-lead-b").target;
    window.__shots.cam({tx: (a.x + b.x) / 2, ty: 0.6, tz: (a.z + b.z) / 2 - 1.6, yaw: Math.PI / 2 + 0.1, pitch: 0.62, dist: 15});
    // Labels slow every headless frame several-fold; the GIF is about motion.
    document.getElementById("labels").style.visibility = "hidden";
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-gif-"));
  const FPS = 10;
  await screens.frames(page, tmp, FPS * 6, (i) => {
    if (i % 10 === 0) window.__feedDemo();
    window.__strataKit.drive(6 + i / 10);
  });
  execFileSync("python3", [path.join(__dirname, "make_gif.py"), tmp, path.join(MEDIA, "motion.gif"), String(FPS), "720"],
    {stdio: "inherit"});
  fs.rmSync(tmp, {recursive: true, force: true});
  h.assertNoErrors(errors);
  await ctx.close();
}

h.run("screenshots", {repo: REPO, port: PORT}, async ({server, browser}) => {
  fs.mkdirSync(MEDIA, {recursive: true});
  await desktopStills(browser, server);
  await phoneStills(browser, server);
  await motionGif(browser, server);
});
