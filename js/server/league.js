// Matchday Legends league server module. The game hub (rocketframe/game-hub) copies js/core and
// js/server into its Worker and runs a shared league with it, so every rule is the same code the
// single-player game uses. Nothing in the browser game imports this file.
//
// League state is the normal world plus:
//   state.mgrs[clubId]  per-manager slot: { managerId, managerName, today, inbox, history, scouted, points, calendar, yesterday }
//   state.mp            { managers: { managerId: clubId }, away: { managerId: { clubId, slot } }, startSeason, lastMatches }
// All functions take and return plain JSON, so the hub can store the state as it is.
import { createWorld, computeTable, divisionOf } from '../core/world.js';
import { autoLineup } from '../core/players.js';
import { makeRng, hashSeed } from '../core/rng.js';
import * as G from '../core/game.js';

export const READY = true;

const fail = msg => ({ ok: false, msg });

// ---------- setup ----------
export function createLeague(seed, managers) {
  const state = createWorld((Number(seed) >>> 0) || 1, { managerName: 'Manager' });
  state.mgrs = {};
  state.mp = { managers: {}, away: {}, startSeason: state.season, lastMatches: {} };
  state.calendar.day = 1;
  // Everyone starts in the top division on clubs of similar strength: the middle of the table first.
  const div = state.divisions[0];
  const byRep = div.clubIds.slice().sort((a, b) => state.clubs[b].rep - state.clubs[a].rep);
  const mid = (byRep.length - 1) / 2;
  const order = byRep.map((id, i) => [id, Math.abs(i - mid)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  const rng = makeRng(hashSeed(state.seed, 'clubs'));
  const picks = rng.shuffle(order.slice(0, Math.min(managers.length, order.length)));
  managers.slice(0, picks.length).forEach((m, i) => takeClub(state, picks[i], m.id, m.name));
  return state;
}

function newSlot(id, name) {
  return { managerId: id, managerName: String(name || 'Manager').slice(0, 24), today: null, inbox: [], history: [], scouted: {}, points: 0,
    calendar: { streak: 0, bestStreak: 0 }, active: false, yesterday: null };
}

function takeClub(state, clubId, id, name, slot = null) {
  const c = state.clubs[clubId];
  const m = slot || newSlot(id, name);
  if (name) m.managerName = String(name).slice(0, 24);
  c.human = true; c.managerName = m.managerName;
  state.humans.push(clubId);
  state.mgrs[clubId] = m;
  state.mp.managers[id] = clubId;
  autoLineup(state, c);
  if (!slot || !c.board) G.setBoardTargetFor(state, clubId);
  if (!m.today || m.today.md !== state.md) G.startDayFor(state, clubId);
  if (!slot) {
    G.mail(state, `Welcome to ${c.name}`, `The board has handed you the keys to ${c.stadium.name}. ${G.boardLine(state, clubId)}\n\nThis is a shared league: every club run by a person is a real rival. Train, set your team and trade, then press Ready. The matchday is played when every manager is ready, or at the deadline. Bids are answered overnight.`, 'board', {}, clubId);
  }
  return clubId;
}

// Take over a club mid-league (or get your old one back).
export function joinClub(state, id, name) {
  if (state.mp.managers[id]) return { ok: true, clubId: state.mp.managers[id] };
  const away = state.mp.away[id];
  if (away && state.clubs[away.clubId] && !state.clubs[away.clubId].human) {
    delete state.mp.away[id];
    return { ok: true, clubId: takeClub(state, away.clubId, id, name, away.slot) };
  }
  // An AI club in the division with the most managers, as close as possible to their average strength.
  const humanDivs = state.humans.map(h => divisionOf(state, h).id);
  const divId = state.divisions.map(d => d.id).sort((a, b) => humanDivs.filter(x => x === b).length - humanDivs.filter(x => x === a).length)[0];
  const reps = state.humans.map(h => state.clubs[h].rep);
  const avg = reps.length ? reps.reduce((a, b) => a + b, 0) / reps.length : null;
  const pickFrom = ids => {
    const ai = ids.filter(cid => !state.clubs[cid].human);
    if (!ai.length) return null;
    const ref = avg ?? ai.map(cid => state.clubs[cid].rep).sort((a, b) => a - b)[Math.floor(ai.length / 2)];
    return ai.sort((a, b) => Math.abs(state.clubs[a].rep - ref) - Math.abs(state.clubs[b].rep - ref))[0];
  };
  const clubId = pickFrom(state.divisions.find(d => d.id === divId).clubIds) || pickFrom(Object.keys(state.clubs));
  if (!clubId) return fail('Every club already has a manager.');
  if (away) delete state.mp.away[id];
  return { ok: true, clubId: takeClub(state, clubId, id, name) };
}

// Give the club back to the computer. The manager's inbox and history are kept in case they come back.
export function leaveClub(state, id) {
  const clubId = state.mp.managers[id];
  if (!clubId) return fail('Not in this league');
  const c = state.clubs[clubId];
  c.human = false; c.managerName = null;
  state.humans = state.humans.filter(x => x !== clubId);
  state.bids = state.bids.filter(b => b.clubId !== clubId);
  state.scouting = state.scouting.filter(s => s.clubId !== clubId);
  state.offers = state.offers.filter(o => state.players[o.playerId]?.clubId !== clubId);
  for (const pid of c.playerIds) state.players[pid].listed = false;
  autoLineup(state, c);
  state.mp.away[id] = { clubId, slot: state.mgrs[clubId] };
  delete state.mgrs[clubId];
  delete state.mp.managers[id];
  return { ok: true };
}

// ---------- commands ----------
const ALLOWED = new Set(['SET_FORMATION', 'SET_MENTALITY', 'AUTO_LINEUP', 'SWAP', 'SET_SLOT', 'TRAIN', 'BID', 'CANCEL_BID',
  'ACCEPT_OFFER', 'REJECT_OFFER', 'LIST', 'RELEASE', 'RENEW', 'SCOUT', 'TICKET_PRICE', 'BUILD', 'READ_MAIL']);
// Not allowed: WATCHED (matches are played by the server) and RENAME_* (they would change other clubs
// for everyone; name packs are a local overlay in each browser anyway).

export function apply(state, managerId, cmd) {
  const clubId = state.mp.managers[managerId];
  if (!clubId) return fail('You are not managing a club in this league.');
  if (!cmd || typeof cmd !== 'object' || !ALLOWED.has(cmd.type)) return fail('That action is not available in a shared league.');
  let c;
  try { c = JSON.parse(JSON.stringify(cmd)); } catch (e) { return fail('Bad command'); }
  c.clubId = clubId; // always the sender's own club, whatever the browser sent
  const P = id => (typeof id === 'string' ? state.players[id] : undefined);
  const mine = id => P(id)?.clubId === clubId;
  switch (c.type) {
    case 'SWAP': if (!mine(c.a) || !mine(c.b)) return fail('Not your player'); break;
    case 'SET_SLOT': if (!mine(c.playerId)) return fail('Not your player'); break;
    case 'TRAIN':
      c.focus = String(c.focus || 'balanced');
      c.individual = (Array.isArray(c.individual) ? c.individual : []).filter(mine).slice(0, 3);
      break;
    case 'BID': {
      const p = P(c.playerId);
      if (!p) return fail('Invalid player');
      if (p.clubId && state.clubs[p.clubId]?.human && p.clubId !== clubId) return fail('Clubs run by other managers are not selling.');
      c.fee = Number(c.fee);
      if (!Number.isFinite(c.fee) || c.fee < 0 || c.fee > 1e9) return fail('Enter a valid fee.');
      break;
    }
    case 'CANCEL_BID': case 'LIST': case 'RELEASE': case 'SCOUT': if (!P(c.playerId)) return fail('Invalid player'); break;
    case 'RENEW': if (!mine(c.playerId)) return fail('Not your player'); c.years = Math.max(1, Math.min(5, Math.round(Number(c.years) || 3))); break;
    case 'ACCEPT_OFFER': case 'REJECT_OFFER': {
      const o = state.offers.find(x => x.id === c.offerId);
      if (!o || state.players[o.playerId]?.clubId !== clubId) return fail('Offer is gone');
      break;
    }
    case 'TICKET_PRICE': c.price = Number(c.price); if (!Number.isFinite(c.price)) return fail('Enter a price.'); break;
    case 'SET_FORMATION': c.formation = String(c.formation); break;
    case 'SET_MENTALITY': c.mentality = String(c.mentality); break;
    case 'BUILD': c.key = String(c.key); break;
    case 'READ_MAIL': if (c.ids !== undefined && !Array.isArray(c.ids)) return fail('Bad command'); break;
  }
  let res;
  try { res = G.dispatch(state, c); } catch (e) { return fail('That did not work.'); }
  if (res?.ok && c.type !== 'READ_MAIL') state.mgrs[clubId].active = true;
  return res;
}

// ---------- what one manager sees ----------
// The shared world in the shape the single-player UI already understands, with only this manager's private
// parts: their inbox, objectives, bids, offers and scouting. Hidden: other managers' bids and inboxes,
// the potential of players this manager has not scouted, and the random seed (it would predict matches).
export function viewFor(state, managerId) {
  const clubId = state.mp.managers[managerId];
  if (!clubId) return null;
  const m = state.mgrs[clubId];
  const players = {};
  for (const [id, p] of Object.entries(state.players)) {
    const known = p.clubId === clubId || p.youthOf === clubId || !!m.scouted?.[id];
    players[id] = known ? { ...p, scouted: true } : { ...p, scouted: false, potential: null };
  }
  const { seed, rngState, mgrs, mp, pending, mailSeq, ...world } = state;
  return {
    ...world,
    players,
    humans: [clubId, ...state.humans.filter(x => x !== clubId)],
    managerName: m.managerName,
    today: m.today,
    inbox: m.inbox,
    history: m.history,
    calendar: { ...state.calendar, streak: m.calendar.streak, bestStreak: m.calendar.bestStreak, lastLogin: null },
    bids: state.bids.filter(b => b.clubId === clubId),
    offers: state.offers.filter(o => state.players[o.playerId]?.clubId === clubId),
    scouting: state.scouting.filter(s => s.clubId === clubId),
    mp: {
      you: clubId,
      managers: Object.values(state.mgrs).map(x => ({ id: x.managerId, name: x.managerName, clubId: state.mp.managers[x.managerId] })),
      yesterday: m.yesterday,
      lastMatch: state.mp.lastMatches?.[clubId] || null,
      seasonsPlayed: seasonsPlayed(state),
      points: m.points || 0,
    },
  };
}

// ---------- the matchday ----------
export function advanceDay(state) {
  for (const m of Object.values(state.mgrs)) {
    // the streak counts matchdays in a row on which the manager did something
    m.calendar.streak = m.active ? m.calendar.streak + 1 : 0;
    m.calendar.bestStreak = Math.max(m.calendar.bestStreak, m.calendar.streak);
    m.active = false;
  }
  const r = G.playDayAll(state);
  state.mp.lastMatches = {};
  const results = [];
  for (const [cid, u] of Object.entries(r.matches)) {
    state.mp.lastMatches[cid] = { md: r.md, season: r.season, div: u.div, idx: u.idx, home: u.home, away: u.away, userSide: u.userSide, result: u.result };
    if (!results.some(x => x.h === u.home && x.a === u.away)) results.push({ h: u.home, a: u.away, s: u.result.score.slice() });
  }
  return { day: state.calendar.day, md: r.md, season: r.season, results, newSeason: state.season !== r.season };
}

// ---------- bookkeeping ----------
export function managerIds(state) { return Object.values(state.mgrs).map(m => m.managerId); }
export function seasonsPlayed(state) { return state.season - (state.mp?.startSeason ?? 1); }

// Human managers ranked by division, then league position (this season's table, or the last finished
// season right after a season ends). points = league points over all seasons played.
export function standings(state) {
  const tables = {};
  const table = divId => (tables[divId] ||= computeTable(state, divId));
  const rows = Object.entries(state.mgrs).map(([cid, m]) => {
    const div = divisionOf(state, cid);
    const row = table(div.id).find(r => r.id === cid);
    const last = m.history[m.history.length - 1];
    const useLast = state.md === 0 && last;
    const divIdx = state.divisions.findIndex(d => d.id === (useLast ? last.div : div.id));
    return { id: m.managerId, divIdx, pos: useLast ? last.pos : row.pos, points: (m.points || 0) + row.pts };
  });
  rows.sort((a, b) => a.divIdx - b.divIdx || a.pos - b.pos);
  return rows.map((r, i) => ({ id: r.id, place: i + 1, points: r.points }));
}
