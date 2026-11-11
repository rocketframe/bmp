// Statistical match engine. Pure: takes plain team sheets + a seed, returns a full event timeline.
// The animated viewer only *plays back* this timeline, so results are identical whether watched or not,
// and a server could run this same code for multiplayer.
import { makeRng, clamp } from './rng.js';
import { MENTALITIES, FORMATIONS } from './constants.js';
import { effSkill, shortName } from './players.js';

export function makeSheet(state, club) {
  const slots = FORMATIONS[club.formation];
  const pick = p => ({ id: p.id, name: shortName(p), last: p.last, pos: p.pos, skill: p.skill, attrs: { ...p.attrs }, fitness: p.fitness, form: p.form, morale: p.morale, number: p.number, look: p.look });
  return {
    clubId: club.id, name: club.name, short: club.short, colors: { ...club.colors },
    formation: club.formation, mentality: club.mentality, cohesion: club.cohesion ?? 50,
    human: !!club.human,
    xi: club.lineup.map((id, i) => ({ ...pick(state.players[id]), role: slots[i][0], slot: i })),
    bench: club.bench.map(id => pick(state.players[id])),
  };
}

const W_SHOOT = { FW: 5, MF: 2.2, DF: 0.55, GK: 0 };
const W_ASSIST = { FW: 2, MF: 3.2, DF: 1, GK: 0.05 };
const W_FOUL = { FW: 0.6, MF: 1.2, DF: 1.6, GK: 0.1 };

function ratings(T) {
  const on = T.on;
  const by = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of on) by[p.role].push(effSkill({ ...p, fitness: p.fit }, p.role));
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 30;
  const m = MENTALITIES[T.mentality] || MENTALITIES.balanced;
  const short = Math.max(0, 11 - on.length);
  const pen = 1 - short * 0.08;
  const coh = 0.96 + (T.cohesion / 100) * 0.08;
  const gk = by.GK.length ? avg(by.GK) : 25;
  const def = (avg(by.DF) * 0.8 + avg(by.MF) * 0.2) * (1 + 0.045 * (by.DF.length - 4)) * m.def * pen * coh;
  const mid = (avg(by.MF) * 0.7 + avg(by.DF) * 0.15 + avg(by.FW) * 0.15) * (1 + 0.05 * (by.MF.length - 4)) * pen * coh;
  const att = (avg(by.FW) * 0.7 + avg(by.MF) * 0.3) * (1 + 0.06 * (by.FW.length - 2)) * m.att * pen * coh;
  return { gk, def, mid, att, danger: m.danger };
}

function initTeam(sheet) {
  return {
    clubId: sheet.clubId, mentality: sheet.mentality, formation: sheet.formation, cohesion: sheet.cohesion, human: sheet.human,
    on: sheet.xi.map(p => ({ ...p, fit: p.fitness, yellow: 0 })),
    bench: sheet.bench.map(p => ({ ...p })),
    subsLeft: 3, used: [],
  };
}

function newMatchState(home, away) {
  return {
    teams: [initTeam(home), initTeam(away)],
    score: [0, 0], events: [], poss: [],
    stats: { phases: [0, 0], shots: [0, 0], sot: [0, 0], corners: [0, 0], fouls: [0, 0], yellows: [0, 0], reds: [0, 0], saves: [0, 0] },
    ps: {}, added: [0, 0],
  };
}

const clone = o => JSON.parse(JSON.stringify(o));

export function simulateMatch(home, away, seed, opts = {}) {
  const rng = makeRng(seed);
  const st = newMatchState(home, away);
  st.homeAdv = opts.neutral ? 1 : 1.045;
  for (const t of st.teams) for (const p of t.on) touch(st, p.id).started = true;
  simHalf(st, 1, rng);
  const ht = clone(st);
  ht.rngState = rng.state;
  simHalf(st, 2, rng);
  return finalize(st, ht, home, away, seed);
}

// Halftime team talk: re-simulate the second half after the human changes tactics or makes subs.
export function resimSecondHalf(result, teamIdx, changes, seed) {
  const st = clone(result.ht);
  const T = st.teams[teamIdx];
  if (changes.mentality) T.mentality = changes.mentality;
  if (changes.formation && FORMATIONS[changes.formation]) {
    T.formation = changes.formation;
    const slots = FORMATIONS[changes.formation];
    // reassign roles by best fit, keep GK
    const outfield = T.on.filter(p => p.role !== 'GK');
    const gk = T.on.filter(p => p.role === 'GK');
    const roles = slots.filter(s => s[0] !== 'GK').map(s => s[0]);
    const pool = outfield.slice();
    const assigned = [];
    for (const r of roles) {
      if (!pool.length) break;
      pool.sort((a, b) => (b.pos === r) - (a.pos === r) || b.skill - a.skill);
      const p = pool.shift(); p.role = r; assigned.push(p);
    }
    T.on = gk.concat(assigned, pool);
    T.on.forEach((p, i) => p.slot = i);
  }
  for (const s of changes.subs || []) {
    if (T.subsLeft <= 0) break;
    const outI = T.on.findIndex(p => p.id === s.outId);
    const inI = T.bench.findIndex(p => p.id === s.inId);
    if (outI < 0 || inI < 0) continue;
    const out = T.on[outI], inn = T.bench[inI];
    T.bench.splice(inI, 1);
    T.on[outI] = { ...inn, role: out.role, slot: out.slot, fit: inn.fitness, yellow: 0 };
    T.subsLeft--; T.used.push(out.id);
    touch(st, inn.id).subOn = 45;
    st.events.push({ t: 45, half: 2, team: teamIdx, kind: 'sub', outId: out.id, inId: inn.id, slot: out.slot });
  }
  T.human = true; T.manual = true;
  const rng = makeRng(seed);
  simHalf(st, 2, rng);
  return finalize(st, result.ht, result.sheets[0], result.sheets[1], result.seed);
}

function touch(st, id) { return st.ps[id] || (st.ps[id] = { goals: 0, assists: 0, shots: 0, saves: 0, tackles: 0, key: 0, yellow: 0, red: 0, injury: 0 }); }

function wpick(rng, list, wfn) { return list.length ? rng.weighted(list, wfn) : null; }

function simHalf(st, half, rng) {
  const added = half === 1 ? rng.int(0, 3) : rng.int(1, 5);
  st.added[half - 1] = added;
  const start = half === 1 ? 0 : 45;
  const len = 45 + added;
  const n = Math.round(len / 1.3);
  for (let i = 0; i < n; i++) {
    const t = start + (i + rng.range(0.15, 0.85)) * len / n;
    for (const T of st.teams) for (const p of T.on) p.fit = Math.max(20, p.fit - 0.33 * (1.25 - (p.attrs.stamina || 70) / 100));
    if (half === 2 && t > 57) for (let k = 0; k < 2; k++) maybeAutoSub(st, k, t, rng);
    const R = st.teams.map(ratings);
    R[0].mid *= st.homeAdv; R[0].att *= st.homeAdv; R[0].def *= (1 + (st.homeAdv - 1) / 2);
    const pa = Math.pow(R[0].mid, 1.7) / (Math.pow(R[0].mid, 1.7) + Math.pow(R[1].mid, 1.7));
    const a = rng.chance(pa) ? 0 : 1, d = 1 - a;
    st.stats.phases[a]++; st.poss.push([Math.round(t * 10) / 10, a]);
    const q = 0.5 + (R[a].att - R[d].def) / (R[a].att + R[d].def) * 0.6;
    const lead = st.score[a] - st.score[d];
    const urgency = (t > 70 && lead < 0 ? 0.04 : 0) - (t > 75 && lead > 0 ? 0.03 : 0);
    const dangerP = clamp(0.36 + (q - 0.5) * 1.0 + R[a].danger + urgency, 0.15, 0.72);
    if (rng.chance(0.0016 * 2)) injury(st, rng.chance(0.5) ? 0 : 1, t, half, rng);
    if (!rng.chance(dangerP)) {
      if (rng.chance(0.3)) foul(st, d, a, t, half, rng, false);
      continue;
    }
    const r = rng.next();
    const A = st.teams[a];
    if (r < 0.07) { st.events.push({ t, half, team: a, kind: 'offside', pid: pickRole(rng, A, W_SHOOT)?.id, build: build(rng, A, 2) }); continue; }
    if (r < 0.26) {
      const D = st.teams[d]; const blocker = pickRole(rng, D, W_FOUL);
      const corner = rng.chance(0.3);
      if (blocker) touch(st, blocker.id).tackles++;
      st.events.push({ t, half, team: a, kind: 'chance', pid: pickRole(rng, A, W_SHOOT)?.id, blocker: blocker?.id, build: build(rng, A, rng.int(2, 4)), corner });
      if (corner) { st.stats.corners[a]++; cornerKick(st, a, t + 0.3, half, rng, R); }
      continue;
    }
    if (r < 0.285) { foul(st, d, a, t, half, rng, true, R); continue; }
    shot(st, a, t, half, rng, R, q, {});
  }
}

function pickRole(rng, T, W, exclude) { return wpick(rng, T.on.filter(p => p !== exclude), p => W[p.role] * (0.5 + p.skill / 100)); }
function build(rng, T, n) {
  const out = []; let last = null;
  for (let i = 0; i < n; i++) { const p = wpick(rng, T.on.filter(x => x !== last), x => (x.role === 'GK' ? 0.15 : x.role === 'DF' ? 1 : x.role === 'MF' ? 2.2 : 1.2)); if (!p) break; out.push(p.id); last = p; }
  return out;
}
function keeper(T) { return T.on.find(p => p.role === 'GK') || T.on[0]; }

function shot(st, a, t, half, rng, R, q, { header = false, penalty = false, shooter = null }) {
  const d = 1 - a, A = st.teams[a], D = st.teams[d];
  const sh = shooter || (header ? wpick(rng, A.on.filter(p => p.role !== 'GK'), p => (p.role === 'FW' ? 3 : p.role === 'DF' ? 2 : 1.5)) : pickRole(rng, A, W_SHOOT));
  if (!sh) return;
  const asst = penalty ? null : pickRole(rng, A, W_ASSIST, sh);
  const gk = keeper(D);
  const sk = effSkill({ ...sh, skill: (sh.attrs.shooting * 0.7 + sh.skill * 0.3), fitness: sh.fit }, sh.role);
  const gks = gk ? effSkill({ ...gk, skill: gk.attrs.keeping * 0.8 + gk.skill * 0.2, fitness: gk.fit }, 'GK') : 30;
  const long = !penalty && !header && sh.role !== 'FW' && rng.chance(0.4);
  st.stats.shots[a]++; touch(st, sh.id).shots++;
  if (asst) touch(st, asst.id).key++;
  const ev = { t, half, team: a, pid: sh.id, assist: asst?.id, keeper: gk?.id, build: penalty ? [] : build(rng, A, rng.int(1, 3)), header, penalty, long };
  ev.aimY = rng.range(-1, 1); ev.aimZ = rng.range(0, 1);
  let onT = penalty ? 0.83 : clamp(0.37 + (sk - 65) / 260 - (long ? 0.09 : 0) - (header ? 0.05 : 0), 0.18, 0.62);
  if (rng.chance(onT)) {
    st.stats.sot[a]++;
    let gp = penalty ? clamp(0.78 + (sk - gks) / 300, 0.6, 0.9) : clamp(0.28 + (sk - gks) / 210 + (q - 0.5) * 0.4 - (long ? 0.12 : 0) - (header ? 0.04 : 0), 0.07, 0.62);
    if (rng.chance(gp)) {
      st.score[a]++;
      touch(st, sh.id).goals++; if (asst) touch(st, asst.id).assists++;
      st.events.push({ ...ev, kind: 'goal', score: st.score.slice() });
      return;
    }
    st.stats.saves[d]++; if (gk) touch(st, gk.id).saves++;
    const corner = !penalty && rng.chance(0.3);
    ev.parry = corner || rng.chance(0.35);
    st.events.push({ ...ev, kind: 'save', corner });
    if (corner) { st.stats.corners[a]++; cornerKick(st, a, t + 0.3, half, rng, R); }
    return;
  }
  const corner = !penalty && rng.chance(0.14);
  ev.aimY = (rng.chance(0.5) ? 1 : -1) * rng.range(1.05, 1.6);
  ev.over = rng.chance(0.4); if (ev.over) { ev.aimY *= 0.6; ev.aimZ = rng.range(1.15, 1.8); }
  st.events.push({ ...ev, kind: 'miss', corner });
  if (corner) { st.stats.corners[a]++; cornerKick(st, a, t + 0.3, half, rng, R); }
}

function cornerKick(st, a, t, half, rng, R) {
  if (rng.chance(0.36)) {
    const q = R[a].att / (R[a].att + R[1 - a].def);
    st.events.push({ t, half, team: a, kind: 'corner', side: rng.chance(0.5) ? 1 : -1 });
    shot(st, a, t + 0.05, half, rng, R, q * 0.8, { header: true });
  } else {
    st.events.push({ t, half, team: a, kind: 'corner', side: rng.chance(0.5) ? 1 : -1, cleared: true });
  }
}

function foul(st, d, a, t, half, rng, inBox, R) {
  const D = st.teams[d], A = st.teams[a];
  const f = pickRole(rng, D, W_FOUL); const victim = pickRole(rng, A, W_SHOOT);
  if (!f) return;
  st.stats.fouls[d]++;
  const r = rng.next();
  let card = null;
  if (r < 0.012) card = 'red';
  else if (r < 0.15 + (inBox ? 0.2 : 0)) card = f.yellow ? 'red2' : 'yellow';
  const ev = { t, half, team: d, kind: card ? (card === 'yellow' ? 'yellow' : 'red') : 'foul', pid: f.id, victim: victim?.id, inBox, second: card === 'red2' };
  if (card || inBox || rng.chance(0.12)) st.events.push(ev);
  if (card === 'yellow') { f.yellow = 1; st.stats.yellows[d]++; touch(st, f.id).yellow++; }
  if (card === 'red' || card === 'red2') {
    st.stats.reds[d]++; touch(st, f.id).red++;
    if (card === 'red2') st.stats.yellows[d]++;
    const idx = D.on.indexOf(f); D.on.splice(idx, 1);
    if (f.role === 'GK' && D.on.length) {
      // emergency keeper: sub on bench GK if possible, else an outfielder goes in goal
      const bgk = D.subsLeft > 0 ? D.bench.find(p => p.pos === 'GK') : null;
      if (bgk) {
        const outI = D.on.reduce((bi, p, i) => (p.role !== 'GK' && (bi < 0 || p.skill < D.on[bi].skill) ? i : bi), -1);
        const out = D.on[outI];
        D.bench.splice(D.bench.indexOf(bgk), 1);
        D.on[outI] = { ...bgk, role: 'GK', slot: f.slot, fit: bgk.fitness, yellow: 0 };
        D.subsLeft--; D.used.push(out.id); touch(st, bgk.id).subOn = t;
        st.events.push({ t: t + 0.1, half, team: d, kind: 'sub', outId: out.id, inId: bgk.id, slot: f.slot });
      } else { D.on[0].role = 'GK'; }
    }
  }
  if (inBox) {
    const q = R ? R[a].att / (R[a].att + R[d].def) : 0.5;
    st.events.push({ t: t + 0.2, half, team: a, kind: 'penalty', pid: victim?.id });
    const taker = A.on.slice().sort((x, y) => y.attrs.shooting - x.attrs.shooting)[0];
    shot(st, a, t + 0.4, half, rng, R, q, { penalty: true, shooter: taker });
  }
}

function injury(st, k, t, half, rng) {
  const T = st.teams[k];
  const p = rng.pick(T.on); if (!p) return;
  const weeks = rng.int(1, 6);
  touch(st, p.id).injury = weeks;
  st.events.push({ t, half, team: k, kind: 'injury', pid: p.id, weeks });
  if (T.subsLeft > 0 && !T.manual) doSub(st, k, p, t + 0.2, half);
}

function bestBench(T, role) {
  const pool = T.bench.filter(b => !T.used.includes(b.id));
  pool.sort((a, b) => effSkill(b, role) - effSkill(a, role));
  return pool[0];
}
function doSub(st, k, out, t, half) {
  const T = st.teams[k];
  const inn = bestBench(T, out.role); if (!inn) return;
  if (out.role === 'GK' && inn.pos !== 'GK' && T.bench.some(b => b.pos === 'GK')) return doSubWith(st, k, out, T.bench.find(b => b.pos === 'GK'), t, half);
  doSubWith(st, k, out, inn, t, half);
}
function doSubWith(st, k, out, inn, t, half) {
  const T = st.teams[k];
  const i = T.on.indexOf(out); if (i < 0) return;
  T.bench.splice(T.bench.indexOf(inn), 1);
  T.on[i] = { ...inn, role: out.role, slot: out.slot, fit: inn.fitness, yellow: 0 };
  T.subsLeft--; T.used.push(out.id);
  touch(st, inn.id).subOn = t;
  st.events.push({ t, half, team: k, kind: 'sub', outId: out.id, inId: inn.id, slot: out.slot });
}
function maybeAutoSub(st, k, t, rng) {
  const T = st.teams[k];
  if (T.subsLeft <= 0 || T.manual) return;
  if (!rng.chance(t > 75 ? 0.09 : 0.05)) return;
  const tired = T.on.filter(p => p.role !== 'GK').sort((a, b) => a.fit - b.fit)[0];
  if (!tired || tired.fit > 72 && t < 80) return;
  doSub(st, k, tired, t, 2);
}

function finalize(st, ht, home, away, seed) {
  const ratingsOut = {};
  const won = st.score[0] > st.score[1] ? 0 : st.score[1] > st.score[0] ? 1 : -1;
  st.teams.forEach((T, k) => {
    const all = home && away ? (k === 0 ? home : away) : null;
    const ids = new Set([...T.on.map(p => p.id), ...T.used]);
    for (const id of ids) {
      const s = touch(st, id);
      let r = 6.3 + s.goals * 0.9 + s.assists * 0.55 + s.key * 0.08 + s.saves * 0.18 + s.tackles * 0.12 - s.yellow * 0.3 - s.red * 1.5;
      r += won === k ? 0.45 : won === -1 ? 0 : -0.35;
      r -= st.score[1 - k] * (all && all.xi.find(p => p.id === id)?.role === 'GK' ? 0.28 : all && all.xi.find(p => p.id === id)?.role === 'DF' ? 0.14 : 0.04);
      r += ((hashish(id + seed) % 100) / 100 - 0.5) * 0.8;
      ratingsOut[id] = Math.round(clamp(r, 3.5, 10) * 10) / 10;
    }
  });
  let motm = null, best = -1;
  for (const id in ratingsOut) if (ratingsOut[id] > best) { best = ratingsOut[id]; motm = id; }
  const tot = st.stats.phases[0] + st.stats.phases[1] || 1;
  st.events.sort((a, b) => a.t - b.t);
  return {
    seed, score: st.score.slice(), events: st.events, added: st.added.slice(), poss: st.poss,
    stats: { ...st.stats, possession: [Math.round(st.stats.phases[0] / tot * 100), 100 - Math.round(st.stats.phases[0] / tot * 100)] },
    ps: st.ps, ratings: ratingsOut, motm,
    finalOn: st.teams.map(T => T.on.map(p => ({ id: p.id, fit: Math.round(p.fit) }))),
    ht, sheets: [home, away],
  };
}
function hashish(s) { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
