// Headless smoke test: serve the fixture, load /?fixture=1, wait for the kit
// to draw, check the scene, a tap selecting an agent and no console errors,
// and save docs/media/screenshot.png.
//   NODE_PATH=/root/arcade-watch/node_modules node tests/smoke.cjs
const path = require("path");
const {repo, serve, launch, open, settle} = require("./harness.cjs");

(async () => {
  const server = await serve();
  const browser = await launch();
  const errors = [];
  let failed = null;
  try {
    const page = await open(browser, {errors});
    await settle(page);
    const info = await page.evaluate(() => {
      const figs = [...window.__orchestra.model.figs.values()];
      return {conductors: figs.filter((f) => f.kind === 0).length, musicians: figs.filter((f) => f.kind === 1).length,
        empty: figs.filter((f) => f.kind === 2).length, labels: document.querySelectorAll("#labels .label").length,
        waitingChip: !document.getElementById("c-waiting").hidden,
        soundPressed: document.getElementById("sound").getAttribute("aria-pressed"),
        audio: !!(window.OrchestraBand && window.OrchestraBand.ctx)};
    });
    console.log("scene:", JSON.stringify(info));
    if (info.conductors !== 6 || info.musicians !== 11 || info.empty !== 2)
      throw new Error("expected 6 conductors, 11 musicians, 2 empty chairs");
    if (!info.waitingChip) throw new Error("the waiting chip is hidden");
    if (info.soundPressed !== "false" || info.audio) throw new Error("sound must be off by default");
    // The frame is not one flat colour.
        const flat = await page.evaluate(() => {
      const c = document.getElementById("view"), g = document.createElement("canvas");
      g.width = 64; g.height = 64;
      const x = g.getContext("2d");
      x.drawImage(c, 0, 0, 64, 64);
      const d = x.getImageData(0, 0, 64, 64).data, seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
      return seen.size;
    });
    if (flat < 20) throw new Error("the frame looks flat: " + flat + " colours");
    // A tap at a target selects exactly what a pick there returns, and opens the panel.
    const targets = await page.evaluate(() => window.__strataKit.targets());
    const t = targets.find((x) => x.id === "demo-waiting") || targets[0];
    await page.mouse.click(t.x, t.y);
    await settle(page, 3.25, 3.5);
    const sel = await page.evaluate(() => ({id: window.__orchestra.selectedId, panel: !document.getElementById("panel").hidden,
      text: document.getElementById("panel").textContent}));
    const want = await page.evaluate(([x, y]) => { const h = window.__strataKit.pickAt(x, y); return typeof h === "string" ? h : h && h.id; }, [t.x, t.y]);
    if (!sel.id || sel.id !== want || !sel.panel) throw new Error("tap did not select: " + JSON.stringify(sel) + " want " + want);
    console.log("tapped", sel.id);
    // Sound: off until the button, then a note plays and the button reads "Sound off".
    await page.click("#sound");
    const audio = await page.evaluate(async () => {
      const b = window.OrchestraBand;
      for (let i = 0; i < 20 && b.ctx.state !== "running"; i++) await new Promise((r) => setTimeout(r, 50));
      return {on: b.on, state: b.ctx.state, note: b.note("edit", 0.3), label: document.querySelector("#sound span").textContent};
    });
    console.log("audio:", JSON.stringify(audio));
    if (!audio.on || !audio.note || audio.label !== "Sound off") throw new Error("Sound on did not enable audio");
    await page.click("#sound");
    if (await page.evaluate(() => window.OrchestraBand.on)) throw new Error("Sound off did not disable audio");
    await page.evaluate(() => window.__orchestra.select(null));
    await settle(page, 3.75, 4);
    await page.screenshot({path: path.join(repo, "docs/media/screenshot.png"), timeout: 600000, animations: "disabled"});
    if (errors.length) throw new Error("console errors:\n" + errors.join("\n"));
    console.log("smoke: PASS");
  } catch (e) {
    failed = e;
  } finally {
    await browser.close();
    server.kill();
  }
  if (failed) { console.error("smoke: FAIL", failed.message); process.exit(1); }
})();
