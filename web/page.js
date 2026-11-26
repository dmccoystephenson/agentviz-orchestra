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
  // The engine's camera maths (Strata kit sk_frame) comes from the agentviz
  // kit, so a view can be fitted before it is drawn; window.__page.projectWith
  // lets a test compare it with kit.project.
  const {projectWith, fitPoints} = AgentvizScreen;

  // The part of the canvas nothing covers: below the top bar and, with
  // `panel`, above the bottom sheet (phone) or right of the card (desktop).
  function freeRect(panel) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const bar = document.querySelector(".av-bar");
    const r = {x0: 8, y0: (bar ? bar.getBoundingClientRect().bottom : 0) + 8, x1: W - 8, y1: H - 8, W, H};
    const p = panel && hud && hud.panel;
    if (p && !p.hidden) {
      if (p.offsetWidth >= W - 40) r.y1 = Math.min(r.y1, H - p.offsetHeight - 8);
      else r.x0 = Math.max(r.x0, p.offsetLeft + p.offsetWidth + 8);
    }
    return r;
  }

  // The whole stage (every rug, its risers and the figures on the back row)
  // as large as it fits below the top bar, on phones and desktops alike. A
  // portrait screen looks down steeply and, when the stage is wider than it
  // is deep, from the wings, so the stage's long side runs up the screen.
  function fitView() {
    const fr = freeRect(false), portrait = fr.W / Math.max(fr.H, 1) < 0.8;
    const front = fitFrom(Math.PI / 2, portrait ? 1.2 : 0.8, fr);
    if (!portrait) return front;
    const wings = fitFrom(0, 1.2, fr);
    return wings.dist < front.dist * 0.85 ? wings : front;
  }
  function fitFrom(yaw, pitch, fr) {
    const b = stage.bounds;
    const top = stage.rugs.reduce((m, r) => Math.max(m, r.y), 0);
    const pts = [[b.x0, 0, b.z1 + 0.6], [b.x1, 0, b.z1 + 0.6], [b.x0, top, b.z0], [b.x1, top, b.z0],
      [b.x0, top + 2.6, b.z0 + 1.5], [b.x1, top + 2.6, b.z0 + 1.5]];
    const mid = [(b.x0 + b.x1) / 2, top / 2, (b.z0 + b.z1) / 2];
    const c = {yaw, pitch, dist: 40, tx: mid[0], ty: 0.5, tz: mid[2]};
    return fitPoints(c, pts, fr, {mid, minDist: 10, maxDist: 110, inset: 16, iterations: 30});
  }
  let lastFit = null;
  function fit(instant) { userMoved = false; lastFit = fitView(); flyTo(lastFit, instant); }
  // A turned phone or a resized window refits, unless the view was moved since.
  function refitOnResize() {
    const c = kit && kit.cam;
    if (!c || !lastFit || camAnim || userMoved) return;
    fit(true);
  }
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
  // Brings a figure into the clear part of the screen, above the bottom sheet
  // or beside the card. With `zoom` it also moves in close; otherwise the
  // camera only slides, and only when the figure is covered or off screen.
  function reveal(id, zoom) {
    const f = stage.figs.get(id);
    if (!f || !kit) return;
    userMoved = true;
    const fr = freeRect(true), base = camAnim ? camAnim.to : kit.cam;
    const p = f.target, pad = {top: 66, right: 36, bottom: 36, left: 36};
    const to = AgentvizScreen.reveal(base, [p.x, p.y + 1.0, p.z], fr,
      zoom ? {set: {dist: Math.min(base.dist, 16)}, force: true, pad, dy: 16} : {pad, dy: 16});
    if (to) flyTo(to);
  }
  const focusOn = (id) => reveal(id, true);

  /* ------------------------------------------------------------ labels */
  // A busy conductor's label leads with its instrument, so "who is doing
  // what" reads from the labels alone; a stalled one says so in red.
  function conductorLabel(f) {
    const s = f.session, waiting = s.state === "waiting", sel = f.id === selectedId;
    const stalled = !!s.stalled && !waiting, name = s.name || s.id.slice(0, 8);
    const fam = s.state === "busy" && FAMILY[actionOf(f)];
    const text = waiting ? name + " " + (REASON[s.waitingReason] || "needs you")
      : (fam && fam !== FAMILY.none ? fam.icon + " " : "") + name + (stalled ? " · stalled" : "");
    const cls = "lead st-" + s.state + (stalled ? " stalled" : "") + (sel ? " sel" : "");
    const el = labels.set("a:" + f.id, {cls, state: stalled ? "stalled" : s.state, text});
    el.style.setProperty("--accent", accentOf(s));
    const c = f.cur;
    return {el, q: kit.project(c.x, c.y + (f.kind === KIND.empty ? 1.5 : 2.4 + (waiting ? 1.0 : 0)), c.z),
      rank: waiting || sel ? 0 : (s.state === "offline" ? 2 : 1)};
  }
  // A stalled musician's lane says so and outranks its quiet neighbours.
  function laneLabel(f) {
    const fl = f.follower, sel = f.id === selectedId, c = f.cur, stalled = !!fl.stalled;
    const cls = "lane" + (fl.state === "active" ? "" : " rest") + (stalled ? " stalled" : "") + (sel ? " sel" : "");
    const text = (FAMILY[actionOf(f)] || FAMILY.other).icon + " " + (fl.label || "subagent") + (stalled ? " · stalled" : "");
    const el = labels.set("a:" + f.id, {cls, state: stalled ? "stalled" : null, text});
    const sx = c.x + (f.leadX - c.x) * 0.45, sz = c.z + (f.leadZ - c.z) * 0.45;
    return {el, q: kit.project(sx, c.y + 1.35, sz), rank: sel ? 0 : (stalled ? 1 : 4)};
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
    // On screen and clear of the bar, panel and legend; a label that must
    // show (waiting, selected) drops below the bar instead of hiding.
    hud.placeLabels(items, {canvas});
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
    if (selectedId && (how === "waiting" || how === "list")) reveal(selectedId, true);
    // A tap opens the card (a bottom sheet on a phone): slide what was tapped out from under it.
    else if (selectedId && how === "tap") reveal(selectedId, false);
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
  // A toggle with a fixed name: "Sound on", pressed or not (aria-pressed).
  // The speaker glyph and the gold edge show the state to the eye.
  function soundButton() {
    const button = document.createElement("button");
    const glyph = document.createElement("span"), word = document.createElement("span");
    button.type = "button";
    button.id = "sound";
    button.className = "av-chip av-sound";
    button.title = "Play a soft note for each tool call (off by default)";
    glyph.className = "av-sound-glyph";
    glyph.setAttribute("aria-hidden", "true");
    word.textContent = "Sound on";
    button.append(glyph, word);
    const show = () => {
      button.setAttribute("aria-pressed", String(band.on));
      glyph.textContent = band.on ? "🔊" : "🔈";
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
    hud = AgentvizHud.create({title: "𝄞 Orchestra", oneRow: true, legend: document.getElementById("legend"),
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
    window.__page = {kit, stage, hud, band, fit, flyTo, focusOn, projectWith, FAMILY,
      select: (id, focus) => hud.select(targetOf(stage.figs.get(id)), focus ? "list" : "api"),
      tap: (id) => hud.select(targetOf(stage.figs.get(id)), "tap"),
      hold: () => { userMoved = true; },
      get selectedId() { return selectedId; }, get doc() { return feed.doc; }, get polls() { return feed.polls; },
      stopPolling: () => feed.stop(), pollOnce: () => feed.pollOnce(), feed: (d) => feed.push(d)};
    addEventListener("resize", () => requestAnimationFrame(refitOnResize));
    feed.start();
    kit.start();
    if (kit.driven) kit.drive(0);
    StrataLoader.done();
    canvas.focus({preventScroll: true});
  }

  boot();
})();
