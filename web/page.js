/* page.js: boots the orchestra. The feed client, HUD, labels and wire come
   from the agentviz kit (agentviz-*.js); this file wires them to the stage
   (orchestra-stage.js), the frame packer (orchestra-frame.js) and the opt-in
   sound (orchestra-audio.js), and owns the camera and the world labels. */
(function () {
  "use strict";
  const {seedOf, followerKey, smoothstep, lerp} = AgentvizFeed;
  const {KIND} = OrchestraStage;
  const FAMILY = {
    edit: {name: "Strings", verb: "editing", icon: "🎻"},
    run: {name: "Percussion", verb: "running", icon: "🥁"},
    read: {name: "Woodwinds", verb: "reading", icon: "🎷"},
    web: {name: "Brass", verb: "on the web", icon: "🎺"},
    delegate: {name: "Baton", verb: "directing subagents", icon: "🪄"},
    think: {name: "Pause", verb: "thinking", icon: "𝄐"},
    other: {name: "Bells", verb: "other tools", icon: "🔔"},
    none: {name: "Rest", verb: "resting", icon: "𝄽"},
  };
  const REASON = {question: "has a question", permission: "needs permission"};
  const CALL_SPREAD_SEC = 1.6;  // a snapshot's new calls play spread over this long, not as one chord
  const canvas = document.getElementById("view");
  const stage = new OrchestraStage();
  const wire = AgentvizWire.create();
  const labels = AgentvizScreen.labels(document.getElementById("labels"));
  const band = window.OrchestraBand;
  let kit = null, mod = null, feed = null, hud = null;
  let selectedId = null, hoveredId = null, sceneTime = 0, camAnim = null, userMoved = false;

  /* ------------------------------------------------------------ demo calls */
  // The fixture never changes, so on the demo feed every busy agent makes a
  // new tool call every few polls (lastToolAt / toolCount move, exactly as a
  // live feed's do): there is something to see and, with Sound on, to hear.
  function callsSoFar(id, poll) {
    const period = 2 + Math.floor(seedOf(id) * 3), offset = Math.floor(seedOf(id + "~") * period);
    return Math.floor((poll + offset) / period);
  }
  function demoCalls(doc, poll) {
    if (!doc.fixture) return doc;
    for (const s of doc.sessions || []) {
      if (s.state === "busy") {
        const n = callsSoFar(s.id, poll);
        s.lastToolAt = (s.lastToolAt || 0) + n;
        s.toolCount = (s.toolCount || 0) + n;
      }
      for (const f of s.followers || []) {
        if (f.state === "active") f.toolCount = (f.toolCount || 0) + callsSoFar(followerKey(s, f), poll);
      }
    }
    return doc;
  }

  function actionOf(fig) {
    if (fig.follower) return fig.follower.state === "active" ? fig.follower.action : "none";
    const s = fig.session;
    return s.action !== "none" ? s.action : (s.activity && s.activity.action) || "none";
  }

  function playCall(fig) {
    const action = actionOf(fig);
    band.note(action === "none" ? "other" : action, fig.follower ? fig.follower.seed : fig.session.seed);
  }

  /* ------------------------------------------------------------ camera */
  function fitView() {
    const b = stage.bounds, w = b.x1 - b.x0 + 6, d = b.z1 - b.z0 + 6;
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1), portrait = aspect < 0.8;
    // Portrait (a phone): look down more steeply so the stage's depth fills the height.
    const k = portrait ? 0.95 : 0.7;
    return {yaw: Math.PI / 2, pitch: portrait ? 1.25 : 0.8, tx: (b.x0 + b.x1) / 2, ty: 0.5, tz: (b.z0 + b.z1) / 2 + 1.2,
      dist: Math.min(Math.max(w * k / Math.min(aspect, 1.6) + 2, d * 1.15, 12), 110)};
  }
  function fit(instant) { userMoved = false; flyTo(fitView(), instant); }
  function flyTo(to, instant) {
    if (!kit) return;
    if (instant || kit.driven) { Object.assign(kit.cam, to); camAnim = null; return; }
    camAnim = {from: Object.assign({}, kit.cam), to, t0: performance.now(), ms: 700};
  }
  function stepCam() {
    if (!camAnim) return;
    const k = Math.min(1, (performance.now() - camAnim.t0) / camAnim.ms), e = smoothstep(k);
    for (const key of Object.keys(camAnim.to)) kit.cam[key] = lerp(camAnim.from[key], camAnim.to[key], e);
    if (k >= 1) camAnim = null;
  }
  function focusOn(id) {
    const f = stage.figs.get(id);
    if (!f) return;
    userMoved = true;
    flyTo({tx: f.target.x, ty: f.target.y + 0.8, tz: f.target.z + 1, dist: Math.min(kit.cam.dist, 16)});
  }

  /* ------------------------------------------------------------ labels */
  function conductorLabel(f) {
    const s = f.session, waiting = s.state === "waiting", sel = f.id === selectedId;
    const text = waiting ? (s.name || s.id) + " " + (REASON[s.waitingReason] || "needs you") : s.name || s.id.slice(0, 8);
    const cls = "lead st-" + s.state + (s.stalled ? " stalled" : "") + (sel ? " sel" : "");
    const el = labels.set("a:" + f.id, {cls, state: s.stalled ? "stalled" : s.state, text});
    el.style.setProperty("--accent", accentOf(s));
    const c = f.cur;
    return {el, q: kit.project(c.x, c.y + (f.kind === KIND.empty ? 1.5 : 2.4 + (waiting ? 1.0 : 0)), c.z),
      rank: waiting || sel ? 0 : (s.state === "offline" ? 2 : 1)};
  }
  function laneLabel(f) {
    const fl = f.follower, sel = f.id === selectedId, c = f.cur;
    const cls = "lane" + (fl.state === "active" ? "" : " rest") + (fl.stalled ? " stalled" : "") + (sel ? " sel" : "");
    const text = (FAMILY[actionOf(f)] || FAMILY.other).icon + " " + (fl.label || "subagent");
    const el = labels.set("a:" + f.id, {cls, state: fl.stalled ? "stalled" : null, text});
    const sx = c.x + (f.leadX - c.x) * 0.45, sz = c.z + (f.leadZ - c.z) * 0.45;
    return {el, q: kit.project(sx, c.y + 1.35, sz), rank: sel ? 0 : 4};
  }
  function placeLabels() {
    const items = [];
    labels.begin();
    for (const r of stage.rugs) {
      const el = labels.set("p:" + r.id, {cls: "place", text: r.label});
      items.push({el, q: kit.project((r.x0 + r.x1) / 2, r.y + 0.05, r.z1 - 0.15), rank: 3});
    }
    for (const f of stage.figs.values()) items.push(f.kind === KIND.musician ? laneLabel(f) : conductorLabel(f));
    labels.end();
    StrataKit.placeLabels(items);
  }
  function accentOf(s) { return `hsl(${Math.round((s.seed != null ? s.seed : seedOf(s.id)) % 1 * 360)} 70% 62%)`; }

  /* ------------------------------------------------------------ picking + selection */
  const HEIGHTS = {[KIND.conductor]: [1.0, 1.6], [KIND.musician]: [0.8, 1.2], [KIND.empty]: [0.5]};
  function pick(x, y, radius) {
    const candidates = [...stage.figs.values()].map((f) =>
      ({item: f, points: HEIGHTS[f.kind].map((dy) => [f.cur.x, f.cur.y + dy, f.cur.z])}));
    return AgentvizScreen.pick(kit.project, candidates, x, y, radius);
  }
  function screenTargets() {
    const r = canvas.getBoundingClientRect();
    return [...stage.figs.values()].map((f) => {
      const p = kit.project(f.cur.x, f.cur.y + HEIGHTS[f.kind][0], f.cur.z);
      return p && {id: f.id, x: p.x + r.left, y: p.y + r.top};
    }).filter(Boolean);
  }
  const targetOf = (f) => (f ? {session: f.session, follower: f.follower} : null);
  const idOf = (t) => (t ? (t.follower ? followerKey(t.session, t.follower) : t.session.id) : null);

  function onSelect(target, how) {
    selectedId = idOf(target);
    if (kit) kit.selected = (selectedId && stage.figs.get(selectedId)) || null;
    if (selectedId && (how === "waiting" || how === "list")) focusOn(selectedId);
  }

  // Extra panel rows: the instrument, and how long a musician has been quiet.
  function panelRows({session, follower}) {
    const fig = stage.figs.get(follower ? followerKey(session, follower) : session.id);
    const playing = follower ? follower.state === "active" : session.state === "busy";
    const fam = FAMILY[fig && playing ? actionOf(fig) : "none"] || FAMILY.other;
    const waiting = !follower && session.state === "waiting";
    const rows = [["instrument", waiting ? "put down: waiting on you" : fam.icon + " " + fam.name + " · " + fam.verb]];
    if (follower && follower.quietSec != null) rows.push(["quiet", Math.round(follower.quietSec) + " s"]);
    return rows;
  }

  /* ------------------------------------------------------------ sound button */
  function soundButton() {
    const button = document.createElement("button");
    const glyph = document.createElement("span"), word = document.createElement("span");
    button.type = "button";
    button.id = "sound";
    button.className = "av-chip av-sound";
    button.title = "Play a soft note for each tool call (off by default)";
    button.append(glyph, word);
    const show = () => {
      button.setAttribute("aria-pressed", String(band.on));
      glyph.textContent = band.on ? "🔊" : "🔈";
      word.textContent = band.on ? "Sound off" : "Sound on";
    };
    button.addEventListener("click", () => { if (band.on) band.disable(); else band.enable(); show(); });
    show();
    const bar = document.querySelector(".av-bar");
    bar.insertBefore(button, bar.lastElementChild);
    return button;
  }

  /* ------------------------------------------------------------ feed */
  function accept(doc, diff) {
    stage.update(doc);
    hud.update(doc);
    for (const id of diff.toolCalls) stage.call(id, sceneTime + seedOf(id + "@" + feed.polls) * CALL_SPREAD_SEC);
    if (!userMoved) fit(true);
  }

  /* ------------------------------------------------------------ boot */
  function frame(t) {
    sceneTime = t;
    stepCam();
    stage.step(t);
    const highlight = (id) => (id === selectedId ? 1 : id === hoveredId ? 2 : 0);
    OrchestraFrame.write(wire, stage, feed.doc, highlight, (id) => stage.pulse(id, t)).send(mod);
    band.tick(stage.anyWaiting > 0.5);
  }

  function createKit() {
    return StrataKit.create({
      module: mod, canvas,
      camera: {yaw: Math.PI / 2, pitch: 0.62, dist: 30, tx: 0, ty: 0.5, tz: -4},
      limits: {maxDist: 120, minDist: 4, maxPitch: 1.4},
      idleOrbit: false,
      frame,
      after: placeLabels,
      pick,
      idOf: (f) => f.id,
      onTap: (f) => hud.select(targetOf(f), "tap"),
      onHover(f) { hoveredId = f ? f.id : null; canvas.style.cursor = f ? "pointer" : ""; },
      onSlow: () => StrataLoader.slow(),
      onFatal: (code, msg) => StrataLoader.fallback(code, msg),
      targets: screenTargets,
    });
  }

  async function boot() {
    hud = AgentvizHud.create({title: "𝄞 Orchestra", legend: document.getElementById("legend"),
      buttons: [{icon: "home", label: "Recentre the view", onClick: () => fit(false)}], onSelect, rows: panelRows});
    soundButton();
    stage.onCall = (fig) => { if (band.on) playCall(fig); };
    try {
      mod = await StrataLoader.load({script: "orchestra-engine.js", factory: "createOrchestra",
        wasm: "orchestra-engine.wasm", title: "the orchestra"});
    } catch (error) {
      console.error("orchestra: the engine did not load", error);
      return;  // StrataLoader has already shown its fallback
    }
    try {
      kit = createKit();
    } catch (error) {
      StrataLoader.fallback(error.code === "no-webgl2" ? "no-webgl2" : "engine");
      return;
    }
    for (const ev of ["pointerdown", "wheel"]) canvas.addEventListener(ev, () => { userMoved = true; }, {passive: true});
    // Under ?drive=1 call notes follow scene time, so captures repeat.
    const now = () => (kit.driven ? sceneTime : Date.now() / 1000);
    feed = AgentvizFeed.create({onUpdate: accept, onStatus: hud.setStatus, transform: demoCalls, now});
    window.__orchestra = stage;
    window.__page = {kit, stage, hud, band, fit, flyTo, focusOn, FAMILY,
      select: (id, focus) => hud.select(targetOf(stage.figs.get(id)), focus ? "list" : "api"),
      hold: () => { userMoved = true; },
      get selectedId() { return selectedId; }, get doc() { return feed.doc; }, get polls() { return feed.polls; },
      stopPolling: () => feed.stop(), pollOnce: () => feed.pollOnce(), feed: (d) => feed.push(d)};
    feed.start();
    kit.start();
    if (kit.driven) kit.drive(0);
    StrataLoader.done();
    canvas.focus({preventScroll: true});
  }

  boot();
})();
