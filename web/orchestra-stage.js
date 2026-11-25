/* orchestra-stage.js: lays the concert stage out from a feed document and
   eases every figure between snapshots.

   Stage coordinates: the audience is at +z, upstage is -z. Each place (repo)
   is an ensemble on its own rug; the front row of ensembles stands at z = 0
   and each further row is a step up on a riser. A session is a conductor on
   a podium (an empty chair when offline); its followers are musicians fanned
   in front of the podium.

     const stage = new OrchestraStage();
     stage.update(doc);           // after every snapshot
     stage.call(id, at);          // a new tool call by agent id, shown from scene time `at`
     stage.step(t);               // every frame, scene seconds
     stage.figs, stage.rugs, stage.bounds, stage.owner, stage.anyWaiting, stage.pulse(id, t)

   Classic script: window.OrchestraStage. Needs AgentvizFeed. */
(function () {
  "use strict";
  const {seedOf, followerKey} = window.AgentvizFeed;
  const KIND = {conductor: "conductor", musician: "musician", empty: "empty"};
  const PLAYING = ["edit", "run", "read", "web", "other"];
  const PULSE_SEC = 1.2;
  const RATE = {move: 3, up: 5, turn: 14};

  /* ------------------------------------------------------------ layout */

  // One group per session: how wide its fan of musicians is.
  function groupOf(session) {
    const n = session.state === "offline" ? 0 : (session.followers || []).length;
    const fanR = n ? Math.max(2.4, 1.4 + n * 0.42) : 0;
    const w = n ? 2 * fanR + 1.6 : (session.state === "offline" ? 2.6 : 3.6);
    return {session, n, fanR, w, d: n ? fanR + 3.0 : 3.4};
  }

  // One block per place, in the feed's place order.
  function blocksOf(doc) {
    const sessions = doc.sessions || [], places = doc.places || [];
    const order = places.map((p) => p.id);
    for (const s of sessions) if (!order.includes(s.place)) order.push(s.place);
    const blocks = [];
    for (const id of order) {
      const members = sessions.filter((s) => s.place === id);
      if (!members.length) continue;
      const info = places.find((p) => p.id === id) || {};
      const groups = members.map(groupOf);
      blocks.push({id, label: info.label || id, seed: info.seed != null ? info.seed : seedOf(id), groups,
        w: groups.reduce((a, g) => a + g.w, 0) + 0.6, d: Math.max(...groups.map((g) => g.d)) + 0.4});
    }
    return blocks;
  }

  // Blocks fill rows no wider than about 1.5 x the square root of their area.
  function rowsOf(blocks) {
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
    return rows;
  }

  // A session's figures: its conductor (or empty chair) and its musicians.
  function placeGroup(g, px, y, zFront, out) {
    const s = g.session, pz = zFront - 1.6;
    if (s.state === "offline") {
      out.push({id: s.id, kind: KIND.empty, session: s, follower: null, x: px, y, z: pz, dx: 0, dz: -1});
      return;
    }
    out.push({id: s.id, kind: KIND.conductor, session: s, follower: null, x: px, y, z: pz, dx: 0, dz: -1,
      soloX: px + 1.35, soloZ: pz + 0.95});
    const followers = s.followers || [];
    followers.forEach((f, i) => {
      const a = followers.length === 1 ? 0 : (-70 + 140 * i / (followers.length - 1)) * Math.PI / 180;
      const mx = px + g.fanR * Math.sin(a), mz = pz - g.fanR * Math.cos(a);
      const len = Math.hypot(px - mx, pz - mz) || 1;
      out.push({id: followerKey(s, f), kind: KIND.musician, session: s, follower: f, x: mx, y, z: mz,
        dx: (px - mx) / len, dz: (pz - mz) / len, leadX: px, leadZ: pz});
    });
  }

  function layout(doc) {
    const figs = [], rugs = [];
    let zFront = 0, minX = -6, maxX = 6;
    rowsOf(blocksOf(doc)).forEach((row, ri) => {
      const y = ri * 0.45;
      let x = -row.w / 2;
      for (const b of row.blocks) {
        const states = b.groups.map((g) => g.session.state);
        rugs.push({id: b.id, label: b.label, seed: b.seed, x0: x, x1: x + b.w, z0: zFront - b.d, z1: zFront, y,
          waiting: states.includes("waiting") ? 1 : 0, busy: states.includes("busy") ? 1 : 0});
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + b.w);
        let gx = x + 0.3;
        for (const g of b.groups) { placeGroup(g, gx + g.w / 2, y, zFront, figs); gx += g.w; }
        x += b.w;
      }
      zFront -= row.d;
    });
    // The owner's seat: the front row of the house, centre, on the seat grid hall.h draws.
    const base = minX - 6;
    return {figs, rugs, bounds: {x0: minX, z0: zFront, x1: maxX, z1: 0}, owner: {x: base + Math.round(-base), z: 6}};
  }

  /* ------------------------------------------------------------ easing */

  // What a figure is doing now: playing (up), turned to the audience (wait).
  function goal(f) {
    const s = f.session;
    if (f.kind === KIND.musician) {
      const active = f.follower.state === "active" && f.follower.action !== "none" && s.state !== "offline";
      return {up: active ? 1 : 0, wait: 0};
    }
    return {up: s.state === "busy" && PLAYING.includes(s.action) ? 1 : 0, wait: s.state === "waiting" ? 1 : 0};
  }

  const approach = (cur, target, dt, rate) => window.AgentvizFeed.ease(cur, target, dt, rate);

  class OrchestraStage {
    constructor() {
      this.figs = new Map();
      this.rugs = [];
      this.bounds = {x0: -10, z0: -10, x1: 10, z1: 0};
      this.owner = {x: 0, z: 6};
      this.anyWaiting = 0;
      this.lastT = null;
      this.calls = new Map();   // agent id -> scene time its newest call shows
      this.onCall = null;       // (fig) => {}: a call's note starts (the page plays it)
    }

    update(doc) {
      const L = layout(doc), seen = new Set();
      for (const f of L.figs) {
        seen.add(f.id);
        if (f.kind === KIND.conductor && f.session.state === "waiting") this._faceOwner(f, L.owner);
        let fig = this.figs.get(f.id);
        if (!fig || fig.kind !== f.kind) {
          fig = {cur: {x: f.x, y: f.y, z: f.z, dx: f.dx, dz: f.dz, up: 0, wait: 0}};
          this.figs.set(f.id, fig);
        }
        Object.assign(fig, f, {target: {x: f.x, y: f.y, z: f.z, dx: f.dx, dz: f.dz}});
      }
      for (const id of [...this.figs.keys()]) if (!seen.has(id)) this.figs.delete(id);
      Object.assign(this, {rugs: L.rugs, bounds: L.bounds, owner: L.owner});
    }

    _faceOwner(f, owner) {
      const vx = owner.x - f.x, vz = owner.z - f.z, len = Math.hypot(vx, vz) || 1;
      f.dx = vx / len;
      f.dz = vz / len;
    }

    // A new tool call by `id`, to be seen (and heard) from scene time `at`.
    call(id, at) { if (this.figs.has(id)) this.calls.set(id, {at, played: false}); }

    // 1 as a call's note starts, easing to 0 over PULSE_SEC; 0 before it starts.
    pulse(id, t) {
      const c = this.calls.get(id);
      if (!c || t < c.at) return 0;
      return Math.max(0, 1 - (t - c.at) / PULSE_SEC);
    }

    step(t) {
      const dt = this.lastT == null ? 0 : Math.min(Math.max(t - this.lastT, 0), 0.25);
      this.lastT = t;
      let anyWait = 0;
      for (const f of this.figs.values()) {
        const c = f.cur, g = f.target, want = goal(f);
        for (const k of ["x", "y", "z"]) c[k] = approach(c[k], g[k], dt, RATE.move);
        c.dx = approach(c.dx, g.dx, dt, RATE.turn);
        c.dz = approach(c.dz, g.dz, dt, RATE.turn);
        c.up = approach(c.up, want.up, dt, RATE.up);
        c.wait = approach(c.wait, want.wait, dt, RATE.turn);
        anyWait = Math.max(anyWait, c.wait);
      }
      this.anyWaiting = anyWait;
      this._startCalls(t);
    }

    _startCalls(t) {
      for (const [id, c] of this.calls) {
        if (c.played || t < c.at) continue;
        c.played = true;
        const f = this.figs.get(id);
        if (f && this.onCall) this.onCall(f);
      }
    }
  }

  OrchestraStage.KIND = KIND;
  OrchestraStage.layout = layout;
  window.OrchestraStage = OrchestraStage;
})();
