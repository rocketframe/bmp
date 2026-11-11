// Game rules: day clock, matchdays, training, transfers, season end.
// Every mutation goes through dispatch(state, command) so a future multiplayer server can
// validate and apply the same commands from many managers against one shared world.
import { makeRng, hashSeed, clamp } from './rng.js';
import { FORMATIONS, MENTALITIES, TRAINING_FOCUS, LEAGUE } from './constants.js';
import { createWorld, computeTable, divisionOf, fixtureFor, newSeasonFixtures, seasonLength, fillSquad } from './world.js';
import { makePlayer, playerValue, wageDemand, autoLineup, repairLineup, assignNumbers, overall, ATTRS, fullName, shortName, effSkill, available, roundMoney } from './players.js';
import { simulateMatch, resimSecondHalf, makeSheet } from './sim.js';
import { ledger, settleMatchdayFinances, seasonPrize, resetSeasonLedger, sponsorWeekly, expectedAttendance, divConf } from './finance.js';

// ---------- clock ----------
export function dateKey(d) { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
export function dayNumber(key) { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
export function realToday(state, now = new Date()) {
  const d = new Date(now.getTime() + (state?.calendar?.devOffset || 0) * 86400000);
  return dateKey(d);
}

function rngFor(state, ...salt) { return makeRng(hashSeed(state.seed, state.calendar.day, state.season, ...salt)); }
function stepRng(state) { const r = makeRng(state.rngState || state.seed); return { r, done() { state.rngState = r.state; } }; }

export function human(state) { return state.clubs[state.humans[0]]; }
export function isHuman(state, clubId) { return state.humans.includes(clubId); }

// Per-manager parts (today, inbox, history, streak). Single player keeps them on the state itself, exactly
// as before. A multiplayer league (js/server/league.js) keeps one slot per human club in state.mgrs.
export function mgrOf(state, clubId) { return state.mgrs ? state.mgrs[clubId ?? state.humans[0]] : state; }
// The human clubs that get per-manager processing (single player: just the one).
const managed = state => (state.mgrs ? state.humans.slice() : [state.humans[0]]);

let inboxSeq = 0;
export function mail(state, title, body, kind = 'info', extra = {}, clubId) {
  const box = mgrOf(state, clubId);
  if (!box) return; // multiplayer: that club has no manager
  const id = state.mgrs ? 'm' + (state.mailSeq = (state.mailSeq || 0) + 1) : 'm' + state.calendar.day + '-' + (++inboxSeq) + '-' + box.inbox.length;
  box.inbox.unshift({ id, day: state.calendar.day, title, body, kind, read: false, ...extra });
  if (box.inbox.length > 80) box.inbox.length = 80;
}
function news(state, text) { state.news.unshift({ day: state.calendar.day, text }); if (state.news.length > 40) state.news.length = 40; }

// ---------- new game ----------
export function newGame({ seed, managerName, clubId, world, now = new Date() }) {
  const state = world || createWorld(seed, { managerName });
  state.managerName = managerName || 'Manager';
  const club = state.clubs[clubId];
  club.human = true; club.managerName = state.managerName;
  state.humans = [clubId];
  autoLineup(state, club);
  state.calendar.date = realToday(state, now);
  state.calendar.day = 1;
  state.calendar.lastLogin = state.calendar.date;
  state.calendar.streak = 1; state.calendar.bestStreak = 1;
  setBoardTarget(state);
  startDay(state);
  mail(state, `Welcome to ${club.name}`, `The board has handed you the keys to ${club.stadium.name}. ${boardLine(state)}\n\nEvery day brings one matchday. Train the squad, set your team, and play the match. Bids you place today are answered overnight. If you miss a day, your assistant plays the match, but the day's training is lost.`, 'board');
  return state;
}

function setBoardTarget(state) {
  for (const id of state.humans) setBoardTargetFor(state, id);
}
export function setBoardTargetFor(state, id) {
  const c = state.clubs[id];
  const div = divisionOf(state, id);
  const ranked = div.clubIds.slice().sort((a, b) => state.clubs[b].rep - state.clubs[a].rep);
  const r = ranked.indexOf(id) + 1;
  c.board = { target: Math.min(LEAGUE.clubsPerDivision - 2, Math.max(1, r + 1)), confidence: c.board?.confidence ?? 65 };
}
export function boardLine(state, clubId) {
  const c = clubId ? state.clubs[clubId] : human(state); const t = c.board.target;
  return t <= 1 ? 'The board expects the title.' : `The board expects a finish of ${ordinal(t)} or better.`;
}
export const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// ---------- daily loop ----------
const OBJECTIVES = {
  win: { label: 'Win today’s match', w: 3 },
  score2: { label: 'Score at least 2 goals', w: 2 },
  clean: { label: 'Keep a clean sheet', w: 2 },
  train: { label: 'Run a training session', w: 3 },
  watch: { label: 'Watch the match live', w: 2, live: true },
  scout: { label: 'Send a scout to watch a player', w: 1.5 },
  bid: { label: 'Make a bid or sign a player', w: 1 },
  crowd: { label: 'Fill 90% of your stadium', w: 1.5, homeOnly: true },
};
function startDay(state) {
  for (const id of managed(state)) startDayFor(state, id);
}
export function startDayFor(state, clubId) {
  const rng = state.mgrs ? rngFor(state, 'day', clubId) : rngFor(state, 'day');
  const c = state.clubs[clubId];
  const fx = fixtureFor(state, c.id);
  const home = fx && fx.h === c.id;
  // multiplayer matchdays are played by the server, so there is no live match to watch
  const pool = Object.entries(OBJECTIVES).filter(([k, o]) => (!o.homeOnly || home) && !(state.mgrs && o.live));
  const picks = [];
  while (picks.length < 3 && pool.length) {
    const o = rng.weighted(pool, e => e[1].w); pool.splice(pool.indexOf(o), 1);
    if (o[0] === 'clean' && picks.includes('score2')) continue;
    picks.push(o[0]);
  }
  const base = c.divisionId === 'd1' ? 90000 : 30000;
  mgrOf(state, clubId).today = {
    md: state.md, played: false, trained: false, watched: false, pending: null,
    objectives: picks.map(k => ({ key: k, label: OBJECTIVES[k].label, reward: roundMoney(base * rng.range(0.8, 1.6)), done: false })),
    scoutsUsed: 0, report: null,
  };
}

export function completeObjective(state, key, clubId) {
  const o = mgrOf(state, clubId)?.today?.objectives.find(x => x.key === key && !x.done);
  if (!o) return null;
  o.done = true;
  ledger(state.clubs[clubId ?? state.humans[0]], 'bonus', o.reward, state, `Daily objective: ${o.label}`);
  return o;
}

// Call on every app open. Processes missed days and the login streak. Returns a digest for the briefing.
export function syncClock(state, now = new Date()) {
  const today = realToday(state, now);
  const digest = { days: 0, autoPlayed: [], streakBonus: 0, newDay: false };
  const gap = dayNumber(today) - dayNumber(state.calendar.date);
  if (gap > 0) {
    const steps = Math.min(gap, 60);
    for (let i = 0; i < steps; i++) {
      const res = endDay(state, i < steps - 1);
      if (res) digest.autoPlayed.push(res);
      digest.days++;
    }
    state.calendar.date = today;
    digest.newDay = true;
  }
  // login streak (real dates)
  const last = state.calendar.lastLogin;
  if (last !== today) {
    const diff = dayNumber(today) - dayNumber(last);
    state.calendar.streak = diff === 1 ? state.calendar.streak + 1 : 1;
    state.calendar.bestStreak = Math.max(state.calendar.bestStreak, state.calendar.streak);
    state.calendar.lastLogin = today;
    const c = human(state);
    const s = Math.min(state.calendar.streak, 7);
    const bonus = roundMoney((c.divisionId === 'd1' ? 40000 : 15000) * s);
    ledger(c, 'bonus', bonus, state, `Sponsor loyalty bonus (day ${state.calendar.streak} streak)`);
    if (state.calendar.streak % 7 === 0) { c.hype = clamp((c.hype || 0) + 6, -20, 30); }
    digest.streakBonus = bonus;
  }
  return digest;
}

// Ends the current day: plays the matchday if needed, then runs everything that happens overnight.
function endDay(state, silent) {
  let auto = null;
  if (!state.today.played) {
    const c = human(state);
    repairLineup(state, c);
    prepareMatchday(state);
    const um = state.today.pending.user;
    auto = um ? { md: state.md, score: um.result.score, home: um.home, away: um.away } : null;
    commitMatchday(state);
    if (auto) mail(state, `Assistant report: ${state.clubs[auto.home].short} ${auto.score[0]}-${auto.score[1]} ${state.clubs[auto.away].short}`, 'You were away, so your assistant took charge of the match with your last tactics. No training took place.', 'match');
  }
  overnight(state);
  state.calendar.day++;
  if (state.md >= seasonLength(state)) endSeason(state);
  startDay(state);
  return auto;
}

export function devSkipDay(state) {
  state.calendar.devOffset = (state.calendar.devOffset || 0) + 1;
}

// ---------- matchday ----------
export function prepareMatchday(state) {
  const hold = state.mgrs ? state : state.today;
  if (hold.pending) return hold.pending;
  const out = { fixtures: [], user: null };
  if (state.mgrs) out.byClub = {};
  for (const div of state.divisions) {
    const round = state.fixtures[div.id][state.md] || [];
    round.forEach((f, i) => {
      const H = state.clubs[f.h], A = state.clubs[f.a];
      for (const c of [H, A]) { if (!c.human) autoLineup(state, c); else repairLineup(state, c); }
      const seed = hashSeed(state.seed, state.season, state.md, div.id, i);
      const result = simulateMatch(makeSheet(state, H), makeSheet(state, A), seed);
      const entry = { div: div.id, idx: i, h: f.h, a: f.a, result };
      out.fixtures.push(entry);
      if (H.human || A.human) out.user = { ...entry, home: f.h, away: f.a, userSide: H.human ? 0 : 1 };
      if (out.byClub) {
        if (H.human) out.byClub[f.h] = { ...entry, home: f.h, away: f.a, userSide: 0 };
        if (A.human) out.byClub[f.a] = { ...entry, home: f.h, away: f.a, userSide: 1 };
      }
    });
  }
  hold.pending = out;
  return out;
}

export function halftimeChange(state, changes) {
  const p = state.today.pending; if (!p?.user) return null;
  const u = p.user;
  const seed = hashSeed(u.result.seed, 'ht', JSON.stringify(changes));
  const r = resimSecondHalf(u.result, u.userSide, changes, seed);
  u.result = r;
  const f = p.fixtures.find(x => x.div === u.div && x.idx === u.idx); f.result = r;
  if (changes.mentality) human(state).mentality = changes.mentality;
  return r;
}

export function commitMatchday(state) {
  const hold = state.mgrs ? state : state.today;
  const p = hold.pending || prepareMatchday(state);
  const rng = rngFor(state, 'commit');
  const tableCache = {};
  for (const div of state.divisions) tableCache[div.id] = computeTable(state, div.id);
  const posOf = id => (tableCache[divisionOf(state, id).id].find(r => r.id === id) || {}).pos || 6;
  const userId = state.humans[0];
  for (const e of p.fixtures) {
    const f = state.fixtures[e.div][state.md][e.idx];
    const r = e.result;
    f.r = { s: r.score.slice(), goals: r.events.filter(x => x.kind === 'goal').map(x => ({ t: Math.round(x.t), team: x.team, pid: x.pid, pen: !!x.penalty })), motm: r.motm };
    applyPlayerOutcomes(state, e, rng);
    for (const [k, cid] of [[0, f.h], [1, f.a]]) {
      const c = state.clubs[cid]; const gf = r.score[k], ga = r.score[1 - k];
      c.hype = clamp((c.hype || 0) * 0.85 + (gf > ga ? 3 : gf < ga ? -3 : 0), -20, 30);
      for (const pid of c.playerIds) { const pl = state.players[pid]; pl.morale = clamp(pl.morale + (gf > ga ? 4 : gf < ga ? -4 : 0) + (70 - pl.morale) * 0.05, 10, 100); }
      c.cohesion = clamp((c.cohesion ?? 50) + 1.5, 0, 100);
    }
  }
  const allFixtures = state.divisions.flatMap(div => state.fixtures[div.id][state.md]);
  settleMatchdayFinances(state, allFixtures, posOf, rng);
  if (state.mgrs) {
    for (const id of state.humans) { if (p.byClub[id]) matchReport(state, p.byClub[id], id); mgrOf(state, id).today.played = true; }
  } else if (p.user) matchReport(state, p.user, userId);
  state.md++;
  if (!state.mgrs) state.today.played = true;
  hold.pending = null;
}
function matchReport(state, u, userId) {
  const side = u.userSide, s = u.result.score;
  const f = state.fixtures[u.div][state.md][u.idx];
  mgrOf(state, userId).today.report = { home: u.home, away: u.away, score: s.slice(), motm: u.result.motm, att: f.r.att };
  if (s[side] > s[1 - side]) completeObjective(state, 'win', userId);
  if (s[side] >= 2) completeObjective(state, 'score2', userId);
  if (s[1 - side] === 0) completeObjective(state, 'clean', userId);
  if (u.home === userId) { const c = state.clubs[userId]; if (f.r.att >= c.stadium.capacity * 0.9) completeObjective(state, 'crowd', userId); }
}

// Multiplayer: the server plays the matchday for every club at once and then runs the night.
// Returns each human club's match (with the full timeline, so browsers can replay it).
export function playDayAll(state) {
  const p = prepareMatchday(state);
  const md = state.md, season = state.season;
  const matches = {};
  for (const id of state.humans) if (p.byClub[id]) matches[id] = p.byClub[id];
  commitMatchday(state);
  for (const id of state.humans) {
    const t = mgrOf(state, id).today;
    mgrOf(state, id).yesterday = { md, season, report: t.report, objectives: t.objectives, trained: t.trained, trainingReport: t.trainingReport || null };
  }
  overnight(state);
  state.calendar.day++;
  if (state.md >= seasonLength(state)) endSeason(state);
  startDay(state);
  return { md, season, matches };
}

function applyPlayerOutcomes(state, e, rng) {
  const r = e.result;
  const sheets = r.sheets;
  const played = new Set();
  sheets.forEach((sh, k) => {
    for (const p of sh.xi) played.add(p.id);
  });
  for (const id in r.ps) if (r.ps[id].subOn !== undefined) played.add(id);
  const finalFit = {};
  for (const team of r.finalOn) for (const x of team) finalFit[x.id] = x.fit;
  for (const id of played) {
    const p = state.players[id]; if (!p) continue;
    const s = r.ps[id] || {};
    p.stats.apps++; p.stats.goals += s.goals || 0; p.stats.assists += s.assists || 0;
    const rating = r.ratings[id] ?? 6;
    p.stats.ratingSum += rating; p.lastRating = rating;
    p.form = clamp(p.form * 0.65 + rating * 0.35, 3, 10);
    p.fitness = clamp(finalFit[id] ?? (p.fitness - 22), 25, 100);
    p.xp = (p.xp || 0) + 1;
    if (s.yellow) { p.stats.yellows++; if (p.stats.yellows % 5 === 0) { p.suspended = 1; if (isHumanPlayer(state, p)) mail(state, `${fullName(p)} suspended`, `${fullName(p)} picked up a fifth yellow card and misses the next match.`, 'squad', {}, p.clubId); } }
    if (s.red) { p.stats.reds++; p.suspended = rng.int(1, 3); if (isHumanPlayer(state, p)) mail(state, `${fullName(p)} sent off`, `${fullName(p)} is suspended for ${p.suspended} match${p.suspended > 1 ? 'es' : ''}.`, 'squad', {}, p.clubId); }
    if (s.injury) { p.injury = s.injury * 3; if (isHumanPlayer(state, p)) mail(state, `Injury: ${fullName(p)}`, `The physio expects ${fullName(p)} to be out for about ${p.injury} days.`, 'squad', {}, p.clubId); }
  }
  // suspensions served by players who were suspended and didn't play
  for (const cid of [e.h, e.a]) for (const pid of state.clubs[cid].playerIds) {
    const p = state.players[pid]; if (!played.has(pid) && p.suspended > 0 && !p._justSuspended) p.suspended--;
  }
}
const isHumanPlayer = (state, p) => p.clubId && state.clubs[p.clubId]?.human;

// ---------- training ----------
export function trainingGainChance(p, facility) {
  const gap = Math.max(0, p.potential - p.skill);
  const age = p.age <= 21 ? 1.5 : p.age <= 24 ? 1.2 : p.age <= 28 ? 0.8 : p.age <= 31 ? 0.45 : 0.2;
  return clamp(0.05 * age * (0.4 + gap / 10) * (0.85 + facility * 0.15), 0, 0.6);
}
function runTraining(state, club, focusKey, individual, rng, isAuto) {
  const focus = TRAINING_FOCUS[focusKey] || TRAINING_FOCUS.balanced;
  const report = [];
  const fac = club.facilities.training;
  for (const pid of club.playerIds) {
    const p = state.players[pid];
    if (p.injury > 0) continue;
    const ind = individual.includes(pid) ? 2.6 : 1;
    const relevant = focus.attrs.filter(a => a !== 'keeping' || p.pos === 'GK').filter(a => !(p.pos === 'GK' && a === 'shooting'));
    const before = p.skill;
    const gained = [];
    for (const a of relevant.length ? relevant : ['passing']) {
      const ch = trainingGainChance(p, fac) * focus.gain * ind * (isAuto ? 0.55 : 1);
      if (p.skill < p.potential && rng.chance(ch)) { p.attrs[a] = Math.min(99, p.attrs[a] + 1); gained.push(a); }
    }
    p.skill = Math.min(p.potential, overall(p));
    p.fitness = clamp(p.fitness + focus.fit, 20, 100);
    if (gained.length) report.push({ id: pid, gained, up: p.skill - before });
  }
  if (focus.cohesion) club.cohesion = clamp((club.cohesion ?? 50) + focus.cohesion, 0, 100);
  return report;
}

// ---------- overnight ----------
function overnight(state) {
  const rng = rngFor(state, 'night');
  // AI training and recovery
  for (const c of Object.values(state.clubs)) {
    if (!c.human) runTraining(state, c, 'balanced', [], rng, true);
    for (const pid of c.playerIds) {
      const p = state.players[pid];
      p.fitness = clamp(p.fitness + 9 + c.facilities.training, 20, 100);
      if (p.injury > 0) p.injury--;
      if (p.injury === 0 && p._inj) { delete p._inj; }
    }
  }
  resolveBids(state, rng);
  // scouting
  for (const s of state.scouting.filter(s => s.readyDay <= state.calendar.day + 1)) {
    const p = state.players[s.playerId]; if (!p) continue;
    if (state.mgrs) { const m = mgrOf(state, s.clubId); if (!m) continue; (m.scouted ||= {})[p.id] = 1; } // each manager's scouting is private
    else p.scouted = true;
    mail(state, `Scout report: ${fullName(p)}`, `${fullName(p)} (${p.age}, ${p.pos}) is rated ${p.skill} now, with potential to reach about ${p.potential}. ${p.potential - p.skill > 10 ? 'Our scout thinks he could become a star.' : p.potential - p.skill > 4 ? 'There is room to grow.' : 'He is close to his ceiling.'}`, 'scout', { playerId: p.id }, s.clubId);
  }
  state.scouting = state.scouting.filter(s => s.readyDay > state.calendar.day + 1);
  // builds
  for (const b of state.builds.filter(b => b.readyDay <= state.calendar.day + 1)) {
    const c = state.clubs[b.clubId];
    if (b.kind === 'stadium') { c.stadium.capacity += b.amount; mail(state, 'Stadium expansion complete', `${c.stadium.name} now holds ${c.stadium.capacity.toLocaleString()} fans.`, 'club', {}, c.id); }
    if (b.kind === 'training') { c.facilities.training++; mail(state, 'Training ground upgraded', `The training ground is now level ${c.facilities.training}. Players improve faster.`, 'club', {}, c.id); }
    if (b.kind === 'youth') { c.facilities.youth++; mail(state, 'Youth academy upgraded', `The academy is now level ${c.facilities.youth}. Better prospects will come through.`, 'club', {}, c.id); }
  }
  state.builds = state.builds.filter(b => b.readyDay > state.calendar.day + 1);
  // expire offers
  state.offers = state.offers.filter(o => o.status === 'open' && o.expires > state.calendar.day);
  aiTransfers(state, rng);
  for (const id of managed(state)) incomingOffers(state, rng, id);
  if ((state.calendar.day + 1) % 7 === 0) for (const id of managed(state)) youthProspect(state, rng, id);
  for (const c of Object.values(state.clubs)) if (!c.human) autoLineup(state, c);
  for (const id of managed(state)) repairLineup(state, state.clubs[id]);
}

// ---------- transfers ----------
export function askingPrice(state, p) {
  if (!p.clubId) return 0;
  const club = state.clubs[p.clubId];
  const squad = club.playerIds.map(id => state.players[id]).sort((a, b) => b.skill - a.skill);
  const rank = squad.indexOf(p);
  let f = rank < 11 ? 1.4 : rank < 16 ? 1.15 : 0.95;
  if (p.listed) f *= 0.85;
  const samePos = squad.filter(x => x.pos === p.pos).length;
  if (samePos <= 2) f *= 1.3;
  if (p.contract <= 1) f *= 0.8;
  return roundMoney(playerValue(p) * f);
}
function committedBids(state, clubId) { return state.bids.filter(b => b.clubId === clubId).reduce((s, b) => s + b.fee, 0); }

function resolveBids(state, rng) {
  for (const b of state.bids) {
    const p = state.players[b.playerId]; const buyer = state.clubs[b.clubId];
    if (!p || p.clubId === b.clubId) continue;
    const seller = state.clubs[p.clubId];
    // the player left his club since the bid, or (multiplayer) another manager signed him first
    if (!seller || seller.human) { mail(state, `Bid lapsed: ${fullName(p)}`, `${fullName(p)} is no longer at the club we bid to, so the bid lapsed.`, 'transfer', {}, b.clubId); continue; }
    const ask = askingPrice(state, p);
    const thresh = ask * rng.range(0.9, 1.08);
    if (b.fee < thresh) {
      const hint = roundMoney(ask * 1.02);
      mail(state, `Bid rejected: ${fullName(p)}`, `${seller.name} turned down ${money(b.fee)} for ${fullName(p)}. Our sources say a bid of around ${money(hint)} might do it.`, 'transfer', { playerId: p.id }, b.clubId);
      continue;
    }
    const repGap = seller.rep - buyer.rep;
    if (repGap > 8 && rng.chance(clamp(repGap / 25, 0, 0.8))) {
      mail(state, `${fullName(p)} won't come`, `${seller.name} accepted the fee, but ${fullName(p)} doesn't want to step down to ${buyer.name}.`, 'transfer', {}, b.clubId); continue;
    }
    if (buyer.cash < b.fee) { mail(state, 'Bid collapsed', `We could not fund the ${money(b.fee)} deal for ${fullName(p)}.`, 'transfer', {}, b.clubId); continue; }
    if (buyer.playerIds.length >= LEAGUE.squadMax) { mail(state, 'Squad full', `The deal for ${fullName(p)} fell through because our squad is full (${LEAGUE.squadMax}).`, 'transfer', {}, b.clubId); continue; }
    moveP(state, p, buyer, b.fee);
    mail(state, `Signed: ${fullName(p)}`, `${fullName(p)} joins from ${seller.name} for ${money(b.fee)} on ${money(p.wage)} a week.`, 'transfer', { playerId: p.id }, b.clubId);
    news(state, `${buyer.name} sign ${fullName(p)} from ${seller.name} for ${money(b.fee)}.`);
  }
  state.bids = [];
}

function moveP(state, p, buyer, fee) {
  const seller = p.clubId ? state.clubs[p.clubId] : null;
  if (seller) {
    seller.playerIds = seller.playerIds.filter(x => x !== p.id);
    seller.lineup = seller.lineup.map(x => (x === p.id ? null : x));
    seller.bench = seller.bench.filter(x => x !== p.id);
    ledger(seller, 'transfersIn', fee, state, fee ? `Sold ${fullName(p)}` : null);
    if (!seller.human) autoLineup(state, seller); else repairLineup(state, seller);
  } else state.freeAgents = state.freeAgents.filter(x => x !== p.id);
  ledger(buyer, 'transfersOut', -fee, state, fee ? `Bought ${fullName(p)}` : null);
  p.clubId = buyer.id; buyer.playerIds.push(p.id);
  p.wage = wageDemand(p); p.contract = Math.max(p.contract, 3); p.listed = false; p.number = 0; p.morale = 75;
  if (buyer.human) p.scouted = true;
  assignNumbers(state, buyer);
  if (!buyer.human) autoLineup(state, buyer);
  state.offers = state.offers.filter(o => o.playerId !== p.id);
}

function aiTransfers(state, rng) {
  const ais = Object.values(state.clubs).filter(c => !c.human);
  const n = rng.int(0, 2);
  for (let k = 0; k < n; k++) {
    const buyer = rng.pick(ais);
    const pos = rng.pick(['GK', 'DF', 'MF', 'FW']);
    const mine = buyer.playerIds.map(id => state.players[id]).filter(p => p.pos === pos).sort((a, b) => b.skill - a.skill);
    const need = mine[1]?.skill ?? 40;
    const cands = Object.values(state.players).filter(p => p.pos === p.pos && p.pos === pos && p.clubId !== buyer.id && !state.clubs[p.clubId]?.human && p.skill > need + 2 && p.skill < buyer.rep + 8);
    if (!cands.length) continue;
    const p = rng.pick(cands);
    const fee = askingPrice(state, p);
    if (fee > buyer.cash * 0.6 || buyer.playerIds.length >= LEAGUE.squadMax) continue;
    if (p.clubId && state.clubs[p.clubId].playerIds.length <= LEAGUE.squadMin + 2) continue;
    const from = p.clubId ? state.clubs[p.clubId].name : 'free agency';
    moveP(state, p, buyer, fee);
    news(state, `${buyer.name} sign ${fullName(p)} from ${from}${fee ? ' for ' + money(fee) : ''}.`);
    // sell surplus
    if (buyer.playerIds.length > 26) {
      const worst = buyer.playerIds.map(id => state.players[id]).sort((a, b) => a.skill - b.skill)[0];
      release(state, buyer, worst, true);
    }
  }
}

function incomingOffers(state, rng, clubId) {
  const c = state.clubs[clubId];
  const ps = c.playerIds.map(id => state.players[id]);
  const listed = ps.filter(p => p.listed);
  const chance = 0.3 + listed.length * 0.2;
  if (!rng.chance(clamp(chance, 0, 0.9))) return;
  const p = listed.length && rng.chance(0.75) ? rng.pick(listed) : rng.weighted(ps, x => Math.pow(x.skill / 60, 4) * (x.age < 25 ? 2 : 1));
  if (!p || state.offers.some(o => o.playerId === p.id)) return;
  const buyers = Object.values(state.clubs).filter(b => !b.human && b.cash > p.value * 0.8 && b.rep > p.skill - 12 && b.playerIds.length < LEAGUE.squadMax);
  if (!buyers.length) return;
  const b = rng.pick(buyers);
  const fee = roundMoney(playerValue(p) * rng.range(p.listed ? 0.75 : 0.9, p.listed ? 1.1 : 1.35));
  state.offers.push({ id: 'o' + state.calendar.day + p.id, playerId: p.id, from: b.id, fee, expires: state.calendar.day + 2, status: 'open' });
  mail(state, `Offer for ${fullName(p)}`, `${b.name} offer ${money(fee)} for ${fullName(p)}. The offer is open until the end of today.`, 'offer', { playerId: p.id }, c.id);
}

function youthProspect(state, rng, clubId) {
  const c = state.clubs[clubId];
  const lvl = c.facilities.youth;
  const p = makePlayer(state, rng, { pos: rng.pick(['GK', 'DF', 'MF', 'MF', 'FW', 'FW']), mean: 50 + lvl * 4 + c.rep / 10, age: rng.int(16, 18) });
  p.potential = clamp(p.potential + lvl * 3 + rng.int(0, 8), p.skill + 6, 95);
  p.scouted = true; p.contract = 3; p.wage = roundMoney(800 + lvl * 300, 100);
  p.youthOf = c.id; p.youthExpires = state.calendar.day + 3;
  state.players[p.id] = p;
  state.freeAgents.push(p.id);
  mail(state, `Academy prospect: ${fullName(p)}`, `Your youth coach rates ${fullName(p)} (${p.age}, ${p.pos}) as a real talent: currently ${p.skill}, potential around ${p.potential}. Sign him for free within 3 days or another club will.`, 'youth', { playerId: p.id }, c.id);
}

export function release(state, club, p, silent) {
  const comp = club.human ? roundMoney(p.wage * Math.max(1, p.contract) * 8) : 0;
  if (comp) ledger(club, 'other', -comp, state, `Released ${fullName(p)} (compensation)`);
  club.playerIds = club.playerIds.filter(x => x !== p.id);
  club.lineup = club.lineup.map(x => (x === p.id ? null : x));
  club.bench = club.bench.filter(x => x !== p.id);
  p.clubId = null; p.listed = false; p.contract = 0;
  state.freeAgents.push(p.id);
  if (!silent) news(state, `${club.name} release ${fullName(p)}.`);
  return comp;
}

export const money = v => {
  const a = Math.abs(v); const s = v < 0 ? '-' : '';
  if (a >= 1e6) return `${s}€${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e3) return `${s}€${Math.round(a / 1e3)}K`;
  return `${s}€${a}`;
};

// ---------- season end ----------
function endSeason(state) {
  const rng = rngFor(state, 'season');
  const summary = { season: state.season, year: state.year, tables: {} };
  const moves = {};
  state.divisions.forEach((div, di) => {
    const table = computeTable(state, div.id);
    summary.tables[div.id] = table.map(r => ({ id: r.id, pts: r.pts, pos: r.pos }));
    table.forEach(r => {
      const c = state.clubs[r.id];
      ledger(c, 'prize', seasonPrize(state, div.id, r.pos), state, `Prize money: ${ordinal(r.pos)} in ${div.name}`);
      c.rep = clamp(c.rep + (LEAGUE.clubsPerDivision / 2 - r.pos) * 0.35, 40, 92);
    });
    summary[div.id + 'champ'] = table[0].id;
    news(state, `${state.clubs[table[0].id].name} are ${div.name} champions!`);
    if (di < state.divisions.length - 1) moves[div.id] = { down: table.slice(-LEAGUE.promote).map(r => r.id) };
    if (di > 0) moves[div.id] = { ...(moves[div.id] || {}), up: table.slice(0, LEAGUE.promote).map(r => r.id) };
  });
  // promotion / relegation
  for (let di = 0; di < state.divisions.length - 1; di++) {
    const upper = state.divisions[di], lower = state.divisions[di + 1];
    const down = moves[upper.id].down, up = moves[lower.id].up;
    upper.clubIds = upper.clubIds.filter(x => !down.includes(x)).concat(up);
    lower.clubIds = lower.clubIds.filter(x => !up.includes(x)).concat(down);
    for (const id of up) state.clubs[id].divisionId = upper.id;
    for (const id of down) state.clubs[id].divisionId = lower.id;
  }
  // user review
  for (const userId of managed(state)) {
    const uc = state.clubs[userId];
    const uDiv = Object.keys(summary.tables).find(k => summary.tables[k].some(r => r.id === userId));
    const uRow = summary.tables[uDiv].find(r => r.id === userId), uPos = uRow.pos;
    const target = uc.board.target;
    const delta = target - uPos;
    uc.board.confidence = clamp(uc.board.confidence + delta * 6, 5, 100);
    mgrOf(state, userId).history.push({ season: state.season, year: state.year, div: uDiv, pos: uPos, champion: summary[uDiv + 'champ'], target });
    if (state.mgrs) mgrOf(state, userId).points = (mgrOf(state, userId).points || 0) + uRow.pts; // league score across seasons
    const promoted = moves[uDiv]?.up?.includes(userId), relegated = moves[uDiv]?.down?.includes(userId);
    mail(state, `Season ${state.year}/${String(state.year + 1).slice(2)} review`, `You finished ${ordinal(uPos)} (target: ${ordinal(target)}). ${promoted ? 'Promotion! The club goes up.' : relegated ? 'Relegation. The board is not happy.' : delta >= 0 ? 'The board is pleased.' : 'The board expected more.'} Board confidence: ${Math.round(uc.board.confidence)}%.`, 'board', {}, userId);
  }
  // players: ageing, development, retirement, contracts
  for (const p of Object.values(state.players)) {
    p.age++;
    if (p.age >= 30) for (const a of ATTRS) if (rng.chance((p.age - 29) * 0.12)) p.attrs[a] = Math.max(5, p.attrs[a] - rng.int(1, 2));
    else if (p.age <= 23 && p.clubId) for (const a of ATTRS) if (p.skill < p.potential && rng.chance(0.25)) p.attrs[a] = Math.min(99, p.attrs[a] + 1);
    p.skill = Math.min(Math.max(p.potential, p.skill), overall(p));
    if (p.skill > p.potential) p.potential = p.skill;
    p.stats = { apps: 0, goals: 0, assists: 0, ratingSum: 0, yellows: 0, reds: 0 };
    p.suspended = 0;
    p.contract = Math.max(0, p.contract - 1);
    p.value = playerValue(p); p.wage = p.contract > 0 ? p.wage : wageDemand(p);
  }
  for (const c of Object.values(state.clubs)) {
    for (const pid of c.playerIds.slice()) {
      const p = state.players[pid];
      if (p.age >= 34 && rng.chance((p.age - 33) * 0.35)) {
        c.playerIds = c.playerIds.filter(x => x !== pid); delete state.players[pid];
        if (c.human) mail(state, `${fullName(p)} retires`, `${fullName(p)} hangs up his boots at ${p.age}.`, 'squad', {}, c.id);
        continue;
      }
      if (p.contract === 0) {
        if (c.human) { release(state, c, p, true); mail(state, `${fullName(p)} leaves`, `${fullName(p)}'s contract ran out and he has left the club.`, 'squad', {}, c.id); }
        else if (rng.chance(0.8)) { p.contract = rng.int(1, 3); p.wage = wageDemand(p); }
        else release(state, c, p, true);
      }
    }
    // youth intake for AI, top up squads
    if (!c.human) for (let k = 0; k < 2; k++) {
      const y = makePlayer(state, rng, { pos: rng.pick(['DF', 'MF', 'FW']), mean: c.rep - 8, age: rng.int(17, 19), clubId: c.id });
      state.players[y.id] = y; c.playerIds.push(y.id);
    }
    while (c.playerIds.length < 20) {
      const y = makePlayer(state, rng, { pos: rng.pick(['GK', 'DF', 'MF', 'FW']), mean: c.rep - 6, clubId: c.id });
      state.players[y.id] = y; c.playerIds.push(y.id);
    }
    assignNumbers(state, c);
    resetSeasonLedger(c);
    c.cohesion = clamp((c.cohesion ?? 50) * 0.7, 20, 100);
    if (!c.human) autoLineup(state, c); else repairLineup(state, c);
  }
  // clean old free agents
  state.freeAgents = state.freeAgents.filter(id => state.players[id] && state.players[id].age < 35);
  while (state.freeAgents.length < 30) {
    const p = makePlayer(state, rng, { pos: rng.pick(['GK', 'DF', 'MF', 'FW']), mean: rng.range(46, 64) });
    p.contract = 0; state.players[p.id] = p; state.freeAgents.push(p.id);
  }
  state.season++; state.year++; state.md = 0;
  newSeasonFixtures(state, rng);
  setBoardTarget(state);
  for (const userId of managed(state)) mail(state, `New season: ${state.year}/${String(state.year + 1).slice(2)}`, `${state.clubs[userId].name} start the new season in the ${divisionOf(state, userId).name}. ${boardLine(state, userId)}`, 'board', {}, userId);
}

// ---------- commands ----------
export function dispatch(state, cmd) {
  const club = state.clubs[cmd.clubId || state.humans[0]];
  const today = mgrOf(state, club.id).today;
  const fail = msg => ({ ok: false, msg });
  switch (cmd.type) {
    case 'SET_FORMATION': {
      if (!FORMATIONS[cmd.formation]) return fail('Unknown formation');
      club.formation = cmd.formation;
      // keep players, re-fit by role
      const old = club.lineup.filter(Boolean);
      const slots = FORMATIONS[cmd.formation];
      const pool = old.map(id => state.players[id]);
      const lineup = new Array(slots.length).fill(null);
      const gkI = slots.findIndex(s => s[0] === 'GK');
      const gk = pool.find(p => p.pos === 'GK'); if (gk) { lineup[gkI] = gk.id; pool.splice(pool.indexOf(gk), 1); }
      slots.forEach((s, i) => { if (lineup[i]) return; let j = pool.findIndex(p => p.pos === s[0]); if (j < 0) j = pool.findIndex(p => p.pos !== 'GK'); if (j < 0) j = 0; if (pool[j]) { lineup[i] = pool[j].id; pool.splice(j, 1); } });
      club.lineup = lineup; repairLineup(state, club);
      club.cohesion = clamp((club.cohesion ?? 50) - 4, 0, 100);
      return { ok: true };
    }
    case 'SET_MENTALITY': if (!MENTALITIES[cmd.mentality]) return fail('Unknown'); club.mentality = cmd.mentality; return { ok: true };
    case 'AUTO_LINEUP': autoLineup(state, club); return { ok: true };
    case 'SWAP': {
      // swap two squad members between lineup slots / bench / reserves
      const where = id => { const i = club.lineup.indexOf(id); if (i >= 0) return ['xi', i]; const b = club.bench.indexOf(id); if (b >= 0) return ['bench', b]; return ['res', -1]; };
      const [wa, ia] = where(cmd.a), [wb, ib] = where(cmd.b);
      const pa = state.players[cmd.a], pb = state.players[cmd.b];
      if ((wa !== 'res' && !available(pb)) || (wb !== 'res' && !available(pa))) return fail('That player is unavailable.');
      const set = (w, i, id) => { if (w === 'xi') club.lineup[i] = id; else if (w === 'bench') club.bench[i] = id; };
      set(wa, ia, cmd.b); set(wb, ib, cmd.a);
      return { ok: true };
    }
    case 'TRAIN': {
      if (today.trained) return fail('The squad has already trained today. Come back tomorrow.');
      const rng = rngFor(state, 'train');
      const individual = (cmd.individual || []).slice(0, 3);
      const report = runTraining(state, club, cmd.focus, individual, rng, false);
      today.trained = true; today.trainingReport = { focus: cmd.focus, report };
      completeObjective(state, 'train', club.id);
      return { ok: true, report };
    }
    case 'BID': {
      const p = state.players[cmd.playerId];
      if (!p || p.clubId === club.id) return fail('Invalid player');
      if (!p.clubId) return signFree(state, club, p);
      if (state.bids.filter(b => b.clubId === club.id).length >= 3) return fail('You can have at most 3 open bids a day.');
      if (cmd.fee + committedBids(state, club.id) > club.cash) return fail('You cannot afford that bid with your other open bids.');
      if (club.playerIds.length >= LEAGUE.squadMax) return fail(`Your squad is full (${LEAGUE.squadMax}). Sell or release someone first.`);
      state.bids = state.bids.filter(b => !(b.clubId === club.id && b.playerId === p.id));
      state.bids.push({ clubId: club.id, playerId: p.id, fee: roundMoney(cmd.fee), day: state.calendar.day });
      completeObjective(state, 'bid', club.id);
      return { ok: true, msg: `Bid submitted. ${state.clubs[p.clubId].name} will answer overnight.` };
    }
    case 'CANCEL_BID': state.bids = state.bids.filter(b => !(b.clubId === club.id && b.playerId === cmd.playerId)); return { ok: true };
    case 'ACCEPT_OFFER': {
      const o = state.offers.find(x => x.id === cmd.offerId && x.status === 'open'); if (!o) return fail('Offer is gone');
      const p = state.players[o.playerId];
      if (club.playerIds.length <= LEAGUE.squadMin) return fail(`You need at least ${LEAGUE.squadMin} players.`);
      const buyer = state.clubs[o.from];
      o.status = 'done';
      moveP(state, p, buyer, o.fee);
      news(state, `${buyer.name} sign ${fullName(p)} from ${club.name} for ${money(o.fee)}.`);
      return { ok: true, msg: `${fullName(p)} sold to ${buyer.name} for ${money(o.fee)}.` };
    }
    case 'REJECT_OFFER': { const o = state.offers.find(x => x.id === cmd.offerId); if (o) o.status = 'rejected'; state.offers = state.offers.filter(x => x.status === 'open'); return { ok: true }; }
    case 'LIST': { const p = state.players[cmd.playerId]; if (p?.clubId !== club.id) return fail('Not your player'); p.listed = !p.listed; return { ok: true }; }
    case 'RELEASE': {
      const p = state.players[cmd.playerId]; if (p?.clubId !== club.id) return fail('Not your player');
      if (club.playerIds.length <= LEAGUE.squadMin) return fail(`You need at least ${LEAGUE.squadMin} players.`);
      const comp = release(state, club, p); repairLineup(state, club);
      return { ok: true, msg: `${fullName(p)} released. Compensation paid: ${money(comp)}.` };
    }
    case 'RENEW': {
      const p = state.players[cmd.playerId]; if (p?.clubId !== club.id) return fail('Not your player');
      const w = roundMoney(wageDemand(p) * (p.morale < 40 ? 1.3 : 1.08), 100);
      if (p.morale < 25) return fail(`${fullName(p)} is unhappy and won't talk about a new contract.`);
      p.wage = w; p.contract = cmd.years || 3; p.morale = clamp(p.morale + 8, 0, 100);
      return { ok: true, msg: `${fullName(p)} signs a ${p.contract}-year deal on ${money(w)} a week.` };
    }
    case 'SCOUT': {
      const p = state.players[cmd.playerId]; if (!p || (state.mgrs ? mgrOf(state, club.id).scouted?.[p.id] : p.scouted)) return fail('Already scouted');
      const max = 2;
      if (today.scoutsUsed >= max) return fail(`Your scouts are all busy today (${max} a day).`);
      if (state.scouting.some(s => s.playerId === p.id && (!state.mgrs || s.clubId === club.id))) return fail('A scout is already on it.');
      state.scouting.push(state.mgrs ? { playerId: p.id, readyDay: state.calendar.day + 1, clubId: club.id } : { playerId: p.id, readyDay: state.calendar.day + 1 });
      today.scoutsUsed++;
      completeObjective(state, 'scout', club.id);
      return { ok: true, msg: `Scout sent to watch ${fullName(p)}. The report arrives tomorrow.` };
    }
    case 'TICKET_PRICE': club.stadium.ticketPrice = clamp(Math.round(cmd.price), 3, 150); return { ok: true };
    case 'BUILD': {
      const opts = buildOptions(state, club);
      const o = opts.find(x => x.key === cmd.key); if (!o) return fail('Unknown project');
      if (o.busy) return fail('That project is already under way.');
      if (o.maxed) return fail('Already at the maximum level.');
      if (club.cash < o.cost) return fail('Not enough money.');
      ledger(club, 'building', -o.cost, state, o.label);
      state.builds.push({ clubId: club.id, kind: o.kind, amount: o.amount || 0, readyDay: state.calendar.day + o.days });
      return { ok: true, msg: `${o.label} started. Ready in ${o.days} day${o.days > 1 ? 's' : ''}.` };
    }
    case 'WATCHED': today.watched = true; completeObjective(state, 'watch', club.id); return { ok: true };
    // Multiplayer only (single player edits the lineup and inbox directly in the browser).
    case 'SET_SLOT': {
      const i = cmd.i, p = state.players[cmd.playerId];
      if (!Number.isInteger(i) || i < 0 || i >= club.lineup.length) return fail('Unknown position');
      if (p?.clubId !== club.id) return fail('Not your player');
      if (!available(p)) return fail('That player is unavailable.');
      if (club.lineup.includes(p.id)) return fail('He is already in the team.');
      club.lineup[i] = p.id; club.bench = club.bench.filter(x => x !== p.id);
      return { ok: true };
    }
    case 'READ_MAIL': {
      const ids = Array.isArray(cmd.ids) ? new Set(cmd.ids) : null;
      for (const m of mgrOf(state, club.id).inbox) if (!ids || ids.has(m.id)) m.read = true;
      return { ok: true };
    }
    case 'RENAME_CLUB': {
      const c = state.clubs[cmd.targetId]; if (!c) return fail('No club');
      if (cmd.name !== undefined) c.name = String(cmd.name).slice(0, 40) || c.name;
      if (cmd.short !== undefined) c.short = String(cmd.short).toUpperCase().slice(0, 4) || c.short;
      if (cmd.stadium !== undefined) c.stadium.name = String(cmd.stadium).slice(0, 40) || c.stadium.name;
      if (cmd.primary) c.colors.primary = cmd.primary;
      if (cmd.secondary) c.colors.secondary = cmd.secondary;
      if (cmd.pattern) c.colors.pattern = cmd.pattern;
      if (cmd.shape) c.crest.shape = cmd.shape;
      return { ok: true };
    }
    case 'RENAME_PLAYER': {
      const p = state.players[cmd.playerId]; if (!p) return fail('No player');
      if (cmd.first !== undefined) p.first = String(cmd.first).slice(0, 24);
      if (cmd.last !== undefined) p.last = String(cmd.last).slice(0, 30) || p.last;
      return { ok: true };
    }
    case 'RENAME_DIVISION': { const d = state.divisions.find(x => x.id === cmd.divId); if (d) d.name = String(cmd.name).slice(0, 40) || d.name; return { ok: true }; }
    default: return fail('Unknown command ' + cmd.type);
  }
}

function signFree(state, club, p) {
  if (p.youthOf && p.youthOf !== club.id) return { ok: false, msg: 'Not available' };
  if (club.playerIds.length >= LEAGUE.squadMax) return { ok: false, msg: `Your squad is full (${LEAGUE.squadMax}).` };
  const bonus = p.youthOf ? 0 : roundMoney(wageDemand(p) * 4);
  if (club.cash < bonus) return { ok: false, msg: 'Not enough money for the signing bonus.' };
  if (bonus) ledger(club, 'transfersOut', -bonus, state, `Signing bonus: ${fullName(p)}`);
  const wasYouth = !!p.youthOf;
  moveP(state, p, club, 0);
  if (wasYouth) { p.wage = roundMoney(800 + club.facilities.youth * 300, 100); delete p.youthOf; }
  completeObjective(state, 'bid', club.id);
  return { ok: true, msg: `${fullName(p)} signs on ${money(p.wage)} a week${bonus ? ` with a ${money(bonus)} signing bonus` : ''}.` };
}

export function buildOptions(state, club) {
  const busy = k => state.builds.some(b => b.clubId === club.id && b.kind === k);
  const t = club.facilities.training, y = club.facilities.youth;
  return [
    { key: 'stand-s', kind: 'stadium', label: 'Add 2,000 seats', amount: 2000, cost: 1800000, days: 3, busy: busy('stadium'), maxed: club.stadium.capacity >= 80000 },
    { key: 'stand-l', kind: 'stadium', label: 'Build a new stand (+6,000)', amount: 6000, cost: 5200000, days: 6, busy: busy('stadium'), maxed: club.stadium.capacity >= 76000 },
    { key: 'train', kind: 'training', label: `Training ground to level ${t + 1}`, cost: 1200000 * t, days: 2 + t, busy: busy('training'), maxed: t >= 5 },
    { key: 'youth', kind: 'youth', label: `Youth academy to level ${y + 1}`, cost: 900000 * y, days: 2 + y, busy: busy('youth'), maxed: y >= 5 },
  ];
}

export { computeTable, divisionOf, fixtureFor, seasonLength, expectedAttendance, sponsorWeekly, fullName, shortName, playerValue, wageDemand, effSkill, available, repairLineup };
