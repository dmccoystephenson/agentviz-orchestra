// Headless smoke test on the demo feed (vendor/agentviz-kit/tests/harness.cjs):
// every fixture agent is on stage; sound is off with no AudioContext until
// "Sound on"; the "needs you" chip cycles both waiting sessions and says why;
// a tap selects what a pick there returns; the stalled subagent is marked;
// a subagent's own branch shows in its panel; a new tool call pops a note
// (and plays one with Sound on); feed strings never become HTML; the empty
// state and the unreachable banner show; the frame is not flat; no console
// errors.
//   npm ci && npx playwright install chromium && npm run smoke
const path = require("path");
const h = require("../vendor/agentviz-kit/tests/harness.cjs");

const REPO = path.resolve(__dirname, "..");
const PORT = Number(process.env.ORCHESTRA_TEST_PORT || 9129);
const READY = "window.__page && window.__page.polls > 0 && window.__orchestra.figs.size > 0";

function check(cond, message) { if (!cond) throw new Error(message); }
const drive = (page, t0, t1, step = 0.25) => page.evaluate(([a, b, s]) => {
  for (let t = a; t <= b + 1e-6; t += s) window.__strataKit.drive(t);
}, [t0, t1, step]);

async function checkScene(page) {
  const info = await page.evaluate(() => {
    const figs = [...window.__orchestra.figs.values()], doc = window.__page.doc;
    const live = doc.sessions.filter((s) => s.state !== "offline");
    return {
      have: {conductors: figs.filter((f) => f.kind === "conductor").length, empty: figs.filter((f) => f.kind === "empty").length,
        musicians: figs.filter((f) => f.kind === "musician").length, rugs: window.__orchestra.rugs.length},
      want: {conductors: live.length, empty: doc.sessions.length - live.length,
        musicians: live.reduce((n, s) => n + s.followers.length, 0), rugs: new Set(doc.sessions.map((s) => s.place)).size},
      waiting: doc.sessions.filter((s) => s.state === "waiting").map((s) => s.name),
      labels: document.querySelectorAll("#labels .av-label").length};
  });
  console.log("scene:", JSON.stringify(info));
  check(JSON.stringify(info.have) === JSON.stringify(info.want), "the stage does not hold every fixture agent");
  check(info.waiting.length === 2, "the fixture should have two sessions waiting");
  check(info.labels > 10, "world labels are missing");
  return info;
}

async function checkSoundOff(page) {
  const s = await page.evaluate(() => ({pressed: document.getElementById("sound").getAttribute("aria-pressed"),
    ctx: window.__page.band.ctx, on: window.__page.band.on}));
  check(s.pressed === "false" && s.ctx === null && !s.on, "sound must be off, with no AudioContext, by default");
}

const panelTitle = (page) => page.evaluate(() => {
  const panel = document.querySelector(".av-panel");
  return panel.hidden ? null : panel.querySelector("h2").textContent.trim();
});
const panelValues = (page) => page.evaluate(() => [...document.querySelectorAll(".av-panel dd")].map((d) => d.textContent));

async function checkWaitingChip(page, names) {
  const chip = page.locator(".av-wait");
  check(await chip.isVisible(), "the needs-you chip is hidden");
  check((await chip.locator("b").textContent()) === String(names.length), "the needs-you chip miscounts");
  const seen = [], reasons = [];
  for (let i = 0; i < names.length; i++) {
    await chip.click();
    seen.push(await panelTitle(page));
    reasons.push(await page.locator(".av-panel .av-needs").textContent());
  }
  console.log("needs-you chip cycles:", seen.join(" -> "), "/", reasons.join(", "));
  check(seen.slice().sort().join() === names.slice().sort().join(), "the chip did not cycle both waiting sessions");
  check(reasons.includes("has a question") && reasons.includes("needs permission"), "the panel does not say why each waits");
  const label = await page.evaluate(() => [...document.querySelectorAll(".av-label.lead.st-waiting")].map((e) => e.textContent));
  check(label.some((t) => t.endsWith("has a question")) && label.some((t) => t.endsWith("needs permission")),
    "the waiting labels do not say why: " + label.join(", "));
}

async function checkTap(page) {
  await page.evaluate(() => { window.__page.select(null); window.__page.fit(true); });
  await drive(page, 3, 3.25);  // project with the camera the tap will see
  const targets = await page.evaluate(() => window.__strataKit.targets());
  const t = targets.find((x) => x.id === "demo-solo") || targets[0];
  await page.mouse.click(t.x, t.y);
  await drive(page, 3.25, 3.5);
  const got = await page.evaluate(() => window.__page.selectedId);
  const want = await page.evaluate(([x, y]) => { const hit = window.__strataKit.pickAt(x, y); return typeof hit === "string" ? hit : hit && hit.id; }, [t.x, t.y]);
  console.log("tapped", got);
  const title = await panelTitle(page);
  check(got && got === want && title, "a tap did not select what a pick there returns: " + JSON.stringify([got, want, title]));
}

async function checkFollowers(page) {
  const ids = await page.evaluate(() => {
    const doc = window.__page.doc, key = (s, f) => s.id + "/" + f.id;
    const stalled = [], branched = [];
    for (const s of doc.sessions) for (const f of s.followers) {
      if (f.stalled) stalled.push(key(s, f));
      if (f.branch && f.branch !== s.branch) branched.push({id: key(s, f), branch: f.branch});
    }
    return {stalled, branched};
  });
  check(ids.stalled.length > 0 && ids.branched.length > 0, "the fixture should have a stalled and a branched subagent");
  await page.evaluate((id) => window.__page.select(id), ids.stalled[0]);
  const marked = await page.evaluate(() => ({label: document.querySelectorAll(".av-label.lane.stalled").length,
    chip: [...document.querySelectorAll(".av-panel .av-chip b")].some((b) => b.textContent === "stalled")}));
  check(marked.label === ids.stalled.length && marked.chip, "the stalled subagent is not marked: " + JSON.stringify(marked));
  const {id, branch} = ids.branched[0];
  await page.evaluate((x) => window.__page.select(x), id);
  check((await panelValues(page)).includes(branch), "the subagent panel does not show its own branch " + branch);
  console.log("stalled:", ids.stalled.join(), "/ branch:", branch);
}

// A new tool call (lastToolAt moves) pops a note within the spread window
// and, with Sound on, plays one.
async function checkCallNote(page) {
  await page.click("#sound");
  const result = await page.evaluate(async () => {
    const p = window.__page, band = p.band;
    for (let i = 0; i < 20 && band.ctx.state !== "running"; i++) await new Promise((r) => setTimeout(r, 50));
    let played = 0;
    const note = band.note.bind(band);
    band.note = (...args) => { if (note(...args)) played++; return true; };
    const doc = JSON.parse(JSON.stringify(p.doc)), solo = doc.sessions.find((s) => s.id === "demo-solo");
    solo.lastToolAt += 100;
    p.feed(doc);
    let peak = 0;
    for (let t = 4; t <= 6; t += 0.1) { window.__strataKit.drive(t); peak = Math.max(peak, p.stage.pulse("demo-solo", t)); }
    band.note = note;
    return {peak, played, label: document.querySelector("#sound").textContent};
  });
  console.log("call note:", JSON.stringify(result));
  check(result.peak > 0.5 && result.played >= 1 && result.label.includes("Sound off"), "a new tool call did not pop and play a note");
  await page.click("#sound");
  check(!(await page.evaluate(() => window.__page.band.on)), "Sound off did not disable audio");
}

async function checkTextOnly(page) {
  const result = await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__page.doc));
    doc.sessions.find((s) => s.id === "demo-lead-b").followers[0].label = "<img src=x id=pwned>";
    window.__page.feed(doc);
    window.__strataKit.drive(7);
    window.__page.select("demo-lead-b");
    return {img: !!document.getElementById("pwned"),
      lane: [...document.querySelectorAll(".av-panel .av-lanes button")].some((b) => b.textContent === "<img src=x id=pwned>"),
      label: [...document.querySelectorAll(".av-label.lane")].some((e) => e.textContent.endsWith("<img src=x id=pwned>"))};
  });
  check(!result.img && result.lane && result.label, "a feed label was parsed as HTML: " + JSON.stringify(result));
}

async function checkEmptyState(page) {
  const shown = await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__page.doc)), sessions = doc.sessions;
    window.__page.feed(Object.assign(doc, {sessions: []}));
    const visible = !document.querySelector(".av-empty").hidden;
    window.__page.feed(Object.assign(doc, {sessions}));
    return visible && document.querySelector(".av-empty").hidden;
  });
  check(shown, "no empty-state hint with zero sessions");
}

async function checkUnreachable(page) {
  await page.route("**/api/agents*", (route) => route.fulfill({status: 503, body: "down"}));
  await page.evaluate(async () => { await window.__page.pollOnce(); await window.__page.pollOnce(); });
  const banner = await page.evaluate(() => !document.querySelector(".av-banner").hidden && document.querySelector(".av-banner").textContent);
  console.log("banner:", banner);
  check(banner && banner.includes("HTTP 503"), "no unreachable banner after failed polls");
}

h.run("smoke", {repo: REPO, port: PORT}, async ({server, browser}) => {
  const {page, errors} = await h.open(browser, server.base + "/?fixture=1&drive=1", {ready: READY});
  await h.stillAnimations(page);
  await page.evaluate(() => window.__page.stopPolling());
  await drive(page, 0, 3);
  const info = await checkScene(page);
  await checkSoundOff(page);
  await checkWaitingChip(page, info.waiting);
  await checkTap(page);
  await checkFollowers(page);
  await checkCallNote(page);
  await checkTextOnly(page);
  await checkEmptyState(page);
  await page.evaluate(() => { window.__page.select(null); window.__page.fit(true); });
  await page.mouse.move(2, 400);
  await drive(page, 8, 8.5);
  const png = await h.shot(page, path.join(REPO, "docs/media/screenshot.png"));
  console.log("distinct colours:", await h.assertNotFlat(page, png));
  h.assertNoErrors(errors);
  await checkUnreachable(page);  // last: the failed fetches log console errors of their own
});
