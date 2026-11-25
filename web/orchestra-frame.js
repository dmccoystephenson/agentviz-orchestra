/* orchestra-frame.js: packs the stage for the scene, once a frame, in the
   agentviz wire format (vendor/agentviz-kit, docs/KIT.md). scene/hall.h,
   conductor.h and musician.h read what is written here.

     scene floats  stage x0, z0, x1, z1, owner's seat x, z, anyone waiting (eased)
     zones         one rug per place; extras: riser height, anyone waiting, anyone busy
     agents        conductors (offline: empty chairs) and musicians;
                   extras: up (playing, eased), wait (turned to the house, eased),
                   conductor: solo chair x, z; musician: its podium x, z
     links         kind 0: thread from a musician's stand to its podium (alpha: playing)
                   kind 1: a waiting conductor's trail to the owner's seat (alpha: wait)

   Classic script: window.OrchestraFrame. */
(function () {
  "use strict";
  const {KIND} = window.OrchestraStage;
  const LINK = {thread: 0, waitTrail: 1};

  function sceneFloats(stage) {
    const b = stage.bounds;
    return [b.x0, b.z0, b.x1, b.z1, stage.owner.x, stage.owner.z, stage.anyWaiting];
  }

  function zones(wire, stage) {
    for (const r of stage.rugs) {
      wire.zone({id: "place:" + r.id, kind: 0, seed: r.seed, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1,
        extra: [r.y, r.waiting, r.busy]});
    }
  }

  function agents(wire, stage, highlightOf, pulseOf) {
    for (const f of stage.figs.values()) {
      const c = f.cur, len = Math.hypot(c.dx, c.dz) || 1;
      const anchor = f.kind === KIND.musician ? [f.leadX, f.leadZ] : [f.soloX || 0, f.soloZ || 0];
      wire.agent({session: f.session, follower: f.follower, x: c.x, y: c.y, z: c.z,
        facing: Math.atan2(c.dx / len, c.dz / len), highlight: highlightOf(f.id), pulse: pulseOf(f.id),
        extra: [c.up, c.wait, anchor[0], anchor[1]]});
    }
  }

  function links(wire, stage) {
    for (const f of stage.figs.values()) {
      const c = f.cur;
      if (f.kind === KIND.musician) {
        const len = Math.hypot(f.leadX - c.x, f.leadZ - c.z) || 1, k = 0.85 / len;
        wire.link({kind: LINK.thread, from: f.id, to: f.session.id, x0: c.x + (f.leadX - c.x) * k, y0: c.y + 0.03,
          z0: c.z + (f.leadZ - c.z) * k, x1: f.leadX, y1: c.y + 0.03, z1: f.leadZ,
          seed: f.session.seed, alpha: c.up > 0.5 ? 0.35 : 0.15});
      } else if (f.kind === KIND.conductor && c.wait > 0.01) {
        wire.link({kind: LINK.waitTrail, from: f.id, x0: c.x, y0: c.y + 0.6, z0: c.z, x1: stage.owner.x, y1: -0.3,
          z1: stage.owner.z, alpha: c.wait});
      }
    }
  }

  // highlightOf(id) -> 0 none, 1 selected, 2 hovered; pulseOf(id) -> 0..1.
  function write(wire, stage, doc, highlightOf, pulseOf) {
    wire.begin({doc, scene: sceneFloats(stage)});
    zones(wire, stage);
    agents(wire, stage, highlightOf, pulseOf);
    links(wire, stage);
    return wire;
  }

  window.OrchestraFrame = {write, LINK};
})();
