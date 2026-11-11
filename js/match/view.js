// Animated match viewer. Plays back a precomputed match timeline (from core/sim.js) as a live,
// broadcast-style scene: 22 players with formation-aware movement, passes, shots, keeper dives,
// set pieces, cards, celebrations, instant replays, crowd and weather.
import { FORMATIONS } from '../core/constants.js';
import { line as commentary } from './commentary.js';
import REAL from './real-data.js';
import { Stage3D, webglAvailable } from './view3d.js';

const L = 105, Wd = 68, GOAL_HW = 3.66, GOAL_H = 2.44;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const POSE = { run: 0, kick: 1, dive: 2, celebrate: 3, down: 4, dejected: 5, card: 6, header: 7, flag: 8 };
const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#a26a42', '#7a4a2a', '#4f2f1c'];
const HAIR = ['#1b1209', '#3b2412', '#6b4422', '#c9a15a', '#e6d3a3', '#8a2d12', '#222'];
const GK_KITS = [['#f5d90a', '#111'], ['#2bd96b', '#111'], ['#ff7ad9', '#111'], ['#ff8a00', '#111'], ['#00d1d1', '#111'], ['#a874ff', '#fff']];

function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function colorDist(a, b) { const x = hexToRgb(a), y = hexToRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
function shade(h, f) { const [r, g, b] = hexToRgb(h); const m = v => clamp(Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f), 0, 255); return `rgb(${m(r)},${m(g)},${m(b)})`; }

export class MatchView {
  constructor(canvas, { home, away, result, hooks = {}, camera = 'broadcast', speed = 1, audio = null, stadium = 'the stadium', weather, night, demo = false, boards, three = true }) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.home = home; this.away = away; this.result = result; this.hooks = hooks;
    this.camMode = camera; this.speed = speed; this.audio = audio; this.stadium = stadium; this.demo = demo;
    this.boards = boards || ['MATCHDAY LEGENDS', 'YOUR AD HERE', 'KESSEL COLA', 'NORDWIND ENERGY', 'PIXELBANK', 'ORBIT TYRES'];
    const seed = result.seed || 1;
    this.weather = weather || (seed % 7 === 0 ? 'rain' : seed % 23 === 0 ? 'snow' : 'clear');
    this.night = night ?? (seed % 3 !== 0);
    this.t = 0; this.half = 1; this.score = [0, 0];
    this.time = 0; this.excite = 0.2; this.fade = 0; this.fadeTarget = 0;
    this.flash = 0; this.confetti = []; this.trail = []; this.netBulge = null;
    this.state = 'idle'; this.script = null; this.wait = 0; this.until = null; this.untilT = 0;
    this.rec = []; this.replay = null; this.paused = false; this.ended = false;
    this.cam = { fx: 52.5, fy: 34, zoom: 1.25, tzoom: 1.25 }; this.baseZoom = 1.25;
    this.stats = { shots: [0, 0], sot: [0, 0], corners: [0, 0], fouls: [0, 0], yellows: [0, 0], poss: [1, 1] };
    this.setupKits();
    this.setupPlayers();
    this.setupEvents(result.events);
    this.crowd = this.makeCrowd();
    this.rain = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.6, 1.2) }));
    this.noise = this.makeNoise();
    this.ball = { x: 52.5, y: 34, z: 0, vx: 0, vy: 0, vz: 0, owner: null, fl: null, spin: 0 };
    this.lastFrame = 0;
    this._loop = this.loop.bind(this);
    this.g3 = null;
    if (three && webglAvailable()) { try { this.g3 = new Stage3D(this); } catch (err) { console.warn('3D unavailable, using 2D', err); this.g3 = null; } }
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ---------- setup ----------
  setupKits() {
    const h = this.home.colors, a = this.away.colors;
    let away = { primary: a.primary, secondary: a.secondary, pattern: a.pattern };
    if (colorDist(h.primary, a.primary) < 120) {
      away = colorDist(h.primary, a.secondary) > 140 ? { primary: a.secondary, secondary: a.primary, pattern: 'plain' } : { primary: colorDist(h.primary, '#ffffff') > 200 ? '#f4f4f4' : '#1a1a1a', secondary: a.primary, pattern: 'plain' };
    }
    const seed = this.result.seed || 0;
    const g1 = GK_KITS[seed % GK_KITS.length], g2 = GK_KITS[(seed + 3) % GK_KITS.length];
    this.kits = [
      { primary: h.primary, secondary: h.secondary, pattern: h.pattern, shorts: h.pattern === 'plain' ? h.secondary : h.primary, socks: h.primary, gk: { primary: g1[0], secondary: g1[1], pattern: 'plain', shorts: g1[1], socks: g1[0] } },
      { primary: away.primary, secondary: away.secondary, pattern: away.pattern, shorts: away.secondary, socks: away.primary, gk: { primary: g2[0], secondary: g2[1], pattern: 'plain', shorts: g2[1], socks: g2[0] } },
    ];
    this.refKit = { primary: '#1c1c1c', secondary: '#f2ff00', pattern: 'sleeves', shorts: '#111', socks: '#111' };
  }

  setupPlayers() {
    this.ps = [[], []];
    this.byId = {};
    this.sheets = [this.home, this.away];
    this.sheets.forEach((sh, k) => {
      const slots = FORMATIONS[sh.formation] || FORMATIONS['4-4-2'];
      sh.xi.forEach((p, i) => {
        const s = slots[p.slot ?? i] || slots[i];
        const P = { team: k, info: p, id: p.id, role: p.role, slot: { x: s[2], y: s[3] }, x: 0, y: 0, vx: 0, vy: 0, ft: null, sprint: false,
          phase: Math.random() * 6, pose: 0, poseT: 0, face: 1, off: false, seed: Math.random() * 100, hold: 0,
          maxSp: 5.6 + ((p.attrs?.pace ?? 60) / 100) * 2.6, kit: p.role === 'GK' ? this.kits[k].gk : this.kits[k], num: p.number || i + 1, look: p.look || { skin: i % 6, hair: i % 7 }, name: p.last || p.name };
        this.ps[k].push(P); this.byId[p.id] = P;
      });
    });
    this.bench = [this.home.bench || [], this.away.bench || []];
    this.ref = { team: -1, role: 'REF', x: 50, y: 30, vx: 0, vy: 0, phase: 0, pose: 0, poseT: 0, face: 1, kit: this.refKit, maxSp: 7, look: { skin: 1, hair: 0 }, num: '', ft: null, seed: 3 };
    this.lines = [
      { team: -1, role: 'LIN', x: 30, y: -1.2, vx: 0, vy: 0, phase: 0, pose: 8, poseT: 0, face: 1, kit: this.refKit, maxSp: 7, look: { skin: 2, hair: 1 }, num: '', ft: null, seed: 5 },
      { team: -1, role: 'LIN', x: 75, y: 69.2, vx: 0, vy: 0, phase: 0, pose: 8, poseT: 0, face: -1, kit: this.refKit, maxSp: 7, look: { skin: 0, hair: 3 }, num: '', ft: null, seed: 7 },
    ];
    this.figs = [...this.ps[0], ...this.ps[1], this.ref, ...this.lines];
  }

  setupEvents(events) {
    const vis = ['goal', 'save', 'miss', 'chance', 'offside', 'corner', 'yellow', 'red', 'foul', 'penalty', 'injury', 'sub'];
    this.events = events.filter(e => vis.includes(e.kind)).map(e => ({ ...e })).sort((a, b) => (a.half - b.half) || (a.t - b.t));
    markClips(this.events);
    this.evI = 0;
    const a = this.result.added || [2, 3];
    this.halfEnd = [45 + a[0], 90 + a[1]];
  }

  // Second half was re-simulated at half time (tactical change). Swap in the new timeline.
  replaceSecondHalf(result) {
    this.result = result;
    const done = this.events.filter(e => e.half === 1);
    const vis = ['goal', 'save', 'miss', 'chance', 'offside', 'corner', 'yellow', 'red', 'foul', 'penalty', 'injury', 'sub'];
    const second = result.events.filter(e => e.half === 2 && vis.includes(e.kind)).map(e => ({ ...e }));
    markClips(second);
    this.events = done.concat(second);
    this.evI = done.length;
    this.halfEnd[1] = 90 + (result.added?.[1] ?? 3);
    // apply formation change for user side if any
    result.ht && this.sheets.forEach((sh, k) => {
      const team = result.ht.teams?.[k];
    });
  }
  applyFormation(k, formation) {
    const slots = FORMATIONS[formation]; if (!slots) return;
    const out = this.ps[k].filter(p => !p.off);
    const gk = out.find(p => p.role === 'GK');
    const rest = out.filter(p => p !== gk);
    const roleSlots = slots.map((s, i) => ({ s, i })).filter(o => o.s[0] !== 'GK');
    rest.forEach((p, j) => { const o = roleSlots[j]; if (o) { p.slot = { x: o.s[2], y: o.s[3] }; p.role = o.s[0]; } });
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(320, r.width); this.H = Math.max(200, r.height);
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.g3?.resize(this.W, this.H, dpr);
  }

  makeCrowd() {
    const seats = [];
    const hc = [this.home.colors.primary, this.home.colors.secondary];
    const ac = [this.kits[1].primary, this.kits[1].secondary];
    const neutral = ['#d9d9d9', '#3a3f4b', '#5b6170', '#8a6f5a', '#2f3542', '#a3a9b6', '#6b4f3a', '#e6e1d5'];
    const awayEnd = this.result.seed % 2 ? [-14, 8] : [97, 119];
    for (let r = 0; r < 24; r++) {
      const y = 73 + r * 1.05, z = 0.9 + r * 0.72;
      for (let x = -16; x <= 121; x += 0.78) {
        const jitter = rand(-0.12, 0.12);
        let c;
        const inAway = x > awayEnd[0] && x < awayEnd[1];
        const rr = Math.random();
        if (Math.random() < 0.035) continue; // empty seat
        if (inAway) c = rr < 0.7 ? ac[rr < 0.45 ? 0 : 1] : neutral[(Math.random() * neutral.length) | 0];
        else c = rr < 0.55 ? hc[rr < 0.38 ? 0 : 1] : neutral[(Math.random() * neutral.length) | 0];
        seats.push({ x: x + jitter, y, z, c, ph: Math.random() * 6.28, sk: SKIN[(Math.random() * 6) | 0], away: inAway });
      }
    }
    const groups = {};
    for (const s of seats) (groups[s.c] ||= []).push(s);
    return { seats, groups: Object.entries(groups) };
  }
  makeNoise() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    return this.ctx.createPattern(c, 'repeat');
  }

  // ---------- public controls ----------
  start() {
    this.kickoffPositions(1);
    this.state = 'play';
    this.runScript(this.sKickoff(0, true));
    this.hooks.onClock?.(this.clockLabel());
    this.raf = requestAnimationFrame(this._loop);
  }
  setSpeed(s) { this.speed = s; }
  setCamera(m) { this.camMode = m; }
  pause() { this.paused = true; }
  resume() { this.paused = false; if (this.state === 'halftime') { this.state = 'play'; this.startSecondHalf(); } }
  destroy() { cancelAnimationFrame(this.raf); window.removeEventListener('resize', this._onResize); this.destroyed = true; this.g3?.destroy(); }
  skipToEnd() {
    // jump to the final state instantly
    for (; this.evI < this.events.length; this.evI++) { const e = this.events[this.evI]; this.countEvent(e); if (e.kind === 'goal') { this.score = e.score.slice(); this.hooks.onScore?.(this.score, e); } }
    this.t = this.halfEnd[1]; this.script = null; this.replay = null;
    this.finish();
  }

  // ---------- geometry ----------
  dir(team) { return (team === 0) === (this.half === 1) ? 1 : -1; }
  goalX(team) { return this.dir(team) > 0 ? L : 0; } // goal this team attacks
  toWorld(x, y, d) { return d > 0 ? { x, y } : { x: L - x, y: Wd - y }; }
  prog(team, x) { return this.dir(team) > 0 ? x : L - x; }
  alive(team) { return this.ps[team].filter(p => !p.off); }

  kickoffPositions(kickTeam) {
    for (let k = 0; k < 2; k++) {
      const d = this.dir(k);
      for (const P of this.ps[k]) {
        if (P.off) continue;
        let x = Math.min(P.slot.x * 0.82, 48), y = P.slot.y;
        if (P.role === 'GK') x = 4;
        const w = this.toWorld(x, y, d); P.x = w.x; P.y = w.y; P.vx = P.vy = 0; P.ft = null; P.pose = 0;
      }
    }
    const kt = this.ps[kickTeam].filter(p => !p.off && p.role === 'FW');
    const a = kt[0] || this.alive(kickTeam).slice(-1)[0], b = kt[1] || this.alive(kickTeam).slice(-2)[0];
    const d = this.dir(kickTeam);
    if (a) { a.x = 52.5 - d * 0.4; a.y = 34; }
    if (b && b !== a) { b.x = 52.5 - d * 2.5; b.y = 37; }
    this.ref.x = 46; this.ref.y = 24;
    this.ball = { x: 52.5, y: 34, z: 0, vx: 0, vy: 0, vz: 0, owner: a || null, fl: null, spin: 0 };
    this.possTeam = kickTeam;
  }

  // ---------- main loop ----------
  loop(ts) {
    if (this.destroyed) return;
    const dtReal = Math.min(0.05, this.lastFrame ? (ts - this.lastFrame) / 1000 : 0.016);
    this.lastFrame = ts;
    if (!this.paused && this.state !== 'halftime' && !this.ended) {
      this.stepSting(dtReal);
      if (this.replay) this.stepReplay(dtReal);
      else {
        const sp = (this.speed === 'hl' ? 1 : Math.min(2, this.speed)) * (this.slow || 1);
        const steps = Math.max(1, Math.ceil(sp));
        const dt = dtReal * sp / steps;
        for (let i = 0; i < steps; i++) this.step(dt);
      }
    }
    this.time += dtReal;
    this.updateCamera(dtReal);
    this.render(dtReal);
    this.raf = requestAnimationFrame(this._loop);
  }

  secPerMin() { return 2.3; }

  step(dt) {
    this.simTime = (this.simTime || 0) + dt;
    // clock
    // Highlights only: the clock runs slowly inside a clip and jumps between clips.
    const he = this.halfEnd[this.half - 1];
    if (this.script) this.t = Math.min(this.t + dt * 0.12, he + 0.4);
    const lbl = this.clockLabel();
    if (lbl !== this._lastLbl) { this._lastLbl = lbl; this.hooks.onClock?.(lbl, this.t); }

    if (!this.script && this.state === 'play') {
      let e = this.events[this.evI];
      // minor moments are reported while the interlude clock ticks past them
      const pending = [];
      while (e && e.half === this.half && !e.clip) { pending.push(e); this.evI++; e = this.events[this.evI]; }
      if (e && e.half === this.half) { this.evI++; this.runScript(this.sClip(e, pending)); }
      else this.runScript(this.sHalfOut(pending, he));
    }
    // run script
    if (this.script) this.tickScript(dt);
    if (this.real) this.realPre();
    // AI + physics
    this.updateTargets(dt);
    for (const P of this.figs) this.moveFig(P, dt);
    this.updateBall(dt);
    if (this.real) this.realStep(dt);
    this.updateHeadings(dt);
    // possession stat
    if (this.ball.owner) this.stats.poss[this.ball.owner.team] += dt;
    this.excite = lerp(this.excite, this.exciteTarget(), dt * 0.8);
    this.audio?.setExcitement(this.excite);
    this.record();
    // decay effects
    if (this.netBulge) { this.netBulge.a *= Math.pow(0.08, dt); if (this.netBulge.a < 0.01) this.netBulge = null; }
    for (const P of this.figs) { if (P.poseT > 0) { P.poseT -= dt; if (P.poseT <= 0 && P.pose !== POSE.flag) P.pose = P.role === 'LIN' ? POSE.flag : 0; } }
  }

  updateHeadings(dt) {
    const b = this.ball;
    for (const P of this.figs) {
      const s = P.speed || 0;
      let tgt;
      if (s > 0.7) tgt = Math.atan2(P.vy, P.vx);
      else if (P.role === 'LIN') tgt = P.y < 34 ? Math.PI / 2 : -Math.PI / 2;
      else tgt = Math.atan2(b.y - P.y, b.x - P.x);
      if (P.hd === undefined) { P.hd = tgt; continue; }
      let d = tgt - P.hd; d = Math.atan2(Math.sin(d), Math.cos(d));
      P.hd += d * Math.min(1, dt * (s > 0.7 ? 9 : 4));
    }
  }

  exciteTarget() {
    const b = this.ball, near = Math.min(b.x, L - b.x);
    return clamp(0.18 + (near < 25 ? (25 - near) / 40 : 0) + (this.hype || 0), 0, 1);
  }

  clockLabel() {
    const t = this.t, h = this.half;
    if (h === 1 && t >= 45) return `45+${Math.min(this.halfEnd[0] - 45, Math.floor(t - 45) + 1)}`;
    if (h === 2 && t >= 90) return `90+${Math.min(this.halfEnd[1] - 90, Math.floor(t - 90) + 1)}`;
    return `${Math.floor(t) + (h === 2 && t < 45 ? 45 : 0)}'`;
  }

  // ---------- scripting ----------
  runScript(gen, amb = false) { this.script = gen; this.scriptAmb = amb; this.wait = 0; this.until = null; }
  tickScript(dt) {
    if (this.wait > 0) { this.wait -= dt; return; }
    if (this.until) {
      this.untilT += dt;
      if (!this.until() && this.untilT < 6) return;
      this.until = null;
    }
    for (let guard = 0; guard < 20; guard++) {
      const r = this.script.next();
      if (r.done) { this.script = null; return; }
      const v = r.value;
      if (typeof v === 'number') { this.wait = v; return; }
      if (typeof v === 'function') { if (!v()) { this.until = v; this.untilT = 0; return; } }
    }
  }

  scriptFor(e) {
    switch (e.kind) {
      case 'goal': case 'save': case 'miss': return this.sShot(e);
      case 'chance': return this.sChance(e);
      case 'offside': return this.sOffside(e);
      case 'corner': return this.sCorner(e);
      case 'yellow': case 'red': case 'foul': return this.sFoul(e);
      case 'penalty': return this.sPenalty(e);
      case 'injury': return this.sInjury(e);
      case 'sub': return this.sSub(e);
    }
    return (function* () { })();
  }

  say(kind, e, extra = {}) {
    const team = e ? this.sheets[e.team] : null;
    const opp = e ? this.sheets[1 - e.team] : null;
    const nm = id => this.byId[id]?.name || this.findName(id) || '';
    const txt = commentary(kind, { name: nm(e?.pid), assist: e?.assist ? nm(e.assist) : null, keeper: e?.keeper ? nm(e.keeper) : null, blocker: e?.blocker ? nm(e.blocker) : null, team: team?.name, opp: opp?.name, stadium: this.stadium, header: e?.header, penalty: e?.penalty, long: e?.long, over: e?.over, cleared: e?.cleared, second: e?.second, ...extra });
    if (this.card) this.card.line = `${this.clockLabel()}  ${txt}`;
    this.hooks.onCommentary?.(txt, kind, e, this.clockLabel());
  }
  findName(id) { for (const sh of this.sheets) { const p = [...sh.xi, ...(sh.bench || [])].find(x => x.id === id); if (p) return p.last || p.name; } return null; }

  countEvent(e) {
    const s = this.stats;
    if (['goal', 'save', 'miss', 'chance'].includes(e.kind)) { s.shots[e.team]++; if (e.kind !== 'miss' && e.kind !== 'chance') s.sot[e.team]++; }
    if (e.kind === 'corner') s.corners[e.team]++;
    if (['foul', 'yellow', 'red'].includes(e.kind)) s.fouls[e.team]++;
    if (e.kind === 'yellow') s.yellows[e.team]++;
    this.hooks.onStats?.(this.liveStats());
  }
  liveStats() { const p = this.stats.poss, tot = p[0] + p[1]; return { ...this.stats, possession: [Math.round(p[0] / tot * 100), 100 - Math.round(p[0] / tot * 100)] }; }

  textEvent(e) {
    this.t = Math.max(this.t, e.t);
    if (e.kind === 'sub') { const g = this.sSub(e); g.next(); return; }
    if (['chance', 'save', 'miss', 'corner', 'foul', 'yellow'].includes(e.kind)) this.countEvent(e);
    if (e.kind === 'yellow') { const P = this.byId[e.pid]; this.hooks.onCard?.(e, P?.name || this.findName(e.pid), e.team); }
    if (e.kind === 'corner' && !e.cleared) return;
    this.say(e.kind, e);
  }

  *sHalfOut(pending, he) {
    if (pending.length || he - this.t > 1) yield* this.cut(() => { }, { text: this.half === 1 ? 'Heading for half time' : 'Heading for full time', to: he, pending });
    this.t = Math.max(this.t, he); this.hooks.onClock?.(this.clockLabel(), this.t);
    this.endHalf();
  }
  *sClip(e, pending = []) {
    const atk = ['yellow', 'red', 'foul'].includes(e.kind) ? 1 - e.team : e.team;
    const prevE = this.events[this.evI - 2];
    const linked = prevE && prevE.kind === 'corner' && e.t - prevE.t < 0.6 && prevE.clip;
    const nm = this.sheets[e.team]?.name || '';
    const text = e.kind === 'red' ? 'Trouble is brewing' : e.kind === 'penalty' ? `${nm} break into the box` : e.kind === 'corner' ? `Corner to ${nm}` : `${nm} on the attack`;
    const card = linked ? null : { text, to: e.t - 0.1, pending };
    if (linked) pending.forEach(p => this.textEvent(p));
    yield* this.cut(() => {
      this.t = Math.max(this.t, e.t - 0.1);
      this.hooks.onClock?.(this.clockLabel(), this.t);
      this.celebFocus = null; this.ball.dead = false; this.slow = 1;
      for (const P of this.figs) { if (P.pose !== POSE.flag) P.pose = 0; P.poseT = 0; P.ft = null; P.sprint = false; }
      e.scene = sceneFor(e);
      const prev = this.events[this.evI - 2];
      const afterCorner = prev && prev.kind === 'corner' && e.t - prev.t < 0.6;
      const real = ['goal', 'save', 'miss'].includes(e.kind) && !e.penalty && !afterCorner ? this.pickReal(e) : null;
      this.resetShape(atk, SCENE_DEPTH[e.scene] ?? 0.62);
      if (real) { e.scene = real.tpl.kind; this.setupReal(e, real); }
      else if (SCENE_DEPTH[e.scene] !== undefined && ['goal', 'save', 'miss'].includes(e.kind)) this.setupScene(e);
      this.cam.tzoom = this.baseZoom; this.cam.zoom = this.baseZoom;
    }, card);
    this.inClip = true;
    this.hooks.onClip?.(this.clockLabel(), e);
    this.hype = 0.15;
    yield 0.2;
    yield* this.scriptFor(e);
    this.slow = 1; this.inClip = false;
    yield 0.5;
  }

  // ---- real moves: traced from tracking data of real matches, same build-up for goal, save or miss ----
  pickReal(e) {
    const want = e.header ? t => t.hdr : e.long ? t => !t.hdr && t.dist > 19 : t => !t.hdr && t.dist <= 19;
    let pool = REAL.filter(want);
    this.usedReal ||= new Set();
    const fresh = pool.filter(t => !this.usedReal.has(t.id)); if (fresh.length) pool = fresh;
    if (!pool.length) return null;
    let h = 2166136261; for (const ch of `${e.t.toFixed(3)}|${e.pid}|real|${this.result.seed || 0}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const tpl = pool[h % pool.length]; this.usedReal.add(tpl.id);
    return { tpl, mirror: (h >>> 9) & 1 };
  }
  setupReal(e, { tpl, mirror }) {
    const team = e.team, d = this.dir(team);
    const S = this.shooterOf(e);
    const A = e.assist && this.byId[e.assist] && !this.byId[e.assist].off && this.byId[e.assist] !== S ? this.byId[e.assist] : null;
    const my = v => mirror ? Wd - v : v;
    const map = new Map();
    const assign = (figs, tracks, fixed) => {
      const usedT = new Set();
      const put = (f, t) => { if (f && t && !map.has(f) && !usedT.has(t)) { map.set(f, t); usedT.add(t); } };
      for (const [f, t] of fixed) put(f, t);
      put(figs.find(p => p.role === 'GK'), tracks.find(t => t.gk));
      const nf = figs.filter(f => !map.has(f) && f.role !== 'GK'), nt = tracks.filter(t => !usedT.has(t) && !t.gk);
      if (!nf.length || !nt.length) return;
      const st = (arr, g) => { const v = arr.map(g), m = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; return x => (x - m) / sd; };
      const fx = st(nf, f => f.slot.x), fy = st(nf, f => f.slot.y), tx = st(nt, t => t.r[0]), ty = st(nt, t => my(t.r[1]));
      const pairs = [];
      for (const f of nf) for (const t of nt) pairs.push([(fx(f.slot.x) - tx(t.r[0])) ** 2 + (fy(f.slot.y) - ty(my(t.r[1]))) ** 2, f, t]);
      pairs.sort((a, b) => a[0] - b[0]);
      for (const [, f, t] of pairs) put(f, t);
    };
    assign(this.alive(team), tpl.att, [[S, tpl.att.find(t => t.s)], [A, tpl.att.find(t => t.a)]]);
    assign(this.alive(1 - team), tpl.dfn, []);
    const start = Math.max(0, tpl.shot - 45); // at most 9 s of build-up
    const attFig = tpl.att.map(t => [...map].find(([, tt]) => tt === t)?.[0] || null);
    this.real = { tpl, map, attFig, mirror, d, team, f: start, start, tk: tpl.tch.findIndex(t => t[0] >= start) };
    if (this.real.tk < 0) this.real.tk = tpl.tch.length;
    for (const [P, t] of map) { const w = this.realPos(t.p, start); P.x = w.x; P.y = w.y; P.vx = P.vy = 0; P.ft = null; P.sprint = false; P.pose = 0; }
    const b = this.ball, w = this.realPos(tpl.ball, start);
    b.owner = null; b.fl = null; b.x = w.x; b.y = w.y; b.z = 0; b.dead = false;
    this.possTeam = team;
    e._real = { S, tpl };
  }
  realPos(p, f) {
    const R = this.real, n = p.length / 2;
    const i = clamp(Math.floor(f), 0, n - 1), u = clamp(f - i, 0, 1);
    const g = (k, o) => p[clamp(k, 0, n - 1) * 2 + o] / 10;
    const cr = o => { const p0 = g(i - 1, o), p1 = g(i, o), p2 = g(i + 1, o), p3 = g(i + 2, o); return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u); };
    const x = cr(0), y = R.mirror ? Wd - cr(1) : cr(1);
    return this.toWorld(x, y, R.d);
  }
  realPre() { for (const P of this.real.map.keys()) { P.px = P.x; P.py = P.y; } }
  realStep(dt) {
    const R = this.real, tpl = R.tpl, b = this.ball;
    R.f += dt * 5;
    const f = Math.min(R.f, tpl.shot);
    for (const [P, t] of R.map) {
      if (P.off) continue;
      const w = this.realPos(t.p, f);
      P.x = w.x; P.y = w.y;
      const vx = (P.x - (P.px ?? P.x)) / Math.max(dt, 1e-3), vy = (P.y - (P.py ?? P.y)) / Math.max(dt, 1e-3);
      P.vx = lerp(P.vx, vx, 0.5); P.vy = lerp(P.vy, vy, 0.5);
      const s = Math.hypot(P.vx, P.vy); P.speed = s; P.phase += s * dt * (3.0 - 0.17 * Math.min(s, 9));
      if (Math.abs(P.vx) > 0.4) P.face = P.vx > 0 ? 1 : -1; else if (s < 0.4) P.face = b.x > P.x ? 1 : -1;
      P.tx = P.x; P.ty = P.y;
    }
    // touches: kick poses and lofted balls
    while (R.tk < tpl.tch.length && tpl.tch[R.tk][0] <= f) {
      const [, ai, kind, , , head] = tpl.tch[R.tk]; const P = R.attFig[ai];
      if (P && kind !== 'shot') { P.pose = head ? POSE.header : POSE.kick; P.poseT = 0.25; this.audio?.kick(0.3); this.lastTouch = P; }
      R.tk++;
    }
    const w = this.realPos(tpl.ball, f);
    const px = b.x, py = b.y;
    // tracking puts the ball on the carrier's position: keep it in front of their feet instead
    const w2 = this.realPos(tpl.ball, f + 0.5), bsp = Math.hypot(w2.x - w.x, w2.y - w.y) * 10;
    let car = null, cd = 1.8;
    for (const P of R.map.keys()) { if (P.team !== R.team || P.off) continue; const dd = Math.hypot(P.x - w.x, P.y - w.y); if (dd < cd) { cd = dd; car = P; } }
    this.realCarrier = car && cd < 1.2 ? car : null;
    if (car && bsp < 10 && car.speed > 0.3) {
      const k = 1 - cd / 1.8, ux = car.vx / car.speed, uy = car.vy / car.speed;
      const touch = (Math.sin(car.phase * 0.5) * 0.5 + 0.5) * 0.35;
      w.x = lerp(w.x, car.x + ux * (0.8 + touch), k); w.y = lerp(w.y, car.y + uy * (0.8 + touch), k);
    }
    b.x = w.x; b.y = w.y;
    let z = 0;
    for (let k = 0; k < tpl.tch.length; k++) {
      const [fi, , kind, fe, lofted] = tpl.tch[k];
      if (kind !== 'pass' || !lofted || f < fi || f > fe || fe <= fi) continue;
      const u = (f - fi) / (fe - fi);
      const nx = tpl.tch[k + 1], endZ = nx && (nx[5] || (nx[2] === 'shot' && tpl.hdr)) ? 2 : 0;
      const a = this.realPos(tpl.ball, fi), c = this.realPos(tpl.ball, fe);
      const h = clamp(Math.hypot(c.x - a.x, c.y - a.y) * 0.09, 1, 6);
      z = endZ * u + h * 4 * u * (1 - u);
    }
    b.z = z;
    b.spin += Math.hypot(b.x - px, b.y - py) * 2;
    // the camera tightens as the move reaches the box
    const prog = this.prog(R.team, b.x);
    this.cam.tzoom = this.baseZoom * (1.3 + clamp((prog - 55) / 40, 0, 1) * 0.3);
    this.hype = clamp((prog - 60) / 120, 0, 0.3);
    if (R.f >= tpl.shot) {
      this.real = null;
      for (const P of R.map.keys()) { P.ft = { x: clamp(P.x + P.vx * 0.8, 0, L), y: clamp(P.y + P.vy * 0.8, 0, Wd) }; P.sprint = Math.hypot(P.vx, P.vy) > 5; }
    }
  }
  *playReal(e) {
    while (this.real) yield 0.05;
    const S = e._real.S, b = this.ball;
    b.owner = S; b.fl = null; b.x = S.x + (S.face || 1) * 0.4; b.y = S.y;
  }

  wp(team, x, y) { return this.toWorld(clamp(x, 1, 104), clamp(y, 1, 67), this.dir(team)); }
  shooterOf(e) { const s = this.byId[e.pid]; return s && !s.off ? s : this.alive(e.team).find(p => p.role === 'FW') || this.alive(e.team)[10]; }
  helperOf(e, S) {
    const a = e.assist && this.byId[e.assist];
    if (a && !a.off && a !== S && a.role !== 'GK') return a;
    return this.alive(e.team).filter(p => p !== S && p.role === 'MF')[0] || this.alive(e.team).find(p => p !== S && p.role !== 'GK');
  }
  // ---- scene library: real attacking patterns, identical for goal, miss and save ----
  squad(team) {
    const al = this.alive(team);
    const d = this.dir(team);
    const ay = P => (d > 0 ? P.slot.y : P.slot.y); // slot y is in attacking-right coords already
    return { al, gk: al.find(p => p.role === 'GK'), df: al.filter(p => p.role === 'DF'), mf: al.filter(p => p.role === 'MF'), fw: al.filter(p => p.role === 'FW'), ay };
  }
  wideOf(list, side) { return list.slice().sort((a, b) => side * (b.slot.y - a.slot.y))[0]; }
  centralOf(list, not = []) { return list.filter(p => !not.includes(p)).sort((a, b) => Math.abs(a.slot.y - 34) - Math.abs(b.slot.y - 34))[0]; }
  setupScene(e) {
    const team = e.team, sc = e.scene;
    const side = ((e.t * 131) | 0) % 2 ? 1 : -1;
    const S = this.shooterOf(e), sq = this.squad(team);
    const others = l => l.filter(p => p !== S);
    const place = (P, x, y) => { if (!P) return; const w = this.wp(team, x, y); P.x = w.x; P.y = w.y; P.vx = P.vy = 0; };
    const cast = { S, side };
    const wingMF = this.wideOf(others([...sq.mf, ...sq.fw]), side) || others(sq.mf)[0];
    const fb = this.wideOf(sq.df, side);
    const dm = this.centralOf(others(sq.mf), [wingMF]) || others(sq.df)[0];
    const fw2 = others(sq.fw)[0] || this.centralOf(others(sq.mf), [wingMF, dm]);
    if (sc === 'through') {
      cast.A = this.centralOf(others(sq.mf), [dm]) || wingMF; cast.B = dm;
      place(cast.B, 56, 34 - side * 4); place(cast.A, 67, 34 + side * 7); place(S, 80, 34 - side * 5); place(fw2 !== S ? fw2 : null, 79, 34 + side * 12);
      cast.ball = cast.B;
    } else if (sc === 'overlap') {
      cast.W = wingMF !== S ? wingMF : others(sq.mf)[0]; cast.F = fb;
      place(cast.W, 72, 34 + side * 22); place(cast.F, 60, 34 + side * 28); place(S, 82, 34 + side * 2); place(fw2 !== S ? fw2 : null, 83, 34 - side * 7);
      cast.ball = cast.W;
    } else if (sc === 'cutback') {
      cast.W = wingMF !== S ? wingMF : others(sq.fw)[0] || others(sq.mf)[0]; cast.R = fw2 !== S ? fw2 : others(sq.fw)[0];
      place(cast.W, 76, 34 + side * 24); place(cast.R, 84, 34 + side * 3); place(S, 76, 34 - side * 2);
      cast.ball = cast.W;
    } else if (sc === 'onetwo') {
      cast.T = fw2 !== S ? fw2 : others(sq.fw)[0] || others(sq.mf)[0]; cast.B = dm;
      place(cast.B, 62, 34 - side * 3); place(S, 72, 34 + side * 6); place(cast.T, 83, 34);
      cast.ball = cast.B;
    } else if (sc === 'long') {
      cast.A = wingMF !== S ? wingMF : others(sq.mf)[0]; cast.B = this.centralOf(others(sq.mf), [cast.A]) || dm;
      place(cast.A, 77, 34 + side * 15); place(cast.B, 74, 34 + side * 3); place(S, 76, 34 - side * 9);
      cast.ball = cast.A;
    } else if (sc === 'counter') {
      cast.D = this.centralOf(sq.df) || sq.df[0]; cast.M = dm; cast.R = fw2 !== S ? fw2 : others(sq.mf)[0];
      place(cast.D, 30, 34 + side * 6); place(cast.M, 42, 34 - side * 2); place(S, 54, 34 - side * 18); place(cast.R, 55, 34 + side * 10);
      cast.ball = cast.D;
    }
    // defending team: compact block, or caught upfield on the counter
    const opp = this.squad(1 - team);
    const ox = (x) => sc === 'counter' ? x - 32 : x; // attacker-coords x
    opp.df.forEach((P, i, a) => place(P, ox(86 - (i === 0 || i === a.length - 1 ? 1.5 : 0)), 34 + (i - (a.length - 1) / 2) * 10));
    opp.mf.forEach((P, i, a) => place(P, ox(77), 34 + (i - (a.length - 1) / 2) * 11));
    opp.fw.forEach((P, i) => place(P, ox(58), 30 + i * 8));
    if (opp.gk) place(opp.gk, 102.5, 34);
    const b = this.ball, H = cast.ball || S;
    b.owner = H; b.fl = null; b.z = 0; b.x = H.x; b.y = H.y; H.hold = 99;
    this.possTeam = team;
    e._cast = cast;
  }
  // attackers fill the box: near post, back post, penalty spot, edge
  boxRuns(team, side, skip = []) {
    const zones = [[93, 34 + side * 4], [94, 34 - side * 7], [88, 34], [79, 34 - side * 3]];
    const runners = this.alive(team).filter(p => p.role !== 'GK' && p.role !== 'DF' && !skip.includes(p) && p !== this.ball.owner)
      .sort((a, b) => this.prog(team, b.x) - this.prog(team, a.x)).slice(0, 4);
    runners.forEach((P, i) => { const z = zones[i]; P.ft = this.wp(team, z[0] + rand(-1, 1), z[1] + rand(-1.5, 1.5)); P.sprint = true; });
  }
  *playScene(e, S) {
    const team = e.team, b = this.ball, c = e._cast || { side: 1 };
    const side = c.side;
    const near = (P, pt, r = 2) => () => !P || Math.hypot(P.x - pt.x, P.y - pt.y) < r;
    const P = this.wp.bind(this, team);
    const dribble = (Pl, pt) => { Pl.ft = pt; Pl.sprint = true; };
    switch (e.scene) {
      case 'through': { // pivot finds the No.10 between the lines, who slides a pass behind the back line
        yield 0.25;
        yield* this.pass(c.A, { to: P(69, 34 + side * 5) });
        c.A.ft = P(72, 34 + side * 3); yield 0.35;
        dribble(S, P(83, 34 - side * 1)); yield 0.3;
        this.boxRuns(team, side, [S, c.A]);
        const run = P(91, 34 + side * 2);
        S.ft = run;
        yield* this.pass(S, { to: run, speed: 19 });
        S.ft = P(93, 34 + side * 1.5); yield 0.25; break;
      }
      case 'overlap': { // winger drives inside, full-back overlaps, cross into the box
        dribble(c.W, P(76, 34 + side * 15)); dribble(c.F, P(86, 34 + side * 29));
        yield 0.8;
        yield* this.pass(c.F, { to: P(88, 34 + side * 29), speed: 17 });
        this.boxRuns(team, side, [S, c.F]);
        const target = e.header ? P(93, 34 + side * 2) : P(91, 34 - side * 3);
        S.ft = target; S.sprint = true;
        dribble(c.F, P(93, 34 + side * 29)); yield 0.45;
        yield* this.pass(S, { to: target, lofted: true, speed: 21, z1: e.header ? 2.0 : 0.6 });
        if (e.header) { S.pose = POSE.header; S.poseT = 0.6; b.z = 2.0; }
        break;
      }
      case 'cutback': { // winger beats his full-back to the byline, decoy run to the near post, pull-back to the spot
        dribble(c.W, P(79, 34 + side * 19)); yield 0.35; // shape inside
        const by = P(100.5, 34 + side * 15);
        dribble(c.W, by);
        if (c.R) { c.R.ft = P(94, 34 + side * 3); c.R.sprint = true; }
        S.ft = P(88, 34 + side * 1); S.sprint = true;
        yield near(c.W, by, 2.5);
        yield* this.pass(S, { to: P(88.5, 34 + side * 1), speed: 18 });
        break;
      }
      case 'onetwo': { // wall pass at the edge of the box
        yield 0.25;
        yield* this.pass(S, { to: P(74, 34 + side * 5) });
        yield 0.2;
        yield* this.pass(c.T, { to: P(81, 34 + side * 1) });
        dribble(S, P(87, 34 + side * 4)); this.boxRuns(team, side, [S, c.T]);
        yield 0.15;
        yield* this.pass(S, { to: P(88, 34 + side * 4), speed: 15 });
        break;
      }
      case 'long': { // patient circulation across the top of the box, then a strike
        this.boxRuns(team, side, [S, c.A, c.B]);
        yield 0.3;
        yield* this.pass(c.B, { to: P(75, 34 + side * 2) });
        yield 0.2;
        yield* this.pass(S, { to: P(76, 34 - side * 8) });
        S.ft = P(78, 34 - side * 6); yield 0.4; break;
      }
      case 'counter': { // win it deep, break at speed, finish 3 v 2
        dribble(S, P(70, 34 - side * 19)); if (c.R) dribble(c.R, P(72, 34 + side * 8));
        yield 0.2;
        yield* this.pass(c.M, { to: P(46, 34 - side * 2) });
        c.M.ft = P(50, 34); yield 0.25;
        const recv = P(70, 34 - side * 18);
        yield* this.pass(S, { to: recv, lofted: true, speed: 22 });
        const cut = P(88, 34 - side * 7);
        dribble(S, cut); if (c.R) dribble(c.R, P(90, 34 + side * 5));
        yield near(S, cut, 2.2);
        break;
      }
    }
  }

  *sKickoff(team, first) {
    this.kickoffPositions(team);
    this.hype = 0;
    yield 0.6;
    this.audio?.whistle(1);
    if (first) this.say(this.half === 1 ? 'kickoff' : 'second', { team }, {});
    yield 0.3;
    const mates = this.alive(team).filter(p => p !== this.ball.owner && p.role === 'MF');
    if (mates.length && this.ball.owner) yield* this.pass(mates[(Math.random() * mates.length) | 0], { short: true });
  }

  *sCutAhead(target) {
    yield* this.cut(() => {
      this.t = target;
      const e = this.events[this.evI];
      const team = e ? (['yellow', 'red', 'foul'].includes(e.kind) ? 1 - e.team : e.team) : this.possTeam;
      this.resetShape(team, 0.45);
    });
  }
  resetShape(team, depth = 0.5) {
    // teleport into a typical midfield phase with `team` in possession
    this.possTeam = team;
    const bx = this.dir(team) > 0 ? L * depth : L * (1 - depth);
    this.ball.x = bx; this.ball.y = rand(20, 48); this.ball.fl = null; this.ball.z = 0;
    for (const P of [...this.ps[0], ...this.ps[1]]) { if (P.off) continue; const t = this.baseTarget(P); P.x = t.x; P.y = t.y; P.vx = P.vy = 0; P.ft = null; P.pose = 0; }
    const carrier = this.nearest(team, this.ball, p => p.role === 'MF') || this.nearest(team, this.ball);
    this.ball.owner = carrier; carrier.x = this.ball.x; carrier.y = this.ball.y; carrier.hold = 0.5;
  }

  *cut(fn, card = null) {
    this.fadeTarget = 1;
    yield () => this.fade > 0.95;
    fn();
    if (card) {
      // the interlude: a big match clock ticks on to the next highlight
      this.card = card;
      const t0 = this.t, t1 = Math.max(t0, card.to), dur = clamp((t1 - t0) * 0.08, 0.8, 2.4);
      const todo = card.pending.slice();
      let u = 0;
      while (u < 1) {
        yield 0.03;
        u = Math.min(1, u + 0.03 / dur);
        this.t = Math.max(this.t, lerp(t0, t1, 1 - Math.pow(1 - u, 2)));
        while (todo.length && todo[0].t <= this.t) { const p = todo.shift(); this.textEvent(p); card.tick = this.clockLabel(); }
        this.hooks.onClock?.(this.clockLabel(), this.t);
      }
      while (todo.length) this.textEvent(todo.shift());
      yield 0.45;
      this.card = null;
    }
    this.camSnap = this.camSnap3d = true;
    this.fadeTarget = 0;
    yield 0.15;
  }

  *gainPossession(team) {
    const b = this.ball;
    if (b.owner && b.owner.team === team && !b.fl) return;
    if (b.fl) yield () => !b.fl;
    if (b.owner && b.owner.team === team) return;
    // interception / tackle
    const owner = b.owner;
    const thief = this.nearest(team, b, p => p.role !== 'GK');
    if (!thief) return;
    thief.ft = { x: b.x, y: b.y }; thief.sprint = true;
    yield () => dist(thief, b) < 1.6;
    if (owner && Math.random() < 0.5) { owner.pose = POSE.down; owner.poseT = 0.7; }
    b.owner = thief; b.fl = null; this.possTeam = team; thief.ft = null;
    this.audio?.kick(0.2);
    yield 0.25;
  }

  // pass to a teammate; returns when the ball arrives
  *pass(rec, { lofted = false, to = null, short = false, speed = null, z1 = null } = {}) {
    const b = this.ball;
    if (!b.owner) yield () => !!b.owner;
    const from = b.owner; if (!from || from === rec) return;
    const target = to || { x: clamp(rec.x + rec.vx * 0.7, 1, L - 1), y: clamp(rec.y + rec.vy * 0.7, 1, Wd - 1) };
    const d = Math.hypot(target.x - from.x, target.y - from.y);
    const sp = speed || (lofted ? 17 + d * 0.12 : 12 + d * 0.28);
    rec.ft = target; rec.sprint = true;
    this.kick(target, { speed: sp, arc: lofted ? 1.4 + d * 0.13 : d > 26 ? 0.9 : 0.12, rec, z1: z1 ?? (lofted ? rand(0.4, 1.2) : 0) });
    from.pose = POSE.kick; from.poseT = 0.25;
    yield () => !b.fl;
    rec.ft = null; rec.sprint = false;
  }

  kick(target, { speed = 15, arc = 0.2, rec = null, z1 = 0, onArrive = null, power = 0.4 }) {
    const b = this.ball;
    const d = Math.max(0.5, Math.hypot(target.x - b.x, target.y - b.y, (target.z || 0) - b.z));
    b.fl = { x0: b.x, y0: b.y, z0: b.z, x1: target.x, y1: target.y, z1: target.z ?? z1, t: 0, dur: d / speed, h: arc, rec, onArrive };
    if (b.owner) this.lastTouch = b.owner;
    b.owner = null;
    if (rec) this.possTeam = rec.team;
    this.audio?.kick(power);
  }

  // build-up: pass along the chain moving into the attacking third
  *buildUp(e, finalists = []) {
    const team = e.team;
    yield* this.gainPossession(team);
    const chain = (e.build || []).map(id => this.byId[id]).filter(p => p && !p.off && p.team === team && !finalists.includes(p));
    const d = this.dir(team);
    let n = 0;
    for (const p of chain) {
      if (this.ball.owner === p) continue;
      // push receiver forward into space
      const prog = this.prog(team, this.ball.x);
      const px = clamp(prog + rand(8, 18), 30, 82);
      const w = this.toWorld(px, clamp(p.slot.y + rand(-8, 8), 6, 62), d);
      yield* this.pass(p, { to: w, lofted: Math.random() < 0.15 });
      yield rand(0.15, 0.4);
      if (++n >= 1) break;
    }
  }

  shotSpot(e, shooter) {
    const team = e.team, d = this.dir(team);
    const distG = e.penalty ? 11 : e.header ? rand(5, 9) : e.long ? rand(21, 28) : rand(9, 18);
    const y = 34 + (e.header ? rand(-4, 4) : rand(-11, 11));
    return this.toWorld(L - distG, y, d);
  }

  *sShot(e) {
    this.countEvent(e);
    const team = e.team, d = this.dir(team), gx = this.goalX(team);
    const shooter = e._real ? e._real.S : this.byId[e.pid] && !this.byId[e.pid].off ? this.byId[e.pid] : this.alive(team).find(p => p.role === 'FW') || this.alive(team)[0];
    const keeper = this.alive(1 - team).find(p => p.role === 'GK');
    const assist = e.assist && this.byId[e.assist] && !this.byId[e.assist].off ? this.byId[e.assist] : null;
    this.cam.tzoom = this.baseZoom * 1.15;
    if (e._real) {
      yield* this.playReal(e);
    } else if (e.scene && e.scene !== 'corner' && e.scene !== 'penalty') {
      yield* this.playScene(e, shooter);
    } else if (e.penalty) {
      yield 1.0;
    } else {
      // header from a corner cross: shooter is in the box already
      if (!this.ball.fl && this.ball.owner !== shooter) {
        const spot = this.shotSpot(e, shooter);
        shooter.ft = spot;
        yield* this.pass(shooter, { to: spot, lofted: true, speed: 19 });
      }
    }
    // the shot
    const b = this.ball;
    if (b.owner !== shooter) { b.owner = shooter; b.fl = null; b.x = shooter.x; b.y = shooter.y; }
    const aimY = 34 + clamp(e.aimY ?? 0, -1.7, 1.7) * (GOAL_HW - 0.35);
    const aimZ = e.over ? rand(2.7, 4.2) : e.header ? rand(0.2, 1.6) : clamp((e.aimZ ?? 0.3) * 2.1, 0.12, 2.2);
    const lineX = gx;
    const target = { x: lineX, y: aimY, z: aimZ };
    shooter.pose = e.header ? POSE.header : POSE.kick; shooter.poseT = 0.4;
    const power = e.long ? 31 : e.header ? 15 : e.penalty ? 25 : rand(23, 29);
    if (e.header) { b.z = 2.1; }
    this.kick(target, { speed: power, arc: e.long ? 1.2 : 0.3, power: 1 });
    this.shotAbs = (this.recBase || 0) + this.rec.length;
    if (this.inClip && !e.penalty) { this.audio?.rise?.(); this.hooks.onShot?.(e, shooter.name); }
    this.shotTrail = true;
    this.cam.tzoom = this.baseZoom * 1.3;
    if (this.inClip) this.slow = 0.45;
    this.hype = 0.35;
    // keeper reaction
    if (keeper) {
      const reach = e.kind === 'save' ? aimY : lerp(34, aimY, rand(0.35, 0.75));
      keeper.ft = { x: lineX - d * 0.8, y: clamp(reach, 30.5, 37.5) };
      keeper.sprint = true;
      const tReach = b.fl.dur * 0.55;
      setTimeoutSim(this, tReach, () => {
        if (Math.abs(aimY - keeper.y) > 0.8 || aimZ > 1.6) { keeper.pose = POSE.dive; keeper.poseT = 1.3; keeper.diveDir = Math.sign(aimY - keeper.y) * (keeper.team === 0 ? 1 : 1) || 1; keeper.diveH = aimZ; }
      });
    }
    yield () => !b.fl;
    this.shotTrail = false;
    if (e.kind !== 'goal') setTimeoutSim(this, 0.35, () => { this.slow = 1; });
    if (e.kind === 'goal') {
      // into the net
      this.kick({ x: lineX + d * 1.7, y: aimY + rand(-0.3, 0.3), z: Math.min(aimZ, 1.9) * 0.7 }, { speed: 9, arc: 0.1, power: 0.1 });
      this.netBulge = { x: lineX + d * 1.7, y: aimY, z: aimZ, a: 1, d };
      yield () => !b.fl;
      this.goalAbs = (this.recBase || 0) + this.rec.length;
      this.slow = 1;
      b.vx = b.vy = 0; b.z = 0; b.dead = true;
      this.score = e.score.slice();
      this.goalMoment = this.rec.length;
      this.flash = 1; this.hype = 0.8;
      this.audio?.roar(true);
      this.spawnConfetti(this.kits[team]);
      this.hooks.onScore?.(this.score, e);
      this.say('goal', e);
      this.hooks.onGoal?.(e, this.byId[e.pid]?.name || this.findName(e.pid), team);
      yield 0.6;
      yield* this.celebrate(team, shooter);
      if (!this.demo) yield* this.doReplay();
      this.hype = 0;
      b.dead = false;
      return;
    }
    if (e.kind === 'save') {
      this.audio?.roar(false);
      this.say('save', e);
      if (keeper && (e.parry || e.corner)) {
        this.kick({ x: lineX - d * rand(-0.5, 1), y: aimY > 34 ? rand(40, 50) : rand(18, 28), z: 0 }, { speed: 10, arc: 1.5, power: 0.3 });
        yield () => !b.fl;
        this.looseBall(rand(1, 3));
        if (e.corner) { this.hype = 0.2; yield 0.6; return; }
      } else if (keeper) { b.owner = keeper; b.fl = null; keeper.pose = POSE.dive; keeper.poseT = 0.7; }
      yield 1.0;
      this.hype = 0;
      if (b.owner === keeper) yield* this.keeperDistribute(keeper);
      return;
    }
    // miss
    this.audio?.groan();
    this.say('miss', e);
    this.kick({ x: lineX + d * 4, y: aimY + (aimY - 34) * 0.3, z: e.over ? aimZ + 0.5 : 0.2 }, { speed: 14, arc: 0.2, power: 0 });
    yield () => !b.fl;
    for (const P of this.alive(team)) if (Math.random() < 0.5) { P.pose = POSE.dejected; P.poseT = 1.4; }
    yield 1.1;
    this.hype = 0;
    if (e.corner) return;
    // goal kick
    yield* this.cut(() => {
      const k = keeper || this.alive(1 - team)[0];
      const w = { x: lineX - d * 5.5, y: 34 + rand(-6, 6) };
      b.x = w.x; b.y = w.y; b.z = 0; b.vx = b.vy = 0; b.fl = null; b.owner = k; k.x = w.x - d * 0.6; k.y = w.y;
      this.possTeam = 1 - team;
    });
    yield 0.6;
    if (keeper) yield* this.keeperDistribute(keeper);
  }

  *keeperDistribute(k) {
    const b = this.ball; if (b.owner !== k) return;
    yield 0.5;
    const team = k.team, d = this.dir(team);
    const mates = this.alive(team).filter(p => p !== k);
    const long = Math.random() < 0.55;
    const rec = long ? mates.filter(p => p.role !== 'DF').sort(() => Math.random() - 0.5)[0] : mates.filter(p => p.role === 'DF')[0];
    if (!rec) return;
    const to = long ? this.toWorld(rand(45, 62), rand(15, 53), d) : null;
    yield* this.pass(rec, { lofted: long, to });
  }

  *celebrate(team, scorer) {
    const corner = { x: this.goalX(team) - this.dir(team) * 4, y: 3 };
    scorer.ft = corner; scorer.sprint = true; scorer.pose = POSE.celebrate; scorer.poseT = 4;
    this.celebFocus = scorer;
    this.cam.tzoom = this.baseZoom * 1.4;
    for (const P of this.alive(team)) if (P !== scorer && P.role !== 'GK') { P.ft = { x: corner.x - this.dir(team) * rand(1, 6), y: corner.y + rand(1, 6) }; P.sprint = true; P.pose = POSE.celebrate; P.poseT = rand(1, 3.5); }
    for (const P of this.alive(1 - team)) { P.pose = POSE.dejected; P.poseT = 4; P.ft = null; }
    yield 1.4;
    this.celebFocus = null;
    for (const P of [...this.ps[0], ...this.ps[1]]) { P.ft = null; P.sprint = false; }
  }

  *doReplay() {
    // replay the build-up and the finish (not the celebration), in and out with a TV stinger
    const base = this.recBase || 0, n = this.rec.length;
    const shot = (this.shotAbs ?? base + n) - base, goal = (this.goalAbs ?? base + n) - base;
    const from = clamp(shot - 60 * 4.5, 0, n - 1), to = clamp(goal + 40, 0, n);
    const frames = this.rec.slice(from, to);
    if (frames.length < 30) return;
    const slowAt = shot - from - 50;
    yield* this.stingCut(() => { this.replay = { frames, i: 0, speed: 0.85, slowAt, zoom: 1.6 }; this.hooks.onReplay?.(true); });
    while (this.replay) yield 0.05;
    this.hooks.onReplay?.(false);
  }
  *stingCut(fn) {
    this.sting = { p: 0, fn, fired: false };
    while (this.sting && !this.sting.fired) yield 0.02;
  }
  stepSting(dt) {
    const st = this.sting; if (!st) return;
    st.p += dt / 0.9;
    if (!st.fired && st.p >= 0.5) { st.fired = true; this.camSnap = this.camSnap3d = true; st.fn?.(); }
    if (st.p >= 1) this.sting = null;
  }
  drawSting(ctx) {
    const st = this.sting; if (!st) return;
    const W = this.W, H = this.H, p = st.p;
    const e = p < 0.5 ? 1 - Math.pow(1 - p * 2, 3) : 1 + Math.pow((p - 0.5) * 2, 3); // ease in to centre, then out
    const cx = lerp(-W * 1.1, W * 2.1, e / 2);
    const skew = H * 0.5, bw = W * 1.5;
    const band = (off, w, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx + off - w / 2 + skew, 0); ctx.lineTo(cx + off + w / 2 + skew, 0); ctx.lineTo(cx + off + w / 2 - skew, H); ctx.lineTo(cx + off - w / 2 - skew, H); ctx.closePath(); ctx.fill(); };
    band(-bw * 0.62, W * 0.12, '#e01b24');
    band(0, bw, '#ffb627');
    band(bw * 0.58, W * 0.08, '#0b1220');
    ctx.save();
    ctx.fillStyle = '#0b1220'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(H * 0.16)}px "Big Shoulders Display", "Barlow Condensed", sans-serif`;
    ctx.fillText('REPLAY', cx, H / 2);
    ctx.restore();
  }
  drawCard(ctx) {
    const c = this.card; if (!c || this.fade < 0.3) return;
    const W = this.W, H = this.H, a = clamp((this.fade - 0.3) / 0.6, 0, 1);
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const s = Math.min(W / 900, H / 500);
    ctx.fillStyle = '#ffb627'; ctx.font = `900 ${Math.round(64 * s)}px "Big Shoulders Display", "Barlow Condensed", sans-serif`;
    ctx.fillText(this.clockLabel(), W / 2, H / 2 - 52 * s);
    ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(34 * s)}px "Barlow Condensed", sans-serif`;
    ctx.fillText(`${this.home.short}  ${this.score[0]} – ${this.score[1]}  ${this.away.short}`, W / 2, H / 2 + 8 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `600 ${Math.round(20 * s)}px "Barlow", sans-serif`;
    ctx.fillText(c.text, W / 2, H / 2 + 48 * s);
    ctx.fillStyle = '#ffb627'; ctx.fillRect(W / 2 - 40 * s, H / 2 + 72 * s, 80 * s, 3 * s);
    if (c.line) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `500 ${Math.round(17 * s)}px "Barlow", sans-serif`; ctx.fillText(c.line, W / 2, H / 2 + 102 * s); }
    ctx.restore();
  }

  *sChance(e) {
    this.countEvent(e);
    const team = e.team, d = this.dir(team);
    const shooter = this.byId[e.pid] && !this.byId[e.pid].off ? this.byId[e.pid] : this.alive(team)[9];
    const blocker = e.blocker && this.byId[e.blocker] && !this.byId[e.blocker].off ? this.byId[e.blocker] : this.nearest(1 - team, { x: this.goalX(team), y: 34 }, p => p.role !== 'GK');
    if (!shooter) return;
    this.cam.tzoom = this.baseZoom * 1.1;
    const spot = this.shotSpot({ ...e, long: Math.random() < 0.3 }, shooter);
    shooter.ft = spot; shooter.sprint = true;
    yield* this.buildUp(e, [shooter]);
    if (this.ball.owner !== shooter) yield* this.pass(shooter, { to: spot });
    if (blocker) { blocker.ft = { x: lerp(shooter.x, this.goalX(team), 0.15), y: lerp(shooter.y, 34, 0.15) }; blocker.sprint = true; }
    yield 0.35;
    const b = this.ball;
    if (b.owner !== shooter) { b.owner = shooter; b.fl = null; }
    shooter.pose = POSE.kick; shooter.poseT = 0.3;
    const bp = blocker ? { x: blocker.x, y: blocker.y, z: 0.6 } : { x: lerp(shooter.x, this.goalX(team), 0.2), y: shooter.y, z: 0.5 };
    this.kick(bp, { speed: 24, arc: 0.1, power: 0.9 });
    yield () => !b.fl;
    this.audio?.groan();
    this.say('chance', e);
    if (blocker) { blocker.pose = POSE.down; blocker.poseT = 0.6; }
    this.kick({ x: b.x - d * rand(6, 15), y: clamp(b.y + rand(-15, 15), 3, 65), z: 0 }, { speed: 13, arc: 2.5, power: 0.4 });
    yield () => !b.fl;
    this.looseBall(rand(2, 4));
    yield 0.6;
  }

  *sOffside(e) {
    const team = e.team, d = this.dir(team);
    const fw = this.byId[e.pid] && !this.byId[e.pid].off ? this.byId[e.pid] : this.alive(team).find(p => p.role === 'FW');
    if (!fw) return;
    yield* this.buildUp(e, [fw]);
    const spot = this.toWorld(rand(86, 94), rand(24, 44), d);
    fw.ft = spot; fw.sprint = true;
    yield* this.pass(fw, { to: spot, lofted: Math.random() < 0.5 });
    this.audio?.whistle(1);
    const lin = this.lines.reduce((a, l) => (Math.abs(l.x - fw.x) < Math.abs(a.x - fw.x) ? l : a));
    lin.pose = POSE.flag; lin.flagUp = 1.6;
    this.say('offside', e);
    yield 1.4;
    // free kick defending side
    const b = this.ball, def = this.nearest(1 - team, b, p => p.role === 'DF') || this.alive(1 - team)[1];
    yield* this.cut(() => { b.owner = def; b.fl = null; b.x = spot.x - d * 3; b.y = spot.y; def.x = b.x; def.y = b.y; this.possTeam = 1 - team; });
    yield 0.4;
    const mate = this.alive(1 - team).find(p => p.role === 'MF');
    if (mate) yield* this.pass(mate, { lofted: true });
  }

  *sCorner(e) {
    this.countEvent(e);
    const team = e.team, d = this.dir(team), gx = this.goalX(team);
    const next = this.events[this.evI];
    const header = next && next.team === team && next.header && next.t - e.t < 0.6 ? next : null;
    const b = this.ball;
    const cy = e.side > 0 ? 67.6 : 0.4;
    this.say('corner', e);
    const taker = this.alive(team).filter(p => p.role === 'MF').sort((a, c) => c.info.attrs.passing - a.info.attrs.passing)[0] || this.alive(team)[5];
    const hd = header ? this.byId[header.pid] : this.alive(team).find(p => p.role === 'DF');
    yield* this.cut(() => {
      b.fl = null; b.x = gx - d * 0.4; b.y = cy; b.z = 0; b.owner = taker; taker.x = b.x - d * 0.8; taker.y = cy + (e.side > 0 ? 0.8 : -0.8);
      this.possTeam = team;
      const box = (p, k) => this.toWorld(rand(90, 100), rand(28, 40), d);
      for (const P of this.alive(team)) { if (P === taker || P.role === 'GK') continue; if (P.role === 'DF' && Math.random() < 0.4 && P !== hd) continue; const w = box(); P.x = w.x; P.y = w.y; }
      for (const P of this.alive(1 - team)) { if (P.role === 'GK') { P.x = gx - d * 0.8; P.y = 34; continue; } const w = this.toWorld(rand(92, 101), rand(27, 41), d); P.x = w.x; P.y = w.y; }
      for (const P of [...this.ps[0], ...this.ps[1]]) { P.vx = P.vy = 0; P.ft = { x: P.x, y: P.y }; }
      taker.ft = null;
      this.cam.tzoom = this.baseZoom * 1.2;
    });
    yield 0.9;
    const target = this.toWorld(rand(95, 99), 34 + rand(-4, 4), d);
    if (hd && header) { hd.ft = target; hd.sprint = true; }
    this.kick({ ...target, z: 2.1 }, { speed: 19, arc: 3.5, power: 0.6 });
    taker.pose = POSE.kick; taker.poseT = 0.3;
    yield () => b.fl && b.fl.t > b.fl.dur * 0.75;
    if (header && hd) { hd.pose = POSE.header; hd.poseT = 0.7; }
    for (const P of [...this.ps[0], ...this.ps[1]]) P.ft = null;
    if (header) {
      // the next event (header shot) continues from here
      yield () => !b.fl;
      if (hd) { b.owner = hd; b.z = 2.0; }
      this.evI++;
      yield* this.sShot(header);
      return;
    }
    yield () => !b.fl;
    const clearer = this.nearest(1 - team, b, p => p.role !== 'GK');
    if (clearer) { clearer.pose = POSE.header; clearer.poseT = 0.5; }
    b.z = 2;
    this.kick({ x: b.x - d * rand(18, 30), y: clamp(b.y + rand(-14, 14), 4, 64), z: 0 }, { speed: 16, arc: 4, power: 0.5 });
    yield () => !b.fl;
    this.looseBall(2);
    this.cam.tzoom = this.baseZoom;
    yield 0.4;
  }

  *sFoul(e) {
    if (e.kind !== 'foul' || true) this.countEvent(e);
    const team = e.team; // fouling team
    const victim = e.victim && this.byId[e.victim] && !this.byId[e.victim].off ? this.byId[e.victim] : this.alive(1 - team).find(p => p.role === 'MF');
    const fouler = this.byId[e.pid] && !this.byId[e.pid].off ? this.byId[e.pid] : this.nearest(team, this.ball);
    if (!victim || !fouler) return;
    const b = this.ball;
    if (b.owner !== victim) {
      if (b.fl) yield () => !b.fl;
      if (b.owner && b.owner.team === victim.team) yield* this.pass(victim);
      else { b.owner = victim; b.fl = null; b.x = victim.x; b.y = victim.y; this.possTeam = victim.team; }
    }
    const d = this.dir(victim.team);
    victim.ft = { x: clamp(victim.x + d * 9, 3, L - 3), y: victim.y + rand(-3, 3) };
    fouler.ft = victim; fouler.sprint = true;
    yield () => dist(fouler, victim) < 1.3;
    victim.pose = POSE.down; victim.poseT = 2.2; victim.ft = null; victim.vx *= 0.3; victim.vy *= 0.3;
    fouler.ft = null;
    b.owner = null; b.vx = d * 2; b.vy = rand(-1, 1);
    this.audio?.whistle(1);
    yield 0.8;
    // ref runs in
    this.ref.ft = { x: fouler.x - 2, y: fouler.y - 1.5 }; this.ref.sprint = true;
    yield () => dist(this.ref, this.ref.ft) < 1.5;
    this.ref.ft = null;
    if (e.kind !== 'foul') {
      this.ref.pose = POSE.card; this.ref.poseT = 1.8; this.ref.card = e.kind === 'yellow' ? '#ffd400' : '#e01b24';
      this.hooks.onCard?.(e, fouler.name, team);
    }
    this.say(e.kind, e);
    yield 1.6;
    if (e.kind === 'red') {
      fouler.off = true; fouler.ft = { x: fouler.x, y: -6 };
      fouler.leaving = true;
    }
    if (e.inBox) return; // penalty event follows
    // free kick
    const taker = this.nearest(victim.team, b, p => p !== victim && p.role !== 'GK') || victim;
    yield* this.cut(() => { b.owner = taker; b.fl = null; b.z = 0; taker.x = b.x; taker.y = b.y; this.possTeam = victim.team; });
    yield 0.5;
    const mate = this.alive(victim.team).filter(p => p !== taker && p.role !== 'GK')[(Math.random() * 8) | 0];
    if (mate) yield* this.pass(mate, { lofted: Math.random() < 0.6 });
  }

  *sPenalty(e) {
    const team = e.team, d = this.dir(team), gx = this.goalX(team);
    const next = this.events[this.evI];
    this.say('penalty', e);
    this.audio?.whistle(2);
    this.hype = 0.6;
    yield 1.2;
    const taker = next && next.penalty ? this.byId[next.pid] : null;
    const b = this.ball;
    yield* this.cut(() => {
      const spot = { x: gx - d * 11, y: 34 };
      b.fl = null; b.x = spot.x; b.y = spot.y; b.z = 0;
      const tk = taker && !taker.off ? taker : this.alive(team)[10];
      b.owner = tk; tk.x = spot.x - d * 2.5; tk.y = 34.5;
      for (const P of [...this.alive(team), ...this.alive(1 - team)]) {
        if (P === tk) continue;
        if (P.role === 'GK' && P.team !== team) { P.x = gx - d * 0.2; P.y = 34; continue; }
        if (P.role === 'GK') continue;
        const w = this.toWorld(rand(80, 85), rand(18, 50), d); P.x = w.x; P.y = w.y;
      }
      for (const P of this.figs) { P.vx = P.vy = 0; P.ft = { x: P.x, y: P.y }; }
      this.cam.tzoom = this.baseZoom * 1.35;
    });
    yield 1.2;
    for (const P of this.figs) P.ft = null;
    if (next && next.penalty) { this.evI++; yield* this.sShot(next); }
  }

  *sInjury(e) {
    const P = this.byId[e.pid]; if (!P || P.off) return;
    P.pose = POSE.down; P.poseT = 3; P.ft = null;
    this.say('injury', e);
    yield 2.2;
  }

  *sSub(e) {
    const P = this.byId[e.outId]; if (!P) return;
    const sh = this.sheets[e.team];
    const inn = (sh.bench || []).find(b => b.id === e.inId) || this.result.ht?.teams?.[e.team]?.bench?.find(b => b.id === e.inId);
    const outName = P.name;
    if (inn) {
      delete this.byId[P.id];
      P.id = inn.id; P.info = inn; P.name = inn.last || inn.name; P.num = inn.number || P.num; P.look = inn.look || P.look;
      P.maxSp = 5.6 + ((inn.attrs?.pace ?? 60) / 100) * 2.6; P.off = false; P.pose = 0;
      if (P.role === 'GK' || inn.pos === 'GK') { P.kit = inn.pos === 'GK' ? this.kits[e.team].gk : this.kits[e.team]; }
      this.byId[inn.id] = P;
    }
    this.hooks.onSub?.(e, outName, P.name);
    this.say('sub', e, { inName: P.name, outName });
    yield 0.3;
  }

  endHalf() {
    this.audio?.whistle(this.half === 1 ? 2 : 3, true);
    const sc = `${this.home.short} ${this.score[0]}-${this.score[1]} ${this.away.short}`;
    if (this.half === 1) {
      this.say('ht', null, { score: sc });
      this.state = 'halftime';
      this.hooks.onHalfTime?.(this.liveStats());
      if (this.demo) setTimeout(() => this.resume(), 1500);
    } else this.finish();
  }
  startSecondHalf() {
    this.half = 2; this.t = 45;
    this.runScript(this.sKickoff(1, true));
  }
  finish() {
    if (this.ended) return;
    this.ended = true; this.state = 'ft';
    const sc = `${this.home.short} ${this.score[0]}-${this.score[1]} ${this.away.short}`;
    this.say('ft', null, { score: sc });
    this.hooks.onClock?.('FT', 90);
    this.hooks.onFullTime?.(this.liveStats());
  }

  // ---------- AI ----------
  nearest(team, pt, filter = () => true) {
    let best = null, bd = 1e9;
    for (const P of this.ps[team]) { if (P.off || !filter(P)) continue; const d = Math.hypot(P.x - pt.x, P.y - pt.y); if (d < bd) { bd = d; best = P; } }
    return best;
  }

  baseTarget(P) {
    const T = P.team, d = this.dir(T), b = this.ball;
    const prog = this.prog(T, b.x);
    const by = d > 0 ? b.y : Wd - b.y;
    const inPoss = this.possTeam === T;
    let x, y;
    if (P.role === 'GK') {
      x = 2.5 + clamp((prog - 25) / 50, 0, 1) * 12;
      y = 34 + (by - 34) * 0.18;
    } else {
      const shift = inPoss ? (prog - 38) * 0.62 + 5 : (prog - 52) * 0.58 - 3;
      x = P.slot.x + shift;
      if (!inPoss && this.inClip && prog < 45) {
        // defending a dangerous attack: a compact block between the ball and the goal
        const line = clamp(prog - 2, 4.5, 19);
        x = P.role === 'DF' ? line : P.role === 'MF' ? Math.min(line + 9, prog + 2) : 38;
        y = 34 + (P.slot.y - 34) * 0.62 + (by - 34) * 0.4;
        x += Math.sin(this.time * 0.5 + P.seed) * 0.6;
        return this.toWorld(x, clamp(y, 3, 65), d);
      }
      if (!inPoss) {
        if (P.role === 'DF') x = Math.min(x, Math.max(10, prog - 4));
        if (P.role === 'MF') x = Math.min(x, prog + 3);
      } else if (P.role === 'DF') x = Math.min(x, 70);
      x = clamp(x, 5, P.role === 'FW' ? 96 : 92);
      y = P.slot.y + (by - 34) * (inPoss ? 0.28 : 0.42);
      y = 34 + (y - 34) * (inPoss ? 1.05 : 0.78);
    }
    x += Math.sin(this.time * 0.5 + P.seed) * 1.4; y += Math.cos(this.time * 0.43 + P.seed * 1.7) * 1.6;
    const w = this.toWorld(x, clamp(y, 2, 66), d);
    return w;
  }

  updateTargets(dt) {
    const b = this.ball;
    // pressers
    let press = [null, null];
    for (let k = 0; k < 2; k++) {
      if (this.possTeam === k) continue;
      const ref = b.fl && b.fl.rec ? { x: b.fl.x1, y: b.fl.y1 } : b;
      press[k] = this.nearest(k, ref, p => p.role !== 'GK');
    }
    for (const P of [...this.ps[0], ...this.ps[1]]) {
      if (P.leaving) { P.tx = P.x; P.ty = -7; if (P.y < -5) P.gone = true; continue; }
      if (P.off) continue;
      if (P.ft) { P.tx = P.ft.x; P.ty = P.ft.y; continue; }
      if (P.pose === POSE.down) { P.tx = P.x; P.ty = P.y; continue; }
      if (b.owner === P) {
        // dribble forward gently
        const d = this.dir(P.team);
        P.tx = P.x + d * 3; P.ty = P.y + (34 - P.y) * 0.08;
        continue;
      }
      if (press[P.team] === P) {
        const own = this.dir(P.team) > 0 ? 0 : L;
        P.tx = b.x + (own - b.x) * 0.03; P.ty = b.y; P.sprint = !this.script || Math.random() < 0.01;
        if (this.script && b.owner) { const dd = dist(P, b); if (dd < 2.2) { P.tx = P.x; P.ty = P.y; } }
        continue;
      }
      const t = this.baseTarget(P); P.tx = t.x; P.ty = t.y; P.sprint = false;
    }
    // referee follows play at a diagonal offset
    const R = this.ref;
    if (!R.ft) { R.tx = clamp(b.x - 10, 8, 97); R.ty = clamp(b.y - 9, 6, 62); }
    else { R.tx = R.ft.x; R.ty = R.ft.y; }
    // linesmen track the last defender line on their half
    for (const Ln of this.lines) {
      const half = Ln.y < 34 ? 0 : 1; // near one covers left half
      const lo = half === 0 ? 0 : 52.5, hi = half === 0 ? 52.5 : L;
      Ln.tx = clamp(b.x, lo + 2, hi - 2); Ln.ty = Ln.y < 34 ? -1.2 : 69.2;
      if (Ln.flagUp > 0) { Ln.flagUp -= dt; Ln.tx = Ln.x; }
    }
  }

  moveFig(P, dt) {
    if (P.gone) return;
    if (P.tx === undefined) { P.tx = P.x; P.ty = P.y; }
    const dx = P.tx - P.x, dy = P.ty - P.y, d = Math.hypot(dx, dy);
    let max = P.maxSp * (P.sprint ? 1 : 0.62);
    if (P.pose === POSE.dejected) max *= 0.35;
    if (P.pose === POSE.down || P.pose === POSE.card || (P.pose === POSE.dive && P.poseT > 0.3)) max = P.pose === POSE.dive ? 3 : 0;
    const sp = Math.min(max, d * 1.6);
    const dvx = d > 0.05 ? dx / d * sp : 0, dvy = d > 0.05 ? dy / d * sp : 0;
    const acc = Math.min(1, dt * (P.sprint ? 5 : 3.2));
    P.vx += (dvx - P.vx) * acc; P.vy += (dvy - P.vy) * acc;
    P.x += P.vx * dt; P.y += P.vy * dt;
    const s = Math.hypot(P.vx, P.vy);
    P.phase += s * dt * (3.0 - 0.17 * Math.min(s, 9));
    P.speed = s;
    if (Math.abs(P.vx) > 0.4) P.face = P.vx > 0 ? 1 : -1;
    else if (s < 0.4 && P.team >= 0) P.face = this.ball.x > P.x ? 1 : -1;
  }

  looseBall(speed) {
    const b = this.ball;
    b.owner = null; b.fl = null;
    const a = Math.random() * Math.PI * 2;
    b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed;
  }

  updateBall(dt) {
    const b = this.ball;
    if (this.real) return;
    if (b.fl) {
      const f = b.fl; f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      const px = b.x, py = b.y;
      b.x = lerp(f.x0, f.x1, u); b.y = lerp(f.y0, f.y1, u);
      b.z = lerp(f.z0, f.z1, u) + f.h * 4 * u * (1 - u);
      b.spin += Math.hypot(b.x - px, b.y - py) * 2;
      if (u >= 1) {
        b.fl = null;
        b.vx = (b.x - px) / dt * 0.25; b.vy = (b.y - py) / dt * 0.25;
        if (f.rec && !f.rec.off) {
          if (dist(f.rec, b) < 3.5) { b.owner = f.rec; f.rec.hold = rand(0.5, 1.3); this.possTeam = f.rec.team; }
          else { b.loose = true; }
        }
        f.onArrive?.();
      }
      if (this.shotTrail) { this.trail.push({ x: b.x, y: b.y, z: b.z }); if (this.trail.length > 12) this.trail.shift(); }
      return;
    }
    if (this.trail.length) this.trail.shift();
    if (b.dead) return;
    if (b.owner) {
      const P = b.owner;
      const touch = (Math.sin(P.phase * 0.5) * 0.5 + 0.5) * 0.35 * clamp((P.speed || 0) / 3, 0, 1);
      const sp = P.speed || 0;
      const ux = sp > 0.2 ? P.vx / sp : P.face, uy = sp > 0.2 ? P.vy / sp : 0;
      b.x = P.x + ux * (0.8 + touch); b.y = P.y + uy * (0.8 + touch) - 0.05; b.z = 0;
      b.spin += sp * dt * 3;
      return;
    }
    // loose rolling ball
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.vx *= Math.pow(0.45, dt); b.vy *= Math.pow(0.45, dt);
    b.spin += Math.hypot(b.vx, b.vy) * dt * 3;
    if (b.z > 0) { b.vz = (b.vz || 0) - 9.8 * dt; b.z += b.vz * dt; if (b.z < 0) { b.z = 0; b.vz = -b.vz * 0.45; if (Math.abs(b.vz) < 0.8) b.vz = 0; } }
    b.x = clamp(b.x, -1, L + 1); b.y = clamp(b.y, -1, Wd + 1);
    // pickup
    for (const P of [...this.ps[0], ...this.ps[1]]) {
      if (P.off || P.pose === POSE.down) continue;
      if (Math.hypot(P.x - b.x, P.y - b.y) < 1.1 && b.z < 1) { b.owner = P; P.hold = rand(0.4, 1.0); this.possTeam = P.team; b.loose = false; break; }
    }
    if (!b.owner && !this.script) {
      for (let k = 0; k < 2; k++) { const c = this.nearest(k, b); if (c) { c.tx = b.x; c.ty = b.y; c.sprint = true; c.ft = null; } }
    }
  }

  ambient(dt) {
    const b = this.ball;
    if (b.fl) return;
    if (!b.owner) {
      for (let k = 0; k < 2; k++) { const c = this.nearest(k, b); if (c) { c.ft = { x: b.x, y: b.y }; c.sprint = true; c._chase = true; } }
      return;
    }
    for (const P of [...this.ps[0], ...this.ps[1]]) if (P._chase) { P.ft = null; P._chase = false; }
    const o = b.owner;
    o.hold -= dt;
    if (o.hold > 0) return;
    const team = o.team;
    const next = this.events[this.evI];
    const soon = next && next.half === this.half && next.t - this.t < 1.2;
    const wantTeam = next ? (['yellow', 'red', 'foul'].includes(next.kind) ? 1 - next.team : next.team) : team;
    const mates = this.alive(team).filter(p => p !== o);
    const op = this.prog(team, o.x);
    const cand = mates.map(p => {
      const dd = dist(p, o);
      const pr = this.prog(team, p.x);
      let w = Math.exp(-Math.abs(dd - 16) / 10) * (1 + clamp((pr - op) / 18, -0.6, 1));
      if (pr > 76) w *= 0.25;
      if (p.role === 'GK') w *= op < 30 ? 0.4 : 0.02;
      return { p, w };
    });
    const pick = cand.length ? weightedPick(cand) : null;
    if (!pick) return;
    // turnovers: more likely if the next event belongs to the other team
    const turnover = Math.random() < (soon && wantTeam !== team ? 0.6 : 0.13);
    if (turnover) {
      const mid = { x: (o.x + pick.x) / 2, y: (o.y + pick.y) / 2 };
      const thief = this.nearest(1 - team, mid, p => p.role !== 'GK');
      if (thief) {
        const to = { x: lerp(thief.x, mid.x, 0.4), y: lerp(thief.y, mid.y, 0.4) };
        this.runScript((function* () { yield* this.pass(thief, { to }); }).call(this), true);
        if (Math.random() < 0.2) this.hooks.onAmbient?.(commentary('ambient', { name: thief.name, team: this.sheets[thief.team].name }));
        return;
      }
    }
    const lofted = dist(pick, o) > 28 && Math.random() < 0.5;
    this.runScript((function* () { yield* this.pass(pick, { lofted }); }).call(this), true);
    if (Math.random() < 0.05) this.hooks.onAmbient?.(commentary('ambient', { name: o.name, team: this.sheets[team].name }));
  }

  // ---------- replay recording ----------
  record() {
    const f = new Float32Array(this.figs.length * 9 + 6);
    let i = 0;
    for (const P of this.figs) { f[i++] = P.x; f[i++] = P.y; f[i++] = P.pose; f[i++] = P.phase; f[i++] = P.face; f[i++] = P.poseT; f[i++] = (P.gone ? 2 : P.off ? 1 : 0) + (P.diveDir || 0) * 10; f[i++] = P.speed || 0; f[i++] = P.hd || 0; }
    const b = this.ball;
    f[i++] = b.x; f[i++] = b.y; f[i++] = b.z; f[i++] = b.spin; f[i++] = this.netBulge ? this.netBulge.a : 0; f[i++] = this.netBulge ? this.netBulge.y : 0;
    this.rec.push(f);
    if (this.rec.length > 60 * 16) { this.rec.shift(); this.recBase = (this.recBase || 0) + 1; }
  }
  stepReplay(dt) {
    const r = this.replay;
    const sp = r.slowAt !== undefined && r.i > r.slowAt ? 0.35 : r.speed;
    r.i = Math.min(r.i + dt * 60 * sp, r.frames.length - 1);
    if (r.i >= r.frames.length - 1 && !this.sting) this.sting = { p: 0, fired: false, fn: () => { this.replay = null; } };
  }

  // ---------- camera ----------
  updateCamera(dt) {
    const c = this.cam;
    let src = this.ball;
    if (this.replay) { const f = this.replay.frames[Math.floor(this.replay.i)]; const n = this.figs.length * 9; src = this.replay.rev ? { x: L - f[n], y: Wd - f[n + 1] } : { x: f[n], y: f[n + 1] }; }
    let fx = src.x, fy = 34 + (src.y - 34) * 0.4;
    if (this.real && !this.replay) fx += this.real.d * 5;
    if (this.celebFocus && !this.replay) { fx = this.celebFocus.x; fy = 34 + (this.celebFocus.y - 34) * 0.5; }
    if (!this.script && !this.celebFocus) c.tzoom = lerp(c.tzoom, this.baseZoom, dt * 0.6);
    const zoomT = this.replay ? this.baseZoom * (this.replay.zoom || 1.5) : c.tzoom;
    const k = this.camSnap ? 1 : Math.min(1, dt * 2.2);
    this.camSnap = false;
    c.fx = lerp(c.fx, clamp(fx, 14, 91), k);
    c.fy = lerp(c.fy, fy, k);
    c.zoom = lerp(c.zoom, zoomT, Math.min(1, dt * 1.6));
    this.fade = lerp(this.fade, this.fadeTarget, Math.min(1, dt * 9));
    if (Math.abs(this.fade - this.fadeTarget) < 0.02) this.fade = this.fadeTarget;
  }

  // projection: returns [sx, sy, pxPerMeter]
  proj(x, y, z = 0) {
    const W = this.W, H = this.H, c = this.cam;
    if (this.camMode === 'tactical') {
      const s = Math.min(W / 116, H / (68 * 0.72 + 14));
      return [W / 2 + (x - 52.5) * s, H / 2 + 6 + (34 - y) * s * 0.72 - z * s * 0.9, s * 0.95];
    }
    const CAMD = 58, CAMH = 30, F = H * 2.05 * c.zoom;
    const d = Math.max(4, y + CAMD), s = F / d;
    const pyF = CAMH * F / (c.fy + CAMD);
    return [W / 2 + (x - c.fx) * s, H * 0.56 + (CAMH - z) * s - pyF, s];
  }

  // ---------- rendering ----------
  render() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const night = this.night;
    const now = performance.now(), dtR = Math.min(0.05, this._lastRender ? (now - this._lastRender) / 1000 : 0.016); this._lastRender = now;
    // sky / background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (night) { g.addColorStop(0, '#05070d'); g.addColorStop(0.5, '#0b1220'); g.addColorStop(1, '#0d1a12'); }
    else { g.addColorStop(0, '#6aa7d8'); g.addColorStop(0.45, '#b9d6ea'); g.addColorStop(1, '#3d6b3a'); }
    if (this.g3) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }

    // pick source frame
    let figs = this.figs, ball = this.ball, bulge = this.netBulge;
    if (this.replay) {
      const f = this.replay.frames[Math.floor(this.replay.i)];
      const rv = this.replay.rev, mx = x => rv ? L - x : x, my = y => rv ? Wd - y : y;
      figs = this.figs.map((P, j) => { const o = j * 9; const flag = f[o + 6], sp = f[o + 7], hd = f[o + 8]; return { ...P, x: mx(f[o]), y: my(f[o + 1]), pose: f[o + 2], phase: f[o + 3], face: rv ? -f[o + 4] : f[o + 4], poseT: f[o + 5], speed: sp, vx: sp, vy: 0, hd, off: (flag % 10) >= 1, gone: (flag % 10) >= 2, diveDir: Math.round(flag / 10) * (rv ? -1 : 1) }; });
      const n = this.figs.length * 9;
      ball = { x: mx(f[n]), y: my(f[n + 1]), z: f[n + 2], spin: f[n + 3] };
      bulge = f[n + 4] > 0.01 ? { a: f[n + 4], y: my(f[n + 5]), x: ball.x, d: ball.x > 52 ? 1 : -1 } : null;
    }

    if (this.g3) this.g3.render({ figs, ball, bulge }, dtR);
    else {
    if (this.camMode !== 'tactical') this.drawStands(ctx);
    else this.drawTacticalSurround(ctx);
    this.drawPitch(ctx);
    if (this.camMode !== 'tactical') this.drawBoards(ctx);

    // depth-sorted drawables
    const items = [];
    for (const P of figs) if (!P.gone) items.push({ y: P.y, f: () => this.drawFig(ctx, P) });
    items.push({ y: 37.7, f: () => this.drawGoal(ctx, 0, bulge, 'back') }, { y: 37.7, f: () => this.drawGoal(ctx, L, bulge, 'back') });
    items.push({ y: 30.3, f: () => this.drawGoal(ctx, 0, bulge, 'front') }, { y: 30.3, f: () => this.drawGoal(ctx, L, bulge, 'front') });
    items.push({ y: ball.y - 0.01, f: () => this.drawBall(ctx, ball) });
    items.sort((a, b) => b.y - a.y);
    // shadows first
    for (const P of figs) if (!P.gone) this.drawShadow(ctx, P);
    this.drawBallShadow(ctx, ball);
    for (const it of items) it.f();
    }
    // owner label
    const own = this.replay ? null : this.ball.owner || (this.real ? this.realCarrier : null);
    if (own && !own.off) this.drawLabel(ctx, own);
    if (this.celebFocus && !this.replay) this.drawLabel(ctx, this.celebFocus, true);

    this.drawWeather(ctx);
    // lighting & vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, this.g3 ? (night ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.12)') : night ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.25)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (this.flash > 0.01) { ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.55})`; ctx.fillRect(0, 0, W, H); this.flash *= 0.9; }
    if (!this.replay) this.drawConfetti(ctx);
    if (this.camMode !== 'tactical' && !this.replay) this.drawRadar(ctx, figs, ball);
    if (this.replay) this.drawReplayFrame(ctx);
    if (this.fade > 0.01) { ctx.fillStyle = `rgba(6,10,18,${this.fade})`; ctx.fillRect(0, 0, W, H); }
    this.drawCard(ctx);
    this.drawSting(ctx);
  }

  quad(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => { const q = this.proj(p[0], p[1], p[2] || 0); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); }

  drawStands(ctx) {
    // stand structure behind the far touchline
    const back = this.proj(52.5, 98, 19);
    ctx.fillStyle = this.night ? '#11151f' : '#4a5160';
    this.quad(ctx, [[-70, 72, 0], [175, 72, 0], [175, 98, 19], [-70, 98, 19]]); ctx.fill();
    // roof
    const roofG = ctx.createLinearGradient(0, 0, 0, back[1]);
    roofG.addColorStop(0, this.night ? '#05070c' : '#2c313b'); roofG.addColorStop(1, this.night ? '#151a26' : '#5c6372');
    ctx.fillStyle = roofG;
    this.quad(ctx, [[-70, 98, 19], [175, 98, 19], [175, 96, 26], [-70, 96, 26]]); ctx.fill();
    // floodlight strip
    if (this.night) {
      for (let x = -20; x <= 125; x += 9) {
        const p = this.proj(x, 97, 19.6);
        const r = p[2] * 2.4;
        const gl = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 3);
        gl.addColorStop(0, 'rgba(255,250,225,0.95)'); gl.addColorStop(0.15, 'rgba(255,245,210,0.35)'); gl.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = gl; ctx.fillRect(p[0] - r * 3, p[1] - r * 3, r * 6, r * 6);
      }
    }
    // crowd
    const exc = this.excite, t = this.time;
    const W = this.W;
    const cel = this.flash > 0.05 || (this.celebFocus ? 1 : 0);
    for (const [color, seats] of this.crowd.groups) {
      ctx.fillStyle = this.night ? shade(color, -0.25) : color;
      ctx.beginPath();
      for (const s of seats) {
        const bob = (exc > 0.45 || cel) ? Math.max(0, Math.sin(t * (6 + exc * 6) + s.ph)) * (0.15 + exc * 0.35) : Math.sin(t * 1.3 + s.ph) * 0.02;
        const p = this.proj(s.x, s.y, s.z + bob);
        if (p[0] < -10 || p[0] > W + 10) continue;
        const w = p[2] * 0.52, h = p[2] * 0.62;
        ctx.rect(p[0] - w / 2, p[1] - h, w, h);
      }
      ctx.fill();
    }
    // heads
    ctx.fillStyle = this.night ? '#8a6e58' : '#d9b08c';
    ctx.beginPath();
    for (const s of this.crowd.seats) {
      if ((s.ph * 10 | 0) % 3 === 0) continue;
      const bob = (exc > 0.45 || cel) ? Math.max(0, Math.sin(t * (6 + exc * 6) + s.ph)) * (0.15 + exc * 0.35) : 0;
      const p = this.proj(s.x, s.y, s.z + 0.62 + bob);
      if (p[0] < -10 || p[0] > W + 10) continue;
      const w = p[2] * 0.3;
      ctx.rect(p[0] - w / 2, p[1] - w, w, w);
    }
    ctx.fill();
    // camera flashes on big moments
    if (exc > 0.55 || this.flash > 0.05) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 14; i++) {
        const s = this.crowd.seats[(Math.random() * this.crowd.seats.length) | 0];
        const p = this.proj(s.x, s.y, s.z + 0.6);
        const r = p[2] * 0.35;
        ctx.globalAlpha = Math.random(); ctx.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawTacticalSurround(ctx) {
    ctx.fillStyle = '#0d1410'; ctx.fillRect(0, 0, this.W, this.H);
  }

  drawPitch(ctx) {
    const night = this.night, tac = this.camMode === 'tactical';
    const g1 = night ? '#1f6b34' : '#2f8a3f', g2 = night ? '#1a5d2d' : '#287a37', edge = night ? '#174f27' : '#246e32';
    ctx.fillStyle = night ? '#141b17' : '#3a4a3c';
    this.quad(ctx, [[-60, -9], [L + 60, -9], [L + 60, 73], [-60, 73]]); ctx.fill();
    ctx.fillStyle = edge;
    this.quad(ctx, [[-9, -7], [L + 9, -7], [L + 9, 72], [-9, 72]]); ctx.fill();
    const n = 18, w = L / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? g1 : g2;
      this.quad(ctx, [[i * w, -3.5], [(i + 1) * w, -3.5], [(i + 1) * w, 71.5], [i * w, 71.5]]); ctx.fill();
    }
    // texture
    ctx.save(); ctx.globalAlpha = 0.045; ctx.fillStyle = this.noise;
    this.quad(ctx, [[-9, -7], [L + 9, -7], [L + 9, 72], [-9, 72]]); ctx.fill(); ctx.restore();
    // floodlight pools
    if (night && !tac) {
      for (const [x, y] of [[20, 20], [85, 20], [20, 50], [85, 50], [52.5, 34]]) {
        const p = this.proj(x, y);
        const r = p[2] * 30;
        const gl = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
        gl.addColorStop(0, 'rgba(255,255,230,0.09)'); gl.addColorStop(1, 'rgba(255,255,230,0)');
        ctx.fillStyle = gl; ctx.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
      }
    }
    // lines
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineCap = 'round';
    const mid = this.proj(52.5, 34);
    ctx.lineWidth = Math.max(1, mid[2] * 0.12);
    const pl = pts => { ctx.beginPath(); pts.forEach((p, i) => { const q = this.proj(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke(); };
    pl([[0, 0], [L, 0], [L, Wd], [0, Wd], [0, 0]]);
    pl([[52.5, 0], [52.5, Wd]]);
    const circle = (cx, cy, r, a0 = 0, a1 = Math.PI * 2) => { const pts = []; for (let i = 0; i <= 48; i++) { const a = a0 + (a1 - a0) * i / 48; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } pl(pts); };
    circle(52.5, 34, 9.15);
    for (const s of [0, 1]) {
      const x0 = s ? L : 0, d = s ? -1 : 1;
      pl([[x0, 13.84], [x0 + d * 16.5, 13.84], [x0 + d * 16.5, 54.16], [x0, 54.16]]);
      pl([[x0, 24.84], [x0 + d * 5.5, 24.84], [x0 + d * 5.5, 43.16], [x0, 43.16]]);
      const a = Math.acos(5.5 / 9.15);
      circle(x0 + d * 11, 34, 9.15, s ? Math.PI - a : -a, s ? Math.PI + a : a);
      const sp = this.proj(x0 + d * 11, 34); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.ellipse(sp[0], sp[1], sp[2] * 0.18, sp[2] * 0.12, 0, 0, 7); ctx.fill();
      // corner arcs + flags
      for (const cy of [0, Wd]) circle(x0, cy, 1, 0, Math.PI * 2);
    }
    const c = this.proj(52.5, 34); ctx.beginPath(); ctx.ellipse(c[0], c[1], c[2] * 0.18, c[2] * 0.12, 0, 0, 7); ctx.fill();
    // corner flags
    for (const [x, y] of [[0, 0], [L, 0], [0, Wd], [L, Wd]]) {
      const a = this.proj(x, y, 0), b = this.proj(x, y, 1.5);
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = Math.max(1, a[2] * 0.05); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const wave = Math.sin(this.time * 4 + x) * 0.15;
      ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.moveTo(b[0], b[1]); const f1 = this.proj(x + 0.5, y, 1.35 + wave), f2 = this.proj(x, y, 1.15); ctx.lineTo(f1[0], f1[1]); ctx.lineTo(f2[0], f2[1]); ctx.fill();
    }
  }

  drawBoards(ctx) {
    const y = 70.6, h = 0.95;
    const seg = 12;
    const off = (this.time * 0.6) % 1;
    for (let i = -1; i < 11; i++) {
      const x0 = -8 + i * seg, x1 = x0 + seg - 0.2;
      const a = this.proj(x0, y, 0), b = this.proj(x1, y, h);
      if (b[0] < 0 || a[0] > this.W) continue;
      const brand = this.boards[(i + 1 + Math.floor(this.time / 6)) % this.boards.length];
      const hue = (i * 47 + Math.floor(this.time / 6) * 30) % 360;
      ctx.fillStyle = `hsl(${hue},70%,${this.night ? 14 : 22}%)`;
      ctx.fillRect(a[0], b[1], b[0] - a[0], a[1] - b[1]);
      ctx.fillStyle = `hsl(${(hue + 180) % 360},100%,${this.night ? 72 : 80}%)`;
      ctx.font = `800 ${Math.max(6, (a[1] - b[1]) * 0.62)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.save(); ctx.beginPath(); ctx.rect(a[0], b[1], b[0] - a[0], a[1] - b[1]); ctx.clip();
      ctx.fillText(brand, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.5);
      ctx.restore();
    }
  }

  drawGoal(ctx, x0, bulge, part) {
    const d = x0 === 0 ? -1 : 1; // net extends outward
    const depth = 2.2;
    const y0 = 34 - GOAL_HW, y1 = 34 + GOAL_HW;
    const bul = (x, y, z) => {
      if (!bulge || Math.sign(bulge.x - 52.5) !== d) return [x, y, z];
      const k = Math.exp(-((y - bulge.y) ** 2) / 3 - ((z - (bulge.z ?? 1)) ** 2) / 2) * bulge.a * 0.9;
      return [x + d * k, y, z];
    };
    ctx.lineWidth = 1;
    if (part === 'back') {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      // back net grid
      for (let i = 0; i <= 12; i++) {
        const y = lerp(y0, y1, i / 12);
        ctx.beginPath();
        for (let j = 0; j <= 6; j++) { const z = lerp(0, GOAL_H * 0.85, j / 6); const pt = bul(x0 + d * depth, y, z); const q = this.proj(...pt); j ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
        ctx.stroke();
      }
      for (let j = 0; j <= 6; j++) {
        const z = lerp(0, GOAL_H * 0.85, j / 6);
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) { const y = lerp(y0, y1, i / 12); const q = this.proj(...bul(x0 + d * depth, y, z)); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
        ctx.stroke();
      }
      // far side net + roof
      for (let i = 0; i <= 5; i++) {
        const xx = x0 + d * depth * i / 5;
        const a = this.proj(xx, y1, 0), b = this.proj(xx, y1, lerp(GOAL_H, GOAL_H * 0.85, i / 5));
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        const c = this.proj(xx, y0, lerp(GOAL_H, GOAL_H * 0.85, i / 5));
        ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      }
      // far post
      const p0 = this.proj(x0, y1, 0), p1 = this.proj(x0, y1, GOAL_H), p2 = this.proj(x0, y0, GOAL_H);
      ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = Math.max(2, p0[2] * 0.12);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const xx = x0 + d * depth * i / 5;
        const a = this.proj(xx, y0, 0), b = this.proj(xx, y0, lerp(GOAL_H, GOAL_H * 0.85, i / 5));
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      const p0 = this.proj(x0, y0, 0), p1 = this.proj(x0, y0, GOAL_H);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, p0[2] * 0.12);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
  }

  drawShadow(ctx, P) {
    const p = this.proj(P.x, P.y, 0), k = p[2];
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(p[0], p[1], k * 0.42, k * 0.15, 0, 0, 7); ctx.fill();
    if (this.camMode !== 'tactical') {
      ctx.fillStyle = this.night ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.18)';
      const n = this.night ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const ang = this.night ? -0.9 + i * 0.9 : -0.6;
        ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang); ctx.beginPath(); ctx.ellipse(k * 0.75, 0, k * 0.85, k * 0.14, 0, 0, 7); ctx.fill(); ctx.restore();
      }
    }
  }

  drawFig(ctx, P) {
    if (P.gone) return;
    const p = this.proj(P.x, P.y, 0);
    let k = p[2];
    if (this.camMode === 'tactical') k *= 1.35;
    if (p[0] < -k * 3 || p[0] > this.W + k * 3) return;
    const kit = P.kit;
    const skin = SKIN[P.look?.skin ?? 1], hair = HAIR[P.look?.hair ?? 0];
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.scale(k, k);
    const pose = P.pose;
    let rot = 0, lift = 0;
    if (pose === POSE.dive) { const prog = clamp(1 - P.poseT / 1.3, 0, 1); rot = (P.diveDir || 1) * Math.min(1, prog * 3) * 1.35; lift = Math.sin(Math.min(1, prog * 2) * Math.PI) * 0.6; }
    if (pose === POSE.down) rot = 1.45 * (P.face || 1);
    if (pose === POSE.header) lift = Math.sin(clamp(1 - P.poseT / 0.7, 0, 1) * Math.PI) * 0.55;
    if (pose === POSE.celebrate) lift = Math.abs(Math.sin(this.time * 7 + P.seed)) * 0.25;
    ctx.translate(0, -lift);
    if (rot) { ctx.translate(0, -0.25); ctx.rotate(rot); ctx.translate(0, 0.25); }
    const f = P.face || 1;
    ctx.scale(f, 1);
    const spd = clamp((P.speed || 0) / 7.5, 0, 1);
    const gait = pose === POSE.run || pose === POSE.dejected || pose === POSE.celebrate;
    const sw = gait ? Math.sin(P.phase) * 0.36 * spd : 0;
    // foreshortening: running towards or away from the camera shortens the stride on screen
    const along = P.speed > 0.3 ? clamp(Math.abs(P.vx) / P.speed, 0.3, 1) : 1;
    const lean = pose === POSE.dejected ? 0.12 : spd * 0.2 * along;
    const bob = gait ? -Math.abs(Math.cos(P.phase)) * 0.07 * spd : 0;
    ctx.translate(0, bob);
    // legs: thigh + shin with a knee that folds on the back swing
    ctx.lineCap = 'round';
    const legAt = side => {
      const ph = P.phase + (side > 0 ? 0 : Math.PI);
      let th = gait ? Math.sin(ph) * (0.12 + 0.62 * spd) : 0;
      let bend = gait ? Math.max(0, Math.sin(ph - 1.3)) * (0.25 + 1.35 * spd) + 0.06 : 0.08;
      if (pose === POSE.kick && side === 1) { th = 1.0; bend = 0.1; }
      if (pose === POSE.kick && side === -1) { th = -0.25; bend = 0.35; }
      if (pose === POSE.header) { th = side * 0.25; bend = 0.9; }
      const hx = side * 0.04, hy = -0.88;
      const kx = hx + Math.sin(th) * 0.44 * along, ky = hy + Math.cos(th) * 0.44;
      const fx = kx + Math.sin(th - bend) * 0.43 * along, fy = ky + Math.cos(th - bend) * 0.43;
      return { hx, hy, kx, ky, fx: fx, fy: Math.min(fy, 0) };
    };
    for (const side of [-1, 1]) {
      const g = legAt(side), far = side < 0;
      ctx.strokeStyle = far ? shade(skin, -0.25) : skin; ctx.lineWidth = 0.15;
      ctx.beginPath(); ctx.moveTo(g.hx, g.hy); ctx.lineTo(g.kx, g.ky); ctx.stroke();
      ctx.strokeStyle = far ? shade(kit.socks, -0.3) : kit.socks; ctx.lineWidth = 0.13;
      ctx.beginPath(); ctx.moveTo(g.kx, g.ky); ctx.lineTo(g.fx, g.fy - 0.05); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(g.fx + 0.07, g.fy - 0.03, 0.11, 0.05, 0, 0, 7); ctx.fill();
    }
    // shorts
    ctx.fillStyle = kit.shorts;
    rr(ctx, -0.2, -1.03, 0.4, 0.27, 0.05); ctx.fill();
    // torso
    ctx.save();
    ctx.translate(0, -0.95); ctx.rotate(lean); ctx.translate(0, 0.95);
    ctx.beginPath(); ctx.moveTo(-0.23, -1.52); ctx.lineTo(0.23, -1.52); ctx.lineTo(0.2, -0.98); ctx.lineTo(-0.2, -0.98); ctx.closePath();
    ctx.fillStyle = kit.primary; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = kit.secondary;
    switch (kit.pattern) {
      case 'stripes': for (let x = -0.2; x < 0.25; x += 0.14) ctx.fillRect(x, -1.6, 0.06, 0.7); break;
      case 'pinstripe': for (let x = -0.22; x < 0.25; x += 0.07) ctx.fillRect(x, -1.6, 0.015, 0.7); break;
      case 'hoops': for (let y = -1.5; y < -0.95; y += 0.14) ctx.fillRect(-0.3, y, 0.6, 0.06); break;
      case 'halves': ctx.fillRect(0, -1.6, 0.3, 0.7); break;
      case 'sash': ctx.beginPath(); ctx.moveTo(-0.25, -1.55); ctx.lineTo(-0.1, -1.55); ctx.lineTo(0.25, -1.0); ctx.lineTo(0.1, -0.95); ctx.fill(); break;
      default: ctx.fillRect(-0.3, -1.54, 0.6, 0.05);
    }
    if (k > 26 && P.num !== '' && this.camMode !== 'tactical') { ctx.save(); ctx.scale(f, 1); ctx.fillStyle = kit.pattern === 'plain' || kit.pattern === 'sleeves' ? kit.secondary : '#fff'; ctx.font = 'bold 0.24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(P.num), 0, -1.24); ctx.restore(); }
    ctx.restore();
    // arms swing against the legs, elbows bent more at speed
    const arm = (side) => {
      const sx = side * 0.2 + lean * 0.55, sy = -1.45;
      const ph = P.phase + (side > 0 ? Math.PI : 0);
      const ua = gait ? Math.sin(ph) * (0.15 + 0.7 * spd) * along : 0.05;
      const fb = 0.35 + 1.0 * spd;
      let ex = sx + Math.sin(ua) * 0.28, ey = sy + Math.cos(ua) * 0.28;
      let hx = ex + Math.sin(ua + fb) * 0.25, hy = ey + Math.cos(ua + fb) * 0.25;
      const setH = (x, y) => { hx = x; hy = y; ex = (sx + hx) / 2 + side * 0.04; ey = (sy + hy) / 2; };
      if (pose === POSE.celebrate) setH(side * 0.34, -1.98);
      if (pose === POSE.dive) setH(side * 0.1 + 0.3, -2.0);
      if (pose === POSE.kick) setH(side * 0.3 - 0.05, -1.2);
      if (pose === POSE.header) setH(side * 0.3, -1.3);
      if (pose === POSE.card && side === 1) setH(0.12, -2.05);
      if (pose === POSE.flag && side === 1 && P.flagUp > 0) setH(0.1, -2.0);
      if (pose === POSE.dejected) setH(side * 0.15, -1.75);
      ctx.strokeStyle = kit.pattern === 'sleeves' ? kit.secondary : kit.primary; ctx.lineWidth = 0.13;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = skin; ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
      if (P.role === 'GK') { ctx.fillStyle = '#e8e8e8'; ctx.beginPath(); ctx.arc(hx, hy, 0.07, 0, 7); ctx.fill(); }
      if (pose === POSE.card && side === 1 && P.card) { ctx.fillStyle = P.card; ctx.fillRect(hx - 0.06, hy - 0.2, 0.12, 0.17); }
      if (P.role === 'LIN' && side === 1) { ctx.strokeStyle = '#ddd'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 0.05, hy - 0.45); ctx.stroke(); ctx.fillStyle = (Math.floor(this.time * 4) % 2) ? '#ffd400' : '#e01b24'; ctx.fillRect(hx + 0.05, hy - 0.45, 0.2, 0.14); }
    };
    arm(-1);
    // head
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(lean * 0.8, -1.68, 0.125, 0, 7); ctx.fill();
    ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(lean * 0.8, -1.7, 0.13, Math.PI * 1.05, Math.PI * 2.05); ctx.fill();
    arm(1);
    ctx.restore();
    ctx.restore();
    if (this.camMode === 'tactical' && P.team >= 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = `600 ${Math.max(8, k * 0.75)}px "Barlow Condensed", sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = '#fff'; ctx.fillText(P.num, p[0], p[1] - k * 2.6);
    }
  }

  projPt(x, y, z) { return this.g3 ? this.g3.project(x, y, z) : this.proj(x, y, z); }
  drawLabel(ctx, P, big) {
    const p = this.projPt(P.x, P.y, 2.3);
    if (this.g3 && !p[2]) return;
    const txt = `${P.num}  ${P.name}`.toUpperCase();
    ctx.font = `700 ${big ? 15 : 12}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const w = ctx.measureText(txt).width + 14, h = big ? 22 : 18;
    const x = p[0] - w / 2, y = p[1] - h - 4;
    ctx.fillStyle = 'rgba(8,12,22,0.78)'; rr(ctx, x, y, w, h, 4); ctx.fill();
    ctx.fillStyle = P.kit.primary; ctx.fillRect(x, y, 4, h);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, p[0] + 2, y + h / 2 + 1);
  }

  drawBallShadow(ctx, b) {
    const p = this.proj(b.x, b.y, 0), k = p[2];
    const a = clamp(0.4 - b.z * 0.06, 0.08, 0.4);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath(); ctx.ellipse(p[0], p[1], k * 0.2 * (1 + b.z * 0.08), k * 0.08, 0, 0, 7); ctx.fill();
  }
  drawBall(ctx, b) {
    if (this.trail.length > 2 && !this.replay) {
      ctx.lineCap = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.proj(this.trail[i - 1].x, this.trail[i - 1].y, this.trail[i - 1].z), c = this.proj(this.trail[i].x, this.trail[i].y, this.trail[i].z);
        ctx.strokeStyle = `rgba(255,255,255,${i / this.trail.length * 0.5})`; ctx.lineWidth = c[2] * 0.25 * i / this.trail.length;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      }
    }
    const p = this.proj(b.x, b.y, b.z + 0.17), k = p[2];
    const r = Math.max(2.4, k * 0.19);
    ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
    ctx.fillStyle = '#222';
    for (let i = 0; i < 3; i++) { const a = b.spin + i * 2.1; const ox = Math.cos(a) * r * 0.5, oy = Math.sin(a * 0.7) * r * 0.45; if (Math.cos(a) > -0.3) { ctx.beginPath(); ctx.arc(p[0] + ox, p[1] + oy, r * 0.28, 0, 7); ctx.fill(); } }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.stroke();
  }

  drawWeather(ctx) {
    if (this.weather === 'clear') return;
    const W = this.W, H = this.H;
    if (this.weather === 'rain') {
      ctx.strokeStyle = 'rgba(200,215,235,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.rain) {
        d.y += 0.016 * 2.2 * d.s; d.x += 0.016 * 0.25 * d.s;
        if (d.y > 1) { d.y = 0; d.x = Math.random(); }
        if (d.x > 1) d.x = 0;
        const x = d.x * W, y = d.y * H;
        ctx.moveTo(x, y); ctx.lineTo(x - 4 * d.s, y - 16 * d.s);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,140,170,0.08)'; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const d of this.rain) {
        d.y += 0.016 * 0.22 * d.s; d.x += Math.sin(this.time + d.s * 10) * 0.0006;
        if (d.y > 1) { d.y = 0; d.x = Math.random(); }
        ctx.beginPath(); ctx.arc(d.x * W, d.y * H, 1.2 + d.s * 1.4, 0, 7); ctx.fill();
      }
    }
  }

  spawnConfetti(kit) {
    const cols = [kit.primary, kit.secondary, '#ffffff', '#ffd400'];
    for (let i = 0; i < 160; i++) this.confetti.push({ x: Math.random() * this.W, y: -Math.random() * this.H * 0.5, vx: rand(-30, 30), vy: rand(40, 140), r: Math.random() * 6, vr: rand(-6, 6), c: cols[i % 4], s: rand(4, 9), life: rand(3, 5) });
  }
  drawConfetti(ctx) {
    if (!this.confetti.length) return;
    const dt = 0.016;
    for (const c of this.confetti) {
      c.x += c.vx * dt + Math.sin(this.time * 3 + c.r) * 0.6; c.y += c.vy * dt; c.r += c.vr * dt; c.life -= dt;
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.globalAlpha = clamp(c.life, 0, 1); ctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2 * Math.abs(Math.cos(c.r * 2))); ctx.restore();
    }
    this.confetti = this.confetti.filter(c => c.life > 0 && c.y < this.H + 20);
  }

  drawRadar(ctx, figs, ball) {
    const w = Math.min(150, this.W * 0.22), h = w * 68 / 105;
    const x0 = this.W - w - 12, y0 = this.H - h - 12;
    ctx.fillStyle = 'rgba(6,12,10,0.6)'; rr(ctx, x0 - 4, y0 - 4, w + 8, h + 8, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h);
    ctx.beginPath(); ctx.moveTo(x0 + w / 2, y0); ctx.lineTo(x0 + w / 2, y0 + h); ctx.stroke();
    ctx.beginPath(); ctx.arc(x0 + w / 2, y0 + h / 2, w * 0.087, 0, 7); ctx.stroke();
    // visible window
    const a = this.unprojX(0), b = this.unprojX(this.W);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x0 + clamp(a, 0, L) / L * w, y0, (clamp(b, 0, L) - clamp(a, 0, L)) / L * w, h);
    for (const P of figs) {
      if (P.team < 0 || P.off || P.gone) continue;
      ctx.fillStyle = P.kit.primary; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.arc(x0 + P.x / L * w, y0 + (Wd - P.y) / Wd * h, 2.6, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x0 + ball.x / L * w, y0 + (Wd - ball.y) / Wd * h, 2.2, 0, 7); ctx.fill();
  }
  unprojX(sx) { const c = this.cam; const s = this.H * 2.05 * c.zoom / (c.fy + 58); return c.fx + (sx - this.W / 2) / s; }

  drawReplayFrame(ctx) {
    const W = this.W, H = this.H;
    const bar = H * 0.07;
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
    ctx.fillStyle = '#ffd400'; ctx.font = `800 ${Math.max(14, bar * 0.55)}px "Big Shoulders Display", "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const blink = Math.floor(this.time * 2) % 2;
    ctx.fillText('● REPLAY', 18, bar / 2);
    if (blink) { ctx.fillStyle = '#e01b24'; ctx.beginPath(); ctx.arc(10, bar / 2, 4, 0, 7); ctx.fill(); }
  }
}

const SCENE_DEPTH = { through: 0.6, overlap: 0.66, cutback: 0.7, onetwo: 0.64, long: 0.7, counter: 0.32 };
export const SCENE_LABEL = { cross: 'Cross', header: 'Header', combo: 'Passing move', through: 'Through ball', overlap: 'Overlap & cross', cutback: 'Cut-back', onetwo: 'One-two', long: 'From distance', counter: 'Counter-attack', corner: 'Corner', penalty: 'Penalty', red: 'Flashpoint' };
// The scene depends only on how the chance was created, never on whether it went in.
function sceneFor(e) {
  if (e.kind === 'penalty' || e.penalty) return 'penalty';
  if (e.kind === 'corner') return 'corner';
  if (e.kind === 'red') return 'red';
  if (e.header) return 'overlap';
  if (e.long) return 'long';
  const opts = ['through', 'overlap', 'cutback', 'onetwo', 'counter'];
  let h = 2166136261; for (const ch of `${e.t.toFixed(3)}|${e.pid}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return opts[h % opts.length];
}

// Pick which moments become animated clips: every goal, penalty and red card, plus the best few chances.
function markClips(list) {
  for (const e of list) e.clip = false;
  const goals = list.filter(e => e.kind === 'goal').length;
  list.forEach((e, i) => {
    if (e.kind === 'goal' || e.kind === 'penalty' || e.kind === 'red') e.clip = true;
    if (e.penalty && i > 0 && list[i - 1].kind === 'penalty') e.clip = true;
  });
  const cands = list.filter(e => (e.kind === 'save' || e.kind === 'miss') && !e.penalty);
  const budget = Math.max(2, 7 - goals);
  cands.sort((a, b) => (a.kind === 'save' ? 0 : 1) - (b.kind === 'save' ? 0 : 1) || ((a.t * 7919) % 13) - ((b.t * 7919) % 13));
  cands.slice(0, budget).forEach(e => { e.clip = true; });
  // a header from a corner plays as one clip that starts with the corner
  list.forEach((e, i) => { const n = list[i + 1]; if (e.kind === 'corner' && n && n.header && n.clip) e.clip = true; });
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function weightedPick(list) { let tot = 0; for (const o of list) tot += o.w; let x = Math.random() * tot; for (const o of list) { x -= o.w; if (x <= 0) return o.p; } return list[list.length - 1].p; }
// schedules a callback in simulation time (respects speed and pause)
function setTimeoutSim(view, secs, fn) {
  const startT = view.simTime || 0;
  const check = () => { if (view.destroyed) return; if ((view.simTime || 0) - startT >= secs) fn(); else requestAnimationFrame(check); };
  requestAnimationFrame(check);
}
