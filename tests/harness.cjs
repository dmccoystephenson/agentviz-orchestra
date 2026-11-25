// Shared by smoke.cjs and screenshots.cjs: serve the FIXTURE feed on a test
// port, launch headless Chromium (SwiftShader) and open the page driven.
const {spawn} = require("child_process");
const path = require("path");

function playwright() {
  const tries = [null, "/root/arcade-watch/node_modules", "/root/casework/node_modules"];
  for (const base of tries) {
    try { return base ? require(path.join(base, "playwright")) : require("playwright"); } catch (e) { /* next */ }
  }
  throw new Error("playwright not found: set NODE_PATH to a node_modules that has it");
}

const repo = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8949);

function serve() {
  const p = spawn("python3", ["-m", "vendor.agentfeed", "serve", "--web", "web", "--port", String(port), "--fixture"],
    {cwd: repo, stdio: ["ignore", "pipe", "inherit"]});
  return new Promise((resolve, reject) => {
    p.stdout.on("data", (d) => { if (String(d).includes("serving")) resolve(p); });
    p.on("exit", (c) => reject(new Error("server exited " + c)));
  });
}

async function launch() {
  const {chromium} = playwright();
  return chromium.launch({args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist"]});
}

// Opens /?fixture=1&drive=1 and waits for the scene; returns the page.
async function open(browser, {viewport = {width: 1280, height: 760}, dpr = 1, touch = false, errors = []} = {}) {
  const ctx = await browser.newContext({viewport, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch});
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/?fixture=1&drive=1`, {waitUntil: "commit"});
  await page.waitForFunction(() => window.__orchestra && window.__orchestra.ready && window.__strataKit &&
    window.__strataKit.ready, null, {timeout: 180000});
  return page;
}

// Draw scene time t0..t1 in steps so the easing settles, then return.
async function settle(page, t0 = 0, t1 = 3, step = 0.25) {
  await page.evaluate(([a, b, s]) => { for (let t = a; t <= b + 1e-6; t += s) window.__strataKit.drive(t); },
    [t0, t1, step]);
}

module.exports = {repo, port, serve, launch, open, settle};
