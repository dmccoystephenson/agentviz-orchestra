/* orchestra.js: Claude Code sessions as a concert stage.

   Reads /api/agents every 2 s (agentviz docs/FEED.md), lays the stage out
   (one ensemble per place, a conductor per session, its subagents as
   musicians fanned in front of its podium), eases every figure between
   snapshots, writes one row per figure into the Strata scene each frame,
   and runs labels, picking, the panel and the opt-in sound. */
(function () {
  "use strict";
  const q = new URLSearchParams(location.search);
  const FIXTURE = q.get("fixture") === "1";
  const FEED_URL = "/api/agents" + (FIXTURE ? "?fixture=1" : "");
  const POLL_MS = 2000;

  const STATE = {offline: 0, dim: 1, idle: 2, busy: 3, waiting: 4};
  const ACTION = {none: 0, edit: 1, run: 2, read: 3, web: 4, delegate: 5, think: 6, other: 7};
  const FAMILY = {
    edit: {name: "Strings", verb: "editing", icon: "🎻", color: "#c46a34"},
    run: {name: "Percussion", verb: "running", icon: "🥁", color: "#f28a2a"},
    read: {name: "Woodwinds", verb: "reading", icon: "🎷", color: "#46b96c"},
    web: {name: "Brass", verb: "on the web", icon: "🎺", color: "#f7cf4a"},
    delegate: {name: "Baton", verb: "directing subagents", icon: "🪄", color: "#eef0f8"},
    think: {name: "Pause", verb: "thinking", icon: "𝄐", color: "#a98cf2"},
    other: {name: "Bells", verb: "other tools", icon: "🔔", color: "#73b2e6"},
    none: {name: "Rest", verb: "resting", icon: "𝄽", color: "#8a8a90"},
  };
  const STATE_INFO = {
    busy: {icon: "▶", text: "playing"},
    idle: {icon: "⏸", text: "idle"},
    waiting: {icon: "✋", text: "needs you"},
    offline: {icon: "⏹", text: "offline"},
    dim: {icon: "·", text: "dim"},
    active: {icon: "▶", text: "playing"},
    resting: {icon: "𝄽", text: "resting"},
  };
  const FIG_STRIDE = 16, PLACE_STRIDE = 8;

  const seedOf = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  };

  /* ------------------------------------------------------------ layout */
  // Stage coordinates: the audience is at +z, upstage is -z, the front row of
  // ensembles stands at z = 0 and each further row is a step up on a riser.
  function layout(doc) {
    const sessions = doc.sessions || [];
    const order = (doc.places || []).map((p) => p.id);
    for (const s of sessions) if (!order.includes(s.place)) order.push(s.place);
    const placeLabel = {};
    for (const p of doc.places || []) placeLabel[p.id] = p.label || p.id;
    const blocks = [];
    for (const pid of order) {
      const members = sessions.filter((s) => s.place === pid);
      if (!members.length) continue;
      const groups = members.map((s) => {
        const n = s.state === "offline" ? 0 : (s.followers || []).length;
        const fanR = n ? Math.max(2.4, 1.4 + n * 0.42) : 0;
        const w = n ? 2 * fanR + 1.6 : (s.state === "offline" ? 2.6 : 3.6);
        const d = n ? fanR + 3.0 : 3.4;
        return {s, n, fanR, w, d};
      });
      const w = groups.reduce((a, g) => a + g.w, 0) + 0.6;
      const d = Math.max(...groups.map((g) => g.d)) + 0.4;
      blocks.push({id: pid, label: placeLabel[pid] || pid, groups, w, d,
        seed: ((doc.places || []).find((p) => p.id === pid) || {}).seed ?? seedOf(pid)});
    }
    const area = blocks.reduce((a, b) => a + b.w * b.d, 0);
    const maxRow = Math.max(18, ...blocks.map((b) => b.w), Math.sqrt(area) * 1.5);
    const rows = [];
    for (const b of blocks) {
      let row = rows[rows.length - 1];
      if (!row || row.w + b.w > maxRow) { row = {blocks: [], w: 0, d: 0}; rows.push(row); }
      row.blocks.push(b);
      row.w += b.w;
      row.d = Math.max(row.d, b.d);
    }
    const figs = [], rugs = [];
    let zFront = 0, minX = -6, maxX = 6;
    rows.forEach((row, ri) => {
      const y = ri * 0.45;
      let x = -row.w / 2;
      for (const b of row.blocks) {
        rugs.push({id: b.id, label: b.label, x0: x, x1: x + b.w, z0: zFront - b.d, z1: zFront, y, seed: b.seed,
          waiting: b.groups.some((g) => g.s.state === "waiting") ? 1 : 0,
          busy: b.groups.some((g) => g.s.state === "busy") ? 1 : 0});
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + b.w);
        let gx = x + 0.3;
        for (const g of b.groups) {
          const s = g.s, px = gx + g.w / 2, pz = zFront - 1.6;
          if (s.state === "offline") {
            figs.push({id: s.id, kind: 2, session: s, x: px, y, z: pz, dx: 0, dz: -1});
          } else {
            figs.push({id: s.id, kind: 0, session: s, x: px, y, z: pz, dx: 0, dz: -1,
              soloX: px + 1.35, soloZ: pz + 0.95});
            const fl = s.followers || [];
            fl.forEach((f, i) => {
              const a = fl.length === 1 ? 0 : (-70 + 140 * i / (fl.length - 1)) * Math.PI / 180;
              const mx = px + g.fanR * Math.sin(a), mz = pz - g.fanR * Math.cos(a);
              const vx = px - mx, vz = pz - mz, len = Math.hypot(vx, vz) || 1;
              figs.push({id: s.id + "/" + f.id, kind: 1, session: s, follower: f, x: mx, y, z: mz,
                dx: vx / len, dz: vz / len, tx: px, tz: pz});
            });
          }
          gx += g.w;
        }
        x += b.w;
      }
      zFront -= row.d;
    });
    const stage = {x0: minX, z0: zFront, x1: maxX, z1: 0};
    // The owner's seat: front row of the house, centre, on the seat grid the scene draws.
    const base = minX - 4 - 2;
    const owner = {x: base + Math.round(-base), z: 0 + 3 + 3};
    return {figs, rugs, stage, owner};
  }

  /* ----------------------------------------------------------- the model */
  const model = {
    doc: null, figs: new Map(), rugs: [], stage: {x0: -10, z0: -10, x1: 10, z1: 0}, owner: {x: 0, z: 6},
    anyWaiting: 0, snapAt: 0,
  };
  let lastT = null, selectedId = null, fitted = false, userMoved = false;

  function applyDoc(doc) {
    const prev = model.doc;
    model.doc = doc;
    model.snapAt = performance.now();
    const L = layout(doc);
    const seen = new Set();
    for (const f of L.figs) {
      seen.add(f.id);
      const s = f.session, waiting = s.state === "waiting";
      if (f.kind === 0 && waiting) {  // turn to the audience: face the owner's seat
        const vx = L.owner.x - f.x, vz = L.owner.z - f.z, len = Math.hypot(vx, vz) || 1;
        f.dx = vx / len; f.dz = vz / len;
      }
      let cur = model.figs.get(f.id);
      if (!cur || cur.kind !== f.kind) {
        cur = {cur: {x: f.x, y: f.y, z: f.z, dx: f.dx, dz: f.dz, up: 0, wait: 0}};
        model.figs.set(f.id, cur);
      }
      Object.assign(cur, f, {target: {x: f.x, y: f.y, z: f.z, dx: f.dx, dz: f.dz}});
    }
    for (const id of [...model.figs.keys()]) if (!seen.has(id)) model.figs.delete(id);
    model.rugs = L.rugs;
    model.stage = L.stage;
    model.owner = L.owner;
    detectCalls(prev, doc);
    updateHud(doc);
    if (selectedId && !model.figs.has(selectedId)) select(null);
    else if (selectedId) renderPanel();
    if (!fitted || !userMoved) fitCamera();
  }

  /* ---------------------------------------------------- sound: new calls */
  const lastCall = new Map();
  function detectCalls(prev, doc) {
    const band = window.OrchestraBand;
    if (!band || !band.on || !prev) return;
    const prevById = new Map((prev.sessions || []).map((s) => [s.id, s]));
    const dt = (doc.serverTime || 0) - (prev.serverTime || 0);
    for (const s of doc.sessions || []) {
      const p = prevById.get(s.id);
      if (!p) continue;
      const a = s.activity, pa = p.activity;
      if (a && (!pa || a.tool !== pa.tool || a.label !== pa.label || a.ageSec + 1 < pa.ageSec + dt))
        band.note(a.action || "other", s.seed);
      const pf = new Map((p.followers || []).map((f) => [f.id, f]));
      for (const f of s.followers || []) {
        const o = pf.get(f.id);
        if (o && f.toolCount > o.toolCount) band.note(f.action === "none" ? "other" : f.action, f.seed);
      }
    }
  }
  // The fixture never changes, so in demo mode the busy ones "call" on their own beat.
  function demoCalls(t) {
    const band = window.OrchestraBand;
    if (!FIXTURE || !band || !band.on) return;
    for (const f of model.figs.values()) {
      const s = f.session, fl = f.follower;
      const busy = fl ? fl.state === "active" && fl.action !== "none" : s.state === "busy";
      if (!busy || f.kind === 2) continue;
      const period = 5 + 4 * seedOf(f.id), phase = seedOf(f.id + "p") * period;
      const beat = Math.floor((t + phase) / period);
      if (lastCall.get(f.id) == null) { lastCall.set(f.id, beat); continue; }
      if (beat !== lastCall.get(f.id)) {
        lastCall.set(f.id, beat);
        band.note(fl ? fl.action : s.action, fl ? (fl.seed ?? seedOf(fl.id)) : s.seed);
      }
    }
  }

  /* ----------------------------------------------------------- per frame */
  const ease = (a, b, k) => a + (b - a) * k;
  let figPtr = 0, figCap = 0, placePtr = 0, placeCap = 0;

  function codes(f) {
    const s = f.session;
    if (f.kind === 1) {
      const fl = f.follower;
      const active = fl.state === "active" && fl.action !== "none" && s.state !== "offline";
      return {state: active ? 3 : 2, action: ACTION[fl.action] || 0, up: active ? 1 : 0, wait: 0,
        stalled: 0, seed: fl.seed ?? seedOf(fl.id)};
    }
    const st = STATE[s.state] ?? 1;
    const act = ACTION[s.action] || 0;
    const plays = s.state === "busy" && ["edit", "run", "read", "web", "other"].includes(s.action);
    return {state: st, action: act, up: plays ? 1 : 0, wait: s.state === "waiting" ? 1 : 0,
      stalled: s.stalled ? 1 : 0, seed: s.seed ?? seedOf(s.id)};
  }

  function writeFrame(mod, t) {
    const dt = lastT == null ? 0 : Math.min(Math.max(t - lastT, 0), 0.25);
    lastT = t;
    const kPos = 1 - Math.exp(-dt * 3), kUp = 1 - Math.exp(-dt * 5), kWait = 1 - Math.exp(-dt * 14);
    const figs = [...model.figs.values()];
    const n = figs.length;
    if (n * FIG_STRIDE > figCap) {
      if (figPtr) mod._free(figPtr);
      figCap = (n + 16) * FIG_STRIDE;
      figPtr = mod._malloc(figCap * 4);
    }
    const heap = mod.HEAPF32;
    let base = figPtr >> 2, anyWait = 0;
    for (const f of figs) {
      const c = f.cur, tg = f.target, k = codes(f);
      c.x = ease(c.x, tg.x, kPos); c.y = ease(c.y, tg.y, kPos); c.z = ease(c.z, tg.z, kPos);
      c.dx = ease(c.dx, tg.dx, kWait); c.dz = ease(c.dz, tg.dz, kWait);
      const dl = Math.hypot(c.dx, c.dz) || 1;
      c.up = ease(c.up, k.up, kUp);
      c.wait = ease(c.wait, k.wait, kWait);
      anyWait = Math.max(anyWait, c.wait);
      const placeSeed = f.session.seed ?? seedOf(f.session.id);
      heap.set([f.kind, c.x, c.y, c.z, c.dx / dl, c.dz / dl, k.state, k.action, k.seed,
        f.id === selectedId ? 1 : 0, c.up, c.wait, k.stalled, placeSeed,
        f.kind === 1 ? f.tx : (f.soloX || 0), f.kind === 1 ? f.tz : (f.soloZ || 0)], base);
      base += FIG_STRIDE;
    }
    mod._orc_set_figures(figPtr, n);
    const r = model.rugs;
    if (r.length * PLACE_STRIDE > placeCap) {
      if (placePtr) mod._free(placePtr);
      placeCap = (r.length + 8) * PLACE_STRIDE;
      placePtr = mod._malloc(placeCap * 4);
    }
    r.forEach((p, i) => heap.set([p.x0, p.z0, p.x1, p.z1, p.y, p.seed, p.waiting, p.busy],
      (placePtr >> 2) + i * PLACE_STRIDE));
    mod._orc_set_places(placePtr, r.length);
    model.anyWaiting = anyWait;
    const S = model.stage;
    mod._orc_set_stage(S.x0, S.z0, S.x1, S.z1, model.owner.x, model.owner.z, anyWait);
    if (window.OrchestraBand) window.OrchestraBand.tick(anyWait > 0.5);
    demoCalls(t);
  }

  /* ------------------------------------------------------------- labels */
  const labelLayer = document.getElementById("labels");
  const labelEls = new Map();
  function labelEl(key, cls) {
    let el = labelEls.get(key);
    if (!el) {
      el = document.createElement("div");
      labelLayer.appendChild(el);
      labelEls.set(key, el);
    }
    el.className = "label " + cls;
    el._used = true;
    return el;
  }
  function placeAllLabels(kit) {
    for (const el of labelEls.values()) el._used = false;
    const items = [];
    for (const r of model.rugs) {
      const el = labelEl("place:" + r.id, "lbl-place");
      if (el.textContent !== r.label) el.textContent = r.label;
      items.push({el, q: kit.project((r.x0 + r.x1) / 2, r.y + 0.05, r.z1 - 0.15), rank: 3});
    }
    for (const f of model.figs.values()) {
      const c = f.cur, s = f.session;
      if (f.kind === 1) {
        const el = labelEl("fig:" + f.id, "lbl-lane" + (f.follower.state === "active" ? "" : " rest") +
          (f.id === selectedId ? " sel" : ""));
        const txt = (FAMILY[f.follower.action] || FAMILY.other).icon + " " + (f.follower.label || "subagent");
        if (el.textContent !== txt) el.textContent = txt;
        const sx = c.x + (f.tx - c.x) * 0.45, sz = c.z + (f.tz - c.z) * 0.45;
        items.push({el, q: kit.project(sx, c.y + 1.35, sz), rank: f.id === selectedId ? 0 : 4});
      } else {
        const waiting = s.state === "waiting";
        const el = labelEl("fig:" + f.id, "lbl-conductor st-" + s.state + (s.stalled ? " stalled" : "") +
          (f.id === selectedId ? " sel" : ""));
        const txt = (waiting ? "✋ " : "") + (s.name || s.id.slice(0, 8));
        if (el.textContent !== txt) el.textContent = txt;
        el.style.setProperty("--accent", accentOf(s));
        items.push({el, q: kit.project(c.x, c.y + (f.kind === 2 ? 1.5 : 2.4), c.z),
          rank: waiting || f.id === selectedId ? 0 : (s.state === "offline" ? 2 : 1)});
      }
    }
    for (const [key, el] of labelEls) if (!el._used) { el.remove(); labelEls.delete(key); }
    StrataKit.placeLabels(items);
  }
  function accentOf(s) {
    const h = Math.round(((s.seed ?? seedOf(s.id)) % 1) * 360);
    return `hsl(${h} 70% 62%)`;
  }

  /* ------------------------------------------------------------ picking */
  function pickAt(kit, x, y, radius) {
    let best = null, bestD = radius * radius;
    for (const f of model.figs.values()) {
      const c = f.cur;
      const pts = f.kind === 0 ? [1.0, 1.6] : (f.kind === 1 ? [0.8, 1.2] : [0.5]);
      for (const h of pts) {
        const p = kit.project(c.x, c.y + h, c.z);
        if (!p) continue;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) { bestD = d; best = f; }
      }
    }
    return best;
  }

  /* -------------------------------------------------------------- panel */
  const panel = document.getElementById("panel");
  function select(id) {
    selectedId = id;
    if (window.__orchestra.kit) window.__orchestra.kit.selected = id;
    renderPanel();
  }
  function chip(state) {
    const i = STATE_INFO[state] || STATE_INFO.dim;
    return `<span class="chip st-${state}">${i.icon} ${i.text}</span>`;
  }
  function famRow(action, label) {
    const fam = FAMILY[action] || FAMILY.other;
    return `<div class="fam"><span class="fam-icon" style="--fam:${fam.color}">${fam.icon}</span>` +
      `<span><b>${fam.name}</b> · ${fam.verb}${label ? `<br><span class="muted">${esc(label)}</span>` : ""}</span></div>`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  function renderPanel() {
    const f = selectedId && model.figs.get(selectedId);
    if (!f) { panel.hidden = true; document.body.classList.remove("sheet-open"); return; }
    const s = f.session;
    let html = `<button class="close" aria-label="Close" data-close>×</button>`;
    if (f.kind === 1) {
      const fl = f.follower;
      html += `<div class="who"><span class="dot" style="background:${accentOf(s)}"></span>` +
        `<div><div class="name">${esc(fl.label || "subagent")}</div>` +
        `<div class="muted">musician in <a href="#" data-sel="${esc(s.id)}">${esc(s.name || s.id)}</a>'s ensemble</div></div></div>` +
        `<div class="row">${chip(fl.state)}<span class="muted">${fl.toolCount ?? 0} calls · quiet ${Math.round(fl.quietSec ?? 0)} s</span></div>` +
        famRow(fl.state === "active" ? fl.action : "none", fl.toolLabel || fl.tool);
    } else {
      const a = s.activity || {};
      html += `<div class="who"><span class="dot" style="background:${accentOf(s)}"></span>` +
        `<div><div class="name">${esc(s.name || s.id)}</div><div class="muted">conductor · ${esc(s.placeLabel || s.place || "")}` +
        `${s.branch ? ` · <span class="branch">⎇ ${esc(s.branch)}</span>` : ""}</div></div></div>` +
        `<div class="row">${chip(s.state)}${s.stalled ? `<span class="chip st-stalled">✖ stalled</span>` : ""}</div>` +
        (s.state === "waiting" ? famRow(a.action || "none", "last call: " + (a.label || a.tool || "?"))
          : famRow(s.state === "busy" ? (s.action === "none" ? a.action || "none" : s.action) : "none", a.label || a.tool));
      if (s.state === "waiting") html += `<div class="needs">✋ Waiting on you: a prompt or question in this session.</div>`;
      const fl = s.followers || [];
      if (fl.length) {
        html += `<div class="muted small">${fl.length} musician${fl.length > 1 ? "s" : ""}</div><ul class="followers">` +
          fl.map((x) => {
            const fam = FAMILY[x.state === "active" ? x.action : "none"] || FAMILY.other;
            return `<li><button data-sel="${esc(s.id + "/" + x.id)}"><span class="fam-icon sm" style="--fam:${fam.color}">${fam.icon}</span>` +
              `<span class="lane">${esc(x.label || "subagent")}</span><span class="muted">${(STATE_INFO[x.state] || {}).text || x.state}</span></button></li>`;
          }).join("") + `</ul>`;
      }
    }
    panel.innerHTML = html;
    panel.hidden = false;
    document.body.classList.add("sheet-open");
  }
  panel.addEventListener("click", (e) => {
    const t = e.target.closest("[data-sel],[data-close]");
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute("data-close")) select(null);
    else select(t.getAttribute("data-sel"));
  });

  /* ---------------------------------------------------------------- HUD */
  function updateHud(doc) {
    const c = doc.counts || {};
    const set = (id, n) => {
      const el = document.getElementById(id);
      el.querySelector("b").textContent = n || 0;
      el.hidden = !n;
    };
    set("c-busy", c.busy); set("c-idle", c.idle); set("c-offline", c.offline);
    set("c-waiting", c.waiting); set("c-musicians", c.activeFollowers);
    document.getElementById("demo").hidden = !doc.fixture;
    document.getElementById("empty").hidden = (doc.sessions || []).length > 0;
  }
  document.getElementById("c-waiting").addEventListener("click", () => {
    const w = (model.doc && model.doc.sessions || []).find((s) => s.state === "waiting");
    if (w) { select(w.id); focusOn(w.id); }
  });
  const soundBtn = document.getElementById("sound");
  soundBtn.addEventListener("click", () => {
    const band = window.OrchestraBand;
    if (band.on) band.disable(); else band.enable();
    soundBtn.setAttribute("aria-pressed", band.on ? "true" : "false");
    soundBtn.querySelector("span").textContent = band.on ? "Sound off" : "Sound on";
    soundBtn.querySelector("i").textContent = band.on ? "🔊" : "🔈";
  });
  document.getElementById("legend-btn").addEventListener("click", () => {
    const l = document.getElementById("legend");
    l.hidden = !l.hidden;
    document.getElementById("legend-btn").setAttribute("aria-expanded", String(!l.hidden));
  });

  /* ------------------------------------------------------------- camera */
  let kitRef = null;
  function fitCamera() {
    if (!kitRef) return;
    const S = model.stage, cam = kitRef.cam;
    const w = S.x1 - S.x0 + 6, d = S.z1 - S.z0 + 6;
    const aspect = kitRef.canvas.clientWidth / Math.max(kitRef.canvas.clientHeight, 1);
    cam.tx = (S.x0 + S.x1) / 2; cam.ty = 0.5; cam.tz = (S.z0 + S.z1) / 2 + 0.5;
    cam.yaw = Math.PI / 2;
    // Portrait (a phone): look down more steeply so the stage's depth fills the height.
    cam.pitch = aspect < 0.8 ? 1.05 : 0.78;
    const k = aspect < 0.8 ? 0.62 : 0.78;
    cam.dist = Math.min(Math.max(w * k / Math.min(aspect, 1.6) + 2, d * 1.15, 12), 110);
    fitted = true;
  }
  function focusOn(id) {
    const f = model.figs.get(id);
    if (!f || !kitRef) return;
    const cam = kitRef.cam;
    cam.tx = f.target.x; cam.ty = f.target.y + 0.8; cam.tz = f.target.z + 1;
    cam.dist = Math.min(cam.dist, 16);
    userMoved = true;
  }

  /* --------------------------------------------------------------- feed */
  async function poll() {
    try {
      const r = await fetch(FEED_URL, {cache: "no-store"});
      if (r.ok) applyDoc(await r.json());
      document.body.classList.toggle("feed-down", !r.ok);
    } catch (e) {
      document.body.classList.add("feed-down");
    }
  }

  /* --------------------------------------------------------------- boot */
  window.__orchestra = {model, select, focusOn, fitCamera, poll: () => poll(), hold: () => { userMoved = true; }, kit: null, ready: false, FAMILY,
    get selectedId() { return selectedId; }};

  (async () => {
    let mod;
    try {
      mod = await StrataLoader.load({script: "orchestra-engine.js", factory: "createOrchestra",
        wasm: "orchestra-engine.wasm", title: "the orchestra"});
    } catch (e) { return; }
    const canvas = document.getElementById("view");
    let kit;
    try {
      kit = StrataKit.create({
        module: mod, canvas,
        camera: {yaw: Math.PI / 2, pitch: 0.62, dist: 30, tx: 0, ty: 0.5, tz: -4},
        limits: {maxDist: 120, minDist: 4, maxPitch: 1.4},
        idleOrbit: false,
        frame(t) { writeFrame(mod, t); },
        after() { placeAllLabels(kit); },
        pick: (x, y, r) => pickAt(kit, x, y, r),
        idOf: (f) => f.id,
        onTap(f) { select(f ? f.id : null); },
        targets: () => {
          const r = canvas.getBoundingClientRect();
          return [...model.figs.values()].map((f) => {
            const p = kit.project(f.cur.x, f.cur.y + (f.kind === 0 ? 1.0 : (f.kind === 1 ? 0.8 : 0.5)), f.cur.z);
            return p && {id: f.id, x: p.x + r.left, y: p.y + r.top};
          }).filter(Boolean);
        },
        onSlow: () => StrataLoader.slow(),
        onFatal: (code, msg) => StrataLoader.fallback(code, msg),
      });
    } catch (e) {
      return StrataLoader.fallback(e.code === "no-webgl2" ? "no-webgl2" : "engine");
    }
    kitRef = kit;
    window.__orchestra.kit = kit;
    for (const ev of ["pointerdown", "wheel"]) canvas.addEventListener(ev, () => { userMoved = true; }, {passive: true});
    await poll();
    setInterval(poll, POLL_MS);
    kit.start();
    if (kit.driven) kit.drive(0);
    StrataLoader.done();
    window.__orchestra.ready = true;
    canvas.focus({preventScroll: true});
  })();
})();
