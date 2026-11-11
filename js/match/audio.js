// Stadium sound, synthesized in the browser (no audio files):
// thousands of "voices" are approximated by many detuned vocal oscillators shaped by vowel
// formants, rendered once into loops and one-shots with an OfflineAudioContext:
// a murmur bed, an excited bed, a rising "ooh" when a shot goes in, a goal roar with whistles,
// a groan for a miss, applause, and an original clap-along chant for quiet spells.
const VOWELS = { a: [800, 1200], e: [500, 1800], i: [330, 2300], o: [500, 900], u: [330, 800], ae: [660, 1700] };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];

export class StadiumAudio {
  constructor() { this.ctx = null; this.enabled = false; this.buf = {}; this.ready = false; this.lastChant = 0; this.exc = 0.2; }

  enable() {
    if (this.ctx) { this.ctx.resume?.(); this.enabled = true; if (this.bus) this.bus.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const ctx = this.ctx = new C();
      this.master = ctx.createGain(); this.master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
      this.bus = ctx.createGain(); this.bus.gain.value = 1;
      this.bus.connect(this.master); this.master.connect(comp); comp.connect(ctx.destination);
      // a stadium-sized space: short convolution reverb from decaying noise
      this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.4);
      this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.35;
      this.verb.connect(this.verbGain); this.verbGain.connect(this.bus);
      this.enabled = true;
      this.build().catch(err => { this.err = String(err); console.warn("crowd audio", err); });
    } catch (e) { this.enabled = false; }
  }
  disable() { this.enabled = false; if (this.bus) this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); }

  impulse(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
    return b;
  }

  // ---- offline rendering of crowd layers ----
  async render(sec, fill) {
    const sr = 16000;
    const oc = new OfflineAudioContext(2, Math.ceil(sr * sec), sr);
    fill(oc, sec);
    return oc.startRendering();
  }
  voice(oc, out, { f0, vowel, t0, t1, amp, glide = 0, vib = 0.012, syll = false, pan = rnd(-0.9, 0.9) }) {
    const o = oc.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t0);
    if (glide) { o.frequency.linearRampToValueAtTime(f0 * (1 + glide), t0 + (t1 - t0) * 0.45); o.frequency.linearRampToValueAtTime(f0 * (1 + glide * 0.3), t1); }
    const lfo = oc.createOscillator(), lg = oc.createGain(); lfo.frequency.value = rnd(4, 6.5); lg.gain.value = f0 * vib; lfo.connect(lg); lg.connect(o.frequency);
    const g = oc.createGain(); g.gain.value = 0;
    const p = oc.createStereoPanner(); p.pan.value = pan;
    const [F1, F2] = VOWELS[vowel];
    const b1 = oc.createBiquadFilter(), b2 = oc.createBiquadFilter(); b1.type = b2.type = 'bandpass';
    b1.frequency.value = F1 * rnd(0.9, 1.1); b2.frequency.value = F2 * rnd(0.9, 1.1); b1.Q.value = 6; b2.Q.value = 9;
    const g2 = oc.createGain(); g2.gain.value = 0.5;
    o.connect(b1); o.connect(b2); b1.connect(g); b2.connect(g2); g2.connect(g); g.connect(p); p.connect(out);
    if (syll) { // babble: random syllables, vowel changes
      let t = t0;
      while (t < t1) {
        const on = rnd(0.09, 0.3), off = rnd(0.03, 0.4), a = amp * rnd(0.3, 1);
        g.gain.setTargetAtTime(a, t, 0.025); g.gain.setTargetAtTime(0, t + on, 0.04);
        const [f1, f2] = VOWELS[pick(Object.keys(VOWELS))]; b1.frequency.setTargetAtTime(f1, t, 0.03); b2.frequency.setTargetAtTime(f2, t, 0.03);
        t += on + off;
      }
    } else {
      const att = Math.min(0.25, (t1 - t0) * 0.2);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + att); g.gain.setValueAtTime(amp, Math.max(t0 + att, t1 - (t1 - t0) * 0.35)); g.gain.linearRampToValueAtTime(0, t1);
    }
    [o, lfo].forEach(x => { x.start(t0); x.stop(t1 + 0.1); });
  }
  noise(oc, out, { t0, t1, amp, lo = 300, hi = 3000, env = null }) {
    const n = Math.ceil(oc.sampleRate * (t1 - t0 + 0.1)), b = oc.createBuffer(1, n, oc.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = oc.createBufferSource(); s.buffer = b;
    const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = lo;
    const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = hi;
    const g = oc.createGain(); g.gain.value = 0;
    if (env) env(g.gain); else { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + 0.3); g.gain.setValueAtTime(amp, t1 - 0.3); g.gain.linearRampToValueAtTime(0, t1); }
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out); s.start(t0); s.stop(t1 + 0.1);
  }
  claps(oc, out, times, amp) {
    const n = Math.ceil(oc.sampleRate * 0.05), b = oc.createBuffer(1, n, oc.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (oc.sampleRate * 0.008));
    for (const t of times) {
      const s = oc.createBufferSource(); s.buffer = b; s.playbackRate.value = rnd(0.8, 1.3);
      const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(900, 2200); bp.Q.value = 1.2;
      const g = oc.createGain(); g.gain.value = amp * rnd(0.4, 1);
      const p = oc.createStereoPanner(); p.pan.value = rnd(-1, 1);
      s.connect(bp); bp.connect(g); g.connect(p); p.connect(out); s.start(t);
    }
  }
  loopify(buf) { // crossfade the tail into the head so the loop has no seam
    const sr = buf.sampleRate, xf = Math.floor(sr * 0.6), n = buf.length - xf;
    const out = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const s = buf.getChannelData(c), d = out.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = s[i];
      for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = s[i] * k + s[n + i] * (1 - k); }
    }
    return out;
  }
  async build() {
    const male = () => rnd(95, 165), mixed = () => (Math.random() < 0.78 ? rnd(100, 175) : rnd(190, 290));
    const murmur = await this.render(9.6, (oc, T) => {
      const out = oc.destination;
      for (let i = 0; i < 44; i++) this.voice(oc, out, { f0: mixed(), vowel: 'a', t0: rnd(0, 0.3), t1: T, amp: 0.065, syll: true });
      this.noise(oc, out, { t0: 0, t1: T, amp: 0.05, lo: 250, hi: 2200 });
    });
    const loud = await this.render(9.6, (oc, T) => {
      const out = oc.destination;
      for (let i = 0; i < 36; i++) { let t = rnd(-1, 0); while (t < T) { const d = rnd(0.8, 2.4); this.voice(oc, out, { f0: mixed() * 1.25, vowel: pick(['a', 'ae', 'e', 'o']), t0: Math.max(0, t), t1: Math.min(T, t + d), amp: 0.06, vib: 0.02 }); t += d * rnd(0.5, 1.1); } }
      for (let i = 0; i < 24; i++) this.voice(oc, out, { f0: mixed(), vowel: 'a', t0: 0, t1: T, amp: 0.03, syll: true });
      this.noise(oc, out, { t0: 0, t1: T, amp: 0.09, lo: 400, hi: 3500 });
    });
    this.buf.murmur = this.loopify(murmur); this.buf.loud = this.loopify(loud);
    this.startBeds();
    this.buf.ooh = await this.render(2.2, (oc, T) => {
      for (let i = 0; i < 45; i++) this.voice(oc, oc.destination, { f0: mixed() * 1.1, vowel: Math.random() < 0.7 ? 'o' : 'u', t0: rnd(0, 0.15), t1: T - rnd(0, 0.3), amp: 0.05, glide: rnd(0.25, 0.45) });
    });
    this.buf.roar = await this.render(5.5, (oc, T) => {
      const out = oc.destination;
      for (let i = 0; i < 60; i++) this.voice(oc, out, { f0: mixed() * rnd(1.2, 1.5), vowel: pick(['a', 'ae', 'e', 'ae']), t0: rnd(0, 0.25), t1: T - rnd(0.2, 1.5), amp: 0.05, vib: 0.03, glide: rnd(0.05, 0.2) });
      this.noise(oc, out, { t0: 0, t1: T, amp: 0, lo: 500, hi: 5000, env: g => { g.setValueAtTime(0, 0); g.linearRampToValueAtTime(0.32, 0.25); g.setValueAtTime(0.3, 2.6); g.linearRampToValueAtTime(0, T); } });
      const ct = []; for (let i = 0; i < 260; i++) ct.push(rnd(0.6, T - 0.5)); this.claps(oc, out, ct, 0.18);
      for (let i = 0; i < 6; i++) { const o = oc.createOscillator(), g = oc.createGain(), t = rnd(0.3, 3); o.frequency.value = rnd(2200, 3400); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.05); g.gain.linearRampToValueAtTime(0, t + rnd(0.3, 0.8)); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1); }
    });
    this.buf.groan = await this.render(2.4, (oc, T) => {
      for (let i = 0; i < 45; i++) this.voice(oc, oc.destination, { f0: male() * 1.15, vowel: Math.random() < 0.6 ? 'o' : 'a', t0: rnd(0, 0.1), t1: T - rnd(0, 0.5), amp: 0.05, glide: -rnd(0.25, 0.4) });
    });
    this.buf.applause = await this.render(3.2, (oc, T) => {
      const ct = []; for (let i = 0; i < 420; i++) ct.push(rnd(0, 1) ** 1.6 * (T - 0.3)); this.claps(oc, oc.destination, ct, 0.16);
      for (let i = 0; i < 30; i++) this.voice(oc, oc.destination, { f0: mixed() * 1.2, vowel: 'e', t0: rnd(0, 0.3), t1: rnd(1, 2), amp: 0.035 });
    });
    this.buf.chant = await this.render(8.4, (oc, T) => { // original two-bar call: three short notes and a long one, with claps
      const out = oc.destination, beat = 0.5;
      const tune = [[0, 0.4, 0], [0.5, 0.4, 0], [1, 0.4, 3], [1.5, 1.3, 5], [3, 0.4, 3], [3.5, 0.4, 3], [4, 0.4, 0], [4.5, 1.3, -2]];
      for (let rep = 0; rep < 2; rep++) {
        const base = rep * 4.2;
        for (const [b, d, semi] of tune) for (let i = 0; i < 18; i++) this.voice(oc, out, { f0: 140 * Math.pow(2, semi / 12) * (Math.random() < 0.15 ? 2 : 1) * rnd(0.985, 1.015), vowel: d > 1 ? 'o' : 'e', t0: base + b * beat * 1.6 + rnd(0, 0.05), t1: base + (b * beat + d) * 1.6, amp: 0.045 });
        const ct = []; for (let k = 0; k < 4; k++) for (let i = 0; i < 40; i++) ct.push(base + k * 0.8 * 1.25 + rnd(-0.03, 0.04) + 2.5); this.claps(oc, out, ct, 0.14);
      }
    });
    this.ready = true;
  }
  startBeds() {
    const ctx = this.ctx; this.bedsOn = true;
    const loop = (b, gain) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; const g = ctx.createGain(); g.gain.value = gain; s.connect(g); g.connect(this.bus); g.connect(this.verb); s.start(); return g; };
    this.gMurmur = loop(this.buf.murmur, 1);
    this.gLoud = loop(this.buf.loud, 0);
    this.setExcitement(this.exc);
  }
  shot(name, gain = 1) {
    if (!this.enabled || !this.buf[name]) return;
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.buf[name];
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(this.bus); g.connect(this.verb); s.start();
    return g;
  }

  setExcitement(e) {
    this.exc = e;
    if (!this.enabled || !this.ctx || !this.gMurmur) return;
    const t = this.ctx.currentTime;
    this.gMurmur.gain.setTargetAtTime(1.3 - e * 0.6, t, 0.4);
    this.gLoud.gain.setTargetAtTime(Math.pow(Math.max(0, e - 0.15) / 0.85, 1.4) * 1.1, t, 0.35);
    // quiet spell: someone starts a chant
    if (e < 0.35 && t - this.lastChant > 28 && Math.random() < 0.004) { this.lastChant = t; this.shot('chant', 1.5); }
  }
  duck(on) { if (this.enabled && this.bus) this.bus.gain.setTargetAtTime(on ? 0.55 : 1, this.ctx.currentTime, 0.15); } // under the commentator
  rise() { this.shot('ooh', 1.7); }           // a shot is on its way
  whistle(n = 1, long = false) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx; let t = ctx.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const dur = long && i === n - 1 ? 0.9 : 0.28;
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.frequency.value = 2650; o2.frequency.value = 2900; lfo.frequency.value = 28; lg.gain.value = 120;
      lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.02); g.gain.setValueAtTime(0.06, t + dur - 0.05); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); o2.connect(g); g.connect(this.bus); g.connect(this.verb);
      [o, o2, lfo].forEach(x => { x.start(t); x.stop(t + dur + 0.05); });
      t += dur + 0.12;
    }
  }
  kick(power = 0.5) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140 + power * 60, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    g.gain.setValueAtTime(0.25 * power + 0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.2);
  }
  roar(big = true) { if (big) this.shot('roar', 1.0); else this.shot('applause', 1.6); }
  groan() { this.shot('groan', 1.9); }
}
