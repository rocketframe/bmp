import { makeRng, clamp } from './rng.js';
import { TOWNS, SUFFIXES, STADIUM_WORDS, KIT_COLORS, PATTERNS, CREST_SHAPES } from './names.js';
import { LEAGUE, FORMATION_KEYS } from './constants.js';
import { makePlayer, newId, autoLineup, assignNumbers, roundMoney } from './players.js';

export const SAVE_VERSION = 1;

export function makeFixtures(clubIds, rng) {
  // circle method double round robin
  const ids = rng.shuffle(clubIds.slice());
  if (ids.length % 2) ids.push(null);
  const n = ids.length, rounds = [];
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a && b) round.push(r % 2 === 0 ? { h: a, a: b, r: null } : { h: b, a: a, r: null });
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop());
  }
  const second = rounds.map(rd => rd.map(f => ({ h: f.a, a: f.h, r: null })));
  return rounds.concat(second);
}

export function makeClub(state, rng, { name, short, rep, divisionId, colors, pattern }) {
  const id = newId(state, 'c');
  const town = name.split(' ')[0];
  const capacity = roundMoney(divisionId === 'd1' ? 14000 + (rep - 60) * 1900 + rng.int(0, 6000) : 5000 + (rep - 46) * 700 + rng.int(0, 3000), 500);
  return {
    id, name, short, rep, divisionId,
    colors: { primary: colors[0], secondary: colors[1], pattern },
    crest: { shape: rng.pick(CREST_SHAPES), motif: rng.int(0, 5) },
    cash: roundMoney(divisionId === 'd1' ? 2e6 + (rep - 60) * 9e5 + rng.int(0, 3e6) : 6e5 + (rep - 46) * 1.5e5 + rng.int(0, 8e5)),
    stadium: { name: `${town} ${rng.pick(STADIUM_WORDS)}`, capacity: clamp(capacity, 4000, 80000), ticketPrice: Math.round(12 + rep / 3.2) },
    facilities: { training: divisionId === 'd1' ? 2 : 1, youth: 1 },
    formation: rng.pick(FORMATION_KEYS), mentality: 'balanced',
    lineup: [], bench: [], playerIds: [], human: false, managerName: null,
    cohesion: 50,
    fin: { history: [], season: blankLedger() },
  };
}
export function blankLedger() {
  return { tickets: 0, merch: 0, sponsor: 0, tv: 0, prize: 0, transfersIn: 0, bonus: 0, wages: 0, transfersOut: 0, building: 0, other: 0 };
}

export function createWorld(seed, { managerName = 'You' } = {}) {
  const rng = makeRng(seed);
  const state = {
    version: SAVE_VERSION, seed, rngState: 0, nextId: 1,
    season: 1, year: 2026, md: 0, // md = index of today's matchday
    clubs: {}, players: {}, freeAgents: [],
    divisions: LEAGUE.divisions.map(d => ({ id: d.id, name: d.name, clubIds: [] })),
    fixtures: {}, humans: [], managerName,
    inbox: [], offers: [], bids: [], scouting: [], builds: [],
    history: [], news: [],
    calendar: { day: 0, date: null, streak: 0, bestStreak: 0, lastLogin: null },
    today: null, phase: 'season',
  };
  const towns = rng.shuffle(TOWNS.slice());
  const kits = rng.shuffle(KIT_COLORS.slice());
  let ti = 0;
  const usedShort = new Set();
  for (const div of state.divisions) {
    const conf = LEAGUE.divisions.find(d => d.id === div.id);
    for (let i = 0; i < LEAGUE.clubsPerDivision; i++) {
      const town = towns[ti % towns.length];
      const suffix = rng.pick(SUFFIXES);
      const name = /^(Real|Sporting|Olympia|Union|Victoria|Borussia 07)$/.test(suffix) && rng.chance(0.5) ? `${suffix.replace(' 07', '')} ${town}` : `${town} ${suffix}`;
      let short = town.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
      while (usedShort.has(short)) short = (town[0] + town.replace(/[^A-Za-z]/g, '').slice(-2)).toUpperCase() + (usedShort.size % 10);
      usedShort.add(short);
      const [lo, hi] = conf.repRange;
      const rep = Math.round(hi - (hi - lo) * (i / (LEAGUE.clubsPerDivision - 1)) + rng.normal(0, 1.5));
      const club = makeClub(state, rng, { name, short, rep, divisionId: div.id, colors: kits[ti % kits.length], pattern: rng.pick(PATTERNS) });
      ti++;
      state.clubs[club.id] = club;
      div.clubIds.push(club.id);
      fillSquad(state, rng, club);
    }
  }
  // free agents
  for (let i = 0; i < 40; i++) {
    const p = makePlayer(state, rng, { pos: rng.pick(['GK', 'DF', 'DF', 'MF', 'MF', 'FW']), mean: rng.range(46, 66) });
    p.contract = 0; state.players[p.id] = p; state.freeAgents.push(p.id);
  }
  newSeasonFixtures(state, rng);
  state.rngState = rng.state;
  return state;
}

export function fillSquad(state, rng, club) {
  const want = { GK: 3, DF: 8, MF: 8, FW: 5 };
  for (const pos in want) for (let k = 0; k < want[pos]; k++) {
    const p = makePlayer(state, rng, { pos, mean: club.rep - 2 + (k < 2 ? 4 : 0), clubId: club.id });
    state.players[p.id] = p; club.playerIds.push(p.id);
  }
  assignNumbers(state, club);
  autoLineup(state, club);
}

export function newSeasonFixtures(state, rng) {
  for (const div of state.divisions) state.fixtures[div.id] = makeFixtures(div.clubIds, rng);
}

export function seasonLength(state) { return state.fixtures[state.divisions[0].id].length; }

export function computeTable(state, divId, uptoMd = Infinity) {
  const div = state.divisions.find(d => d.id === divId);
  const rows = {};
  for (const id of div.clubIds) rows[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
  state.fixtures[divId].forEach((round, md) => {
    if (md >= uptoMd) return;
    for (const f of round) {
      if (!f.r) continue;
      const [hs, as] = f.r.s, H = rows[f.h], A = rows[f.a];
      if (!H || !A) continue;
      H.p++; A.p++; H.gf += hs; H.ga += as; A.gf += as; A.ga += hs;
      if (hs > as) { H.w++; A.l++; H.pts += 3; H.form.push('W'); A.form.push('L'); }
      else if (hs < as) { A.w++; H.l++; A.pts += 3; H.form.push('L'); A.form.push('W'); }
      else { H.d++; A.d++; H.pts++; A.pts++; H.form.push('D'); A.form.push('D'); }
    }
  });
  const list = Object.values(rows);
  list.sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || state.clubs[a.id].name.localeCompare(state.clubs[b.id].name));
  list.forEach((r, i) => { r.pos = i + 1; r.form = r.form.slice(-5); });
  return list;
}

export function divisionOf(state, clubId) { return state.divisions.find(d => d.clubIds.includes(clubId)); }

export function fixtureFor(state, clubId, md = state.md) {
  const div = divisionOf(state, clubId);
  const round = state.fixtures[div.id][md];
  if (!round) return null;
  const f = round.find(x => x.h === clubId || x.a === clubId);
  return f ? { ...f, divId: div.id, md, ref: f } : null;
}
