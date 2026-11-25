// Regenerates every README image in docs/media/ from the FIXTURE feed:
//   NODE_PATH=/root/arcade-watch/node_modules node tests/screenshots.cjs
// Never point this at a live feed: the README shows synthetic sessions only.
const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");
const {repo, serve, launch, open, settle} = require("./harness.cjs");

const media = path.join(repo, "docs/media");
// Generous: headless SwiftShader on a busy machine can take minutes per shot.
const SHOT = {timeout: 600000, animations: "disabled"};

// Point the camera at a figure (or the stage) and hold it there.
async function look(page, o) {
  await page.evaluate((o) => {
    const O = window.__orchestra, cam = O.kit.cam;
    O.hold();
    if (o.fit) O.fitCamera();
    if (o.at) {
      const f = O.model.figs.get(o.at);
      cam.tx = f.target.x + (o.dx || 0); cam.ty = f.target.y + (o.dy ?? 0.8); cam.tz = f.target.z + (o.dz || 0);
    }
    for (const k of ["yaw", "pitch", "dist", "tx", "ty", "tz"]) if (o[k] != null) cam[k] = o[k];
  }, o);
}

async function shot(page, name, t) {
  await settle(page, t, t + 0.5, 0.25);
  await page.screenshot({path: path.join(media, name), ...SHOT});
  console.log("saved", name);
}

(async () => {
  fs.mkdirSync(media, {recursive: true});
  const server = await serve();
  const browser = await launch();
  try {
    // Desktop, 1600 x 900.
    const page = await open(browser, {viewport: {width: 1600, height: 900}});
    await settle(page, 0, 3);
    await look(page, {fit: true});
    await shot(page, "hero.png", 3);
    await look(page, {fit: true, yaw: Math.PI / 2 + 0.75, pitch: 0.5});
    await shot(page, "angle-side.png", 4);
    await look(page, {fit: true, yaw: Math.PI / 2 - 0.35, pitch: 1.22});
    await shot(page, "angle-top.png", 5);
    await look(page, {at: "demo-lead-b", dz: -2.2, yaw: Math.PI / 2 + 0.25, pitch: 0.6, dist: 11});
    await shot(page, "closeup-lead.png", 6);
    await look(page, {at: "demo-waiting", dz: 2.6, dx: 0.6, dy: 0.2, yaw: Math.PI / 2 - 0.35, pitch: 0.42, dist: 10.5});
    await shot(page, "closeup-waiting.png", 7);
    await look(page, {at: "demo-idle", dx: -2.2, yaw: Math.PI / 2 + 0.2, pitch: 0.6, dist: 10});
    await shot(page, "closeup-idle-offline.png", 8);
    await look(page, {at: "demo-lead-a", dz: -2.0, dx: 1.5, yaw: Math.PI / 2 - 0.45, pitch: 0.55, dist: 9});
    await shot(page, "closeup-resting.png", 9);
    // Stalled: the fixture's thinker (Scout) has written nothing for 400 s while busy.
    await look(page, {at: "demo-thinker", yaw: Math.PI / 2 + 0.3, pitch: 0.45, dist: 7.5});
    let best = 10;  // catch the red flash at its peak (0.7 Hz pulse)
    for (let t = 10; t < 11.5; t += 0.05) { const p = 0.5 + 0.5 * Math.sin(t * 0.7 * 2 * Math.PI); if (p > 0.99) { best = t; break; } }
    await page.evaluate((t) => window.__strataKit.drive(t), best - 0.25);
    await page.evaluate((t) => window.__strataKit.drive(t), best);
    await page.screenshot({path: path.join(media, "closeup-stalled.png"), ...SHOT});
    console.log("saved closeup-stalled.png");
    // The panel, desktop.
    await look(page, {fit: true});
    await page.evaluate(() => window.__orchestra.select("demo-lead-a"));
    await shot(page, "panel-desktop.png", 12);
    await page.evaluate(() => window.__orchestra.select(null));

    // Motion: ~5 s at 10 fps of the two big ensembles.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-gif-"));
    await page.setViewportSize({width: 800, height: 450});
    await look(page, {at: "demo-lead-b", dx: 4.5, dz: -1.8, yaw: Math.PI / 2 + 0.1, pitch: 0.62, dist: 15});
    await settle(page, 13, 14);
    // Labels slow every headless screenshot several-fold; the GIF is about motion.
    await page.evaluate(() => { document.getElementById("labels").style.visibility = "hidden"; });
    const frames = [];
    for (let i = 0; i < 50; i++) {
      await page.evaluate((t) => window.__strataKit.drive(t), 14 + i * 0.1);
      const f = path.join(tmp, `f${String(i).padStart(3, "0")}.png`);
      await page.screenshot({path: f, ...SHOT});
      frames.push(f);
    }
    execFileSync("python3", [path.join(__dirname, "make_gif.py"), path.join(media, "motion.gif"), "10", ...frames]);
    fs.rmSync(tmp, {recursive: true, force: true});
    console.log("saved motion.gif");
    await page.context().close();

    // Phone portrait, 390 x 844 at DPR 3, bottom sheet open on the waiting conductor.
    const phone = await open(browser, {viewport: {width: 390, height: 844}, dpr: 3, touch: true});
    await settle(phone, 0, 3);
    await look(phone, {fit: true});
    await phone.evaluate(() => window.__orchestra.select("demo-waiting"));
    await shot(phone, "phone-sheet.png", 3);
    await look(phone, {fit: true});
    await phone.evaluate(() => window.__orchestra.select(null));
    await shot(phone, "phone.png", 4);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
