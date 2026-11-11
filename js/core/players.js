import { clamp } from './rng.js';
import { NAME_GROUPS, NATIONS } from './names.js';
import { FORMATIONS } from './constants.js';

export function newId(state, prefix) { state.nextId = (state.nextId || 1) + 1; return prefix + state.nextId.toString(36); }

const ATTR_BIAS = {
  GK: { keeping: 8, pace: -14, shooting: -30, passing: -10, defending: -6 },
  DF: { keeping: -45, pace: -2, shooting: -12, passing: -3, defending: 8 },
  MF: { keeping: -45, pace: 0, shooting: -2, passing: 8, defending: -4 },
  FW: { keeping: -45, pace: 4, shooting: 9, passing: -3, defending: -16 },
};
export const ATTRS = ['pace', 'shooting', 'passing', 'defending', 'keeping'];

export function makeAttrs(rng, pos, skill) {
  const a = {};
  for (const k of ATTRS) a[k] = Math.round(clamp(skill + ATTR_BIAS[pos][k] + rng.normal(0, 5), 5, 99));
  a.stamina = Math.round(clamp(rng.normal(70, 12), 35, 99));
  return a;
}

// Overall rating is recomputed from attributes after training so the two never drift apart.
const WEIGHTS = {
  GK: { keeping: 0.85, passing: 0.08, pace: 0.07 },
  DF: { defending: 0.6, pace: 0.2, passing: 0.15, shooting: 0.05 },
  MF: { passing: 0.5, defending: 0.15, shooting: 0.2, pace: 0.15 },
  FW: { shooting: 0.6, pace: 0.25, passing: 0.15 },
};
export function overall(p) {
  const w = WEIGHTS[p.pos]; let s = 0;
  for (const k in w) s += p.attrs[k] * w[k];
  return Math.round(s - (ATTR_BIAS[p.pos].keeping < 0 ? 0 : 0));
}
function calibrate(p, target) {
  // shift attributes so overall() matches the generated skill
  for (let i = 0; i < 3; i++) {
    const d = target - overall(p);
    for (const k of ATTRS) p.attrs[k] = clamp(p.attrs[k] + d, 5, 99);
  }
}

export function playerValue(p) {
  const s = p.skill;
  let v = 20000 * Math.pow(1.14, s - 40);
  const pot = Math.max(0, p.potential - p.skill);
  if (p.age <= 21) v *= 1.25 + pot / 40; else if (p.age <= 24) v *= 1.15 + pot / 60;
  else if (p.age >= 33) v *= 0.3; else if (p.age >= 30) v *= 0.6;
  if (p.injury > 0) v *= 0.85;
  return Math.max(10000, roundMoney(v));
}
export function wageDemand(p) {
  return Math.max(800, roundMoney(playerValue(p) * 0.011 + 600, 100));
}
export function roundMoney(v, step) {
  step = step || (v > 1e6 ? 50000 : v > 1e5 ? 5000 : 1000);
  return Math.round(v / step) * step;
}

export function makePlayer(state, rng, { pos, mean, age, clubId = null }) {
  const id = newId(state, 'p');
  age = age ?? rng.int(17, 34);
  let skill = rng.normal(mean, 6);
  if (age < 22) skill -= (22 - age) * 2.4;
  if (age > 31) skill -= (age - 31) * 1.6;
  skill = Math.round(clamp(skill, 28, 94));
  const headroom = age < 24 ? rng.range(3, 20) * (24 - age) / 6 : rng.range(0, 3);
  const potential = Math.round(clamp(skill + headroom, skill, 96));
  const nat = rng.weighted(NATIONS, n => n[2]);
  const g = NAME_GROUPS[nat[0]];
  const p = {
    id, first: rng.pick(g.first), last: rng.pick(g.last), nat: nat[1], age, pos, skill, potential,
    attrs: makeAttrs(rng, pos, skill), form: 6.5, fitness: 100, morale: 70, injury: 0, suspended: 0,
    contract: rng.int(1, 4), clubId, number: 0, listed: false, scouted: false, xp: 0,
    stats: { apps: 0, goals: 0, assists: 0, ratingSum: 0, yellows: 0, reds: 0 },
    look: { skin: rng.int(0, 5), hair: rng.int(0, 6) },
  };
  calibrate(p, skill);
  p.skill = overall(p);
  p.value = playerValue(p);
  p.wage = wageDemand(p);
  return p;
}

export const fullName = p => `${p.first} ${p.last}`;
export const shortName = p => `${p.first ? p.first[0] + '. ' : ''}${p.last}`;

// Effective skill for a given role, including fitness, form, and being out of position.
export function effSkill(p, role) {
  let s = p.skill;
  if (p.pos !== role) {
    if (role === 'GK' || p.pos === 'GK') s *= 0.45;
    else if ((p.pos === 'DF' && role === 'FW') || (p.pos === 'FW' && role === 'DF')) s *= 0.72;
    else s *= 0.86;
  }
  s *= 0.8 + 0.2 * (p.fitness / 100);
  s *= 1 + (p.form - 6.5) * 0.014;
  s *= 0.97 + 0.06 * (p.morale / 100);
  return s;
}

export function available(p) { return p.injury <= 0 && p.suspended <= 0; }

// Picks the best XI for a formation, greedy by role, plus a 7-man bench.
export function autoLineup(state, club) {
  const slots = FORMATIONS[club.formation];
  const squad = club.playerIds.map(id => state.players[id]).filter(available);
  const used = new Set();
  const lineup = new Array(slots.length).fill(null);
  const order = slots.map((s, i) => i).sort((a, b) => (slots[a][0] === 'GK' ? -1 : 0) - (slots[b][0] === 'GK' ? -1 : 0));
  for (const i of order) {
    const role = slots[i][0];
    let best = null, bv = -1;
    for (const p of squad) { if (used.has(p.id)) continue; const v = effSkill(p, role) * (p.pos === role ? 1.1 : 1); if (v > bv) { bv = v; best = p; } }
    if (best) { lineup[i] = best.id; used.add(best.id); }
  }
  const rest = squad.filter(p => !used.has(p.id)).sort((a, b) => effSkill(b, b.pos) - effSkill(a, a.pos));
  const bench = [];
  const gk = rest.find(p => p.pos === 'GK'); if (gk) bench.push(gk.id);
  for (const p of rest) { if (bench.length >= 7) break; if (!bench.includes(p.id)) bench.push(p.id); }
  club.lineup = lineup.filter(Boolean).length === slots.length ? lineup : lineup.map(x => x || null);
  club.bench = bench;
}

// Makes sure a human lineup is still valid (injuries, sales). Fills holes automatically.
export function repairLineup(state, club) {
  const slots = FORMATIONS[club.formation];
  const owned = new Set(club.playerIds);
  let ok = club.lineup && club.lineup.length === slots.length;
  if (ok) for (const id of club.lineup) { const p = state.players[id]; if (!id || !owned.has(id) || !p || !available(p)) { ok = false; break; } }
  if (!ok) {
    const keep = (club.lineup || []).slice(0, slots.length);
    const used = new Set();
    const lineup = slots.map((s, i) => { const id = keep[i]; const p = state.players[id]; if (id && owned.has(id) && p && available(p) && !used.has(id)) { used.add(id); return id; } return null; });
    const pool = club.playerIds.map(id => state.players[id]).filter(p => available(p) && !used.has(p.id));
    lineup.forEach((id, i) => {
      if (id) return; const role = slots[i][0];
      pool.sort((a, b) => effSkill(b, role) - effSkill(a, role));
      const p = pool.shift(); if (p) { lineup[i] = p.id; used.add(p.id); }
    });
    club.lineup = lineup;
  }
  const inXI = new Set(club.lineup);
  club.bench = (club.bench || []).filter(id => owned.has(id) && !inXI.has(id) && available(state.players[id]));
  if (club.bench.length < 5) {
    const extra = club.playerIds.map(id => state.players[id]).filter(p => available(p) && !inXI.has(p.id) && !club.bench.includes(p.id)).sort((a, b) => b.skill - a.skill);
    while (club.bench.length < 7 && extra.length) club.bench.push(extra.shift().id);
  }
}

export function assignNumbers(state, club) {
  const taken = new Set();
  const ps = club.playerIds.map(id => state.players[id]);
  for (const p of ps) if (p.number && !taken.has(p.number)) taken.add(p.number); else p.number = 0;
  const pref = { GK: [1, 12, 25, 30], DF: [2, 3, 4, 5, 6, 15, 23, 24, 26], MF: [8, 6, 10, 14, 16, 18, 20, 21, 22], FW: [9, 11, 7, 17, 19, 27, 29] };
  for (const p of ps) {
    if (p.number) continue;
    let n = pref[p.pos].find(x => !taken.has(x));
    if (!n) { n = 13; while (taken.has(n)) n++; }
    p.number = n; taken.add(n);
  }
}
