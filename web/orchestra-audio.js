/* orchestra-audio.js: the opt-in sound of the orchestra.

   OFF by default. Nothing here makes a sound, or even creates an
   AudioContext, until the page calls Band.enable() from the "Sound on"
   button (a user gesture). Each new tool call plays one short, soft note in
   its family's timbre; while anyone waits on the owner a gentle chime
   repeats. Notes are rate-limited and the master volume is low. */
(function () {
  "use strict";
  // C major pentatonic, two and a half octaves from C3 (MIDI 48).
  const SCALE = [0, 2, 4, 7, 9];
  const OCTAVE = {edit: 1, run: 0, read: 2, web: 1, delegate: 2, think: 0, other: 2};
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const MIN_GAP = 0.14;      // seconds between notes
  const BURST = 6;           // at most this many notes ...
  const BURST_WINDOW = 3.0;  // ... in this many seconds
  const CHIME_EVERY = 6.0;   // seconds between waiting chimes

  const Band = {
    ctx: null, master: null, on: false, lastNote: -1e9, recent: [], lastChime: -1e9, step: 0, noise: null,

    enable() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.18;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.3);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      this.ctx.resume();
      this.on = true;
      return true;
    },

    disable() {
      this.on = false;
      if (this.ctx) this.ctx.suspend();
    },

    _allowed(now) {
      if (now - this.lastNote < MIN_GAP) return false;
      this.recent = this.recent.filter((t) => now - t < BURST_WINDOW);
      if (this.recent.length >= BURST) return false;
      this.recent.push(now);
      this.lastNote = now;
      return true;
    },

    _env(gainNode, t0, attack, peak, decay) {
      const g = gainNode.gain;
      g.setValueAtTime(0.0001, t0);
      g.exponentialRampToValueAtTime(peak, t0 + attack);
      g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    },

    _osc(type, hz, t0, dur, dest) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(hz, t0);
      o.connect(dest);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
      return o;
    },

    /* One note for a tool call of `action` by an agent with `seed` (0..1). */
    note(action, seed) {
      if (!this.on || !this.ctx || this.ctx.state !== "running") return false;
      const now = this.ctx.currentTime;
      if (!this._allowed(now)) return false;
      const fam = OCTAVE[action] != null ? action : "other";
      const deg = Math.floor(((seed || 0) * 10 + this.step++) % SCALE.length);
      const hz = midiHz(48 + 12 * OCTAVE[fam] + SCALE[deg]);
      const ctx = this.ctx, t0 = now + 0.01;
      const g = ctx.createGain();
      g.connect(this.master);
      if (fam === "edit") {  // strings: a bowed sawtooth, softened
        const f = ctx.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 1400; f.connect(g);
        const o = this._osc("sawtooth", hz, t0, 0.8, f);
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 5.5; lg.gain.value = hz * 0.006;
        lfo.connect(lg); lg.connect(o.frequency); lfo.start(t0); lfo.stop(t0 + 0.85);
        this._env(g, t0, 0.09, 0.22, 0.7);
      } else if (fam === "run") {  // percussion: a soft drum, pitch falling, a breath of noise
        const o = this._osc("sine", hz * 1.5, t0, 0.35, g);
        o.frequency.exponentialRampToValueAtTime(hz * 0.5, t0 + 0.18);
        const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
        n.buffer = this.noise; nf.type = "bandpass"; nf.frequency.value = 900; ng.gain.value = 0.08;
        n.connect(nf); nf.connect(ng); ng.connect(g); n.start(t0); n.stop(t0 + 0.2);
        this._env(g, t0, 0.005, 0.5, 0.3);
      } else if (fam === "read") {  // woodwinds: a breathy triangle
        const f = ctx.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 2400; f.connect(g);
        this._osc("triangle", hz, t0, 0.6, f);
        this._osc("sine", hz * 2, t0, 0.6, f);
        this._env(g, t0, 0.06, 0.25, 0.5);
      } else if (fam === "web") {  // brass: a square with an opening filter
        const f = ctx.createBiquadFilter();
        f.type = "lowpass"; f.Q.value = 2;
        f.frequency.setValueAtTime(500, t0);
        f.frequency.exponentialRampToValueAtTime(2600, t0 + 0.08);
        f.frequency.exponentialRampToValueAtTime(900, t0 + 0.5);
        f.connect(g);
        this._osc("square", hz, t0, 0.6, f);
        this._env(g, t0, 0.04, 0.14, 0.5);
      } else if (fam === "delegate") {  // the baton: a small bell
        this._osc("sine", hz, t0, 1.1, g);
        const g2 = ctx.createGain(); g2.gain.value = 0.3; g2.connect(g);
        this._osc("sine", hz * 2.76, t0, 0.6, g2);
        this._env(g, t0, 0.005, 0.25, 1.0);
      } else if (fam === "think") {  // the pause: barely there
        this._osc("sine", hz, t0, 0.9, g);
        this._env(g, t0, 0.2, 0.1, 0.7);
      } else {  // other: a plucked triangle
        this._osc("triangle", hz, t0, 0.4, g);
        this._env(g, t0, 0.005, 0.28, 0.35);
      }
      return true;
    },

    /* Called every frame with whether anyone waits: a gentle two-note chime. */
    tick(anyWaiting) {
      if (!this.on || !this.ctx || this.ctx.state !== "running" || !anyWaiting) return;
      const now = this.ctx.currentTime;
      if (now - this.lastChime < CHIME_EVERY) return;
      this.lastChime = now;
      [[midiHz(88), 0], [midiHz(84), 0.28]].forEach(([hz, dt]) => {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this._osc("sine", hz, now + dt, 1.3, g);
        this._env(g, now + dt, 0.01, 0.16, 1.2);
      });
    },
  };

  window.OrchestraBand = Band;
})();
