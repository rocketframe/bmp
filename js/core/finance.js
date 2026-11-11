import { clamp } from './rng.js';
import { blankLedger, leagueConf } from './world.js';

export function ledger(club, cat, amount, state, note) {
  club.cash += amount;
  club.fin.season[cat] = (club.fin.season[cat] || 0) + amount;
  if (state && note && club.human) {
    (club.fin.log ||= []).unshift({ day: state.calendar.day, cat, amount, note });
    club.fin.log.length = Math.min(club.fin.log.length, 60);
  }
}
export const divConf = (state, club) => leagueConf(state).divisions.find(d => d.id === club.divisionId);

export function sponsorWeekly(club) { return Math.round(0.42 * Math.pow(club.rep, 3) / 1000) * 1000; }
export function weeklyWages(state, club) { return club.playerIds.reduce((s, id) => s + (state.players[id]?.wage || 0), 0); }

export function expectedAttendance(state, club, opp, tablePos = 6, rng = null) {
  const cap = club.stadium.capacity;
  const refPrice = (12 + club.rep / 3.2) * (divConf(state, club)?.priceF ?? 1); // fans in the lower divisions expect cheaper tickets
  const priceF = clamp(Math.pow(refPrice / Math.max(3, club.stadium.ticketPrice), 1.25), 0.25, 1.4);
  const base = 0.42 + club.rep / 230 + (opp ? (opp.rep - 60) / 400 : 0) + (7 - tablePos) * 0.012 + (club.hype || 0) / 200;
  const noise = rng ? rng.range(0.95, 1.05) : 1;
  return Math.round(clamp(cap * base * priceF * noise, cap * 0.08, cap));
}

// Runs once per matchday (= one in-game week): wages, sponsor, TV, and gate money for the home side.
export function settleMatchdayFinances(state, fixtureList, tablePosOf, rng) {
  const att = {};
  for (const f of fixtureList) {
    const home = state.clubs[f.h], away = state.clubs[f.a];
    const crowd = expectedAttendance(state, home, away, tablePosOf(home.id), rng);
    att[f.h] = crowd;
    f.r.att = crowd;
    ledger(home, 'tickets', crowd * home.stadium.ticketPrice, state, `Gate receipts v ${away.short} (${crowd.toLocaleString()} fans)`);
    ledger(home, 'merch', Math.round(crowd * (3 + home.rep / 25)), state, null);
  }
  for (const club of Object.values(state.clubs)) {
    const d = divConf(state, club);
    ledger(club, 'tv', d.tv, state, null);
    ledger(club, 'sponsor', sponsorWeekly(club), state, null);
    ledger(club, 'wages', -weeklyWages(state, club), state, 'Weekly wages');
    club.fin.history.push(club.cash);
    if (club.fin.history.length > 60) club.fin.history.shift();
  }
  return att;
}

export function seasonPrize(state, divId, pos) {
  const LG = leagueConf(state);
  const d = LG.divisions.find(x => x.id === divId);
  const n = LG.clubsPerDivision;
  return Math.round(d.prizeTop * Math.pow((n - pos + 1) / n, 1.6) / 10000) * 10000;
}

export function resetSeasonLedger(club) { club.fin.lastSeason = club.fin.season; club.fin.season = blankLedger(); }
