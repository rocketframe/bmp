// Tests for the shared-league module the game hub runs. Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/server/league.js';

const M = [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Ben' }, { id: 'u3', name: 'Cy' }];
const roundtrip = s => JSON.parse(JSON.stringify(s)); // the hub stores the state as JSON between calls

test('createLeague gives each manager a club in the top division by default', () => {
  const s = L.createLeague(42, M);
  assert.equal(L.READY, true);
  assert.deepEqual(L.managerIds(s).sort(), ['u1', 'u2', 'u3']);
  const clubs = Object.values(s.mp.managers);
  assert.equal(new Set(clubs).size, 3);
  for (const c of clubs) { assert.ok(s.clubs[c].human); assert.equal(s.clubs[c].divisionId, 'd1'); }
  assert.deepEqual(roundtrip(L.createLeague(42, M)), roundtrip(s), 'same seed, same league');
});

test('apply only touches the sender\'s own club', () => {
  const s = L.createLeague(7, M);
  const c1 = s.mp.managers.u1, c2 = s.mp.managers.u2;
  const theirs = s.clubs[c2].playerIds[0], mine = s.clubs[c1].playerIds[0];
  assert.equal(L.apply(s, 'u1', { type: 'LIST', playerId: theirs }).ok, false);
  assert.equal(L.apply(s, 'u1', { type: 'RELEASE', playerId: theirs, clubId: c2 }).ok, false, 'clubId from the browser is ignored');
  assert.equal(L.apply(s, 'u1', { type: 'SWAP', a: mine, b: theirs }).ok, false);
  assert.equal(L.apply(s, 'u1', { type: 'BID', playerId: theirs, fee: 1e6 }).ok, false, 'no bids for other managers\' players');
  assert.equal(L.apply(s, 'u1', { type: 'RENAME_CLUB', targetId: c2, name: 'X' }).ok, false);
  assert.equal(L.apply(s, 'u1', { type: 'WATCHED' }).ok, false);
  assert.equal(L.apply(s, 'nobody', { type: 'AUTO_LINEUP' }).ok, false);
  assert.equal(L.apply(s, 'u1', { type: 'TICKET_PRICE', price: 'abc' }).ok, false);
  assert.equal(L.apply(s, 'u1', { type: 'TRAIN', focus: 'balanced', individual: [theirs] }).ok, true);
  assert.equal(L.apply(s, 'u1', { type: 'TRAIN', focus: 'balanced' }).ok, false, 'once a day');
  assert.equal(L.apply(s, 'u2', { type: 'TRAIN', focus: 'balanced' }).ok, true, 'each manager trains on their own');
  assert.equal(s.mgrs[c1].today.trained, true);
  assert.equal(s.mgrs[s.mp.managers.u3].today.trained, false);
});

test('viewFor shows the world plus only that manager\'s private parts', () => {
  const s = L.createLeague(9, M);
  const c1 = s.mp.managers.u1, c2 = s.mp.managers.u2;
  const target = Object.values(s.players).find(p => p.clubId && !s.clubs[p.clubId].human);
  assert.equal(L.apply(s, 'u2', { type: 'BID', playerId: target.id, fee: 1e5 }).ok, true);
  assert.equal(L.apply(s, 'u2', { type: 'SCOUT', playerId: target.id }).ok, true);
  const v1 = L.viewFor(s, 'u1'), v2 = L.viewFor(s, 'u2');
  assert.equal(v1.humans[0], c1); assert.equal(v2.humans[0], c2);
  assert.equal(v1.bids.length, 0); assert.equal(v2.bids.length, 1);
  assert.equal(v1.scouting.length, 0);
  assert.equal(v1.seed, undefined); assert.equal(v1.rngState, undefined); assert.equal(v1.mgrs, undefined);
  assert.equal(v1.players[target.id].potential, null);
  assert.ok(v1.players[s.clubs[c1].playerIds[0]].potential > 0, 'own players are fully known');
  assert.notEqual(v1.inbox, v2.inbox);
  assert.equal(v1.mp.managers.length, 3);
  assert.ok(s.players[target.id].potential > 0, 'viewFor does not change the state');
});

test('a whole league: matchdays, seasons, joining and leaving', () => {
  let s = L.createLeague(1234, M.slice(0, 2), { clubsPerDivision: 16 });
  const days = 2 * s.fixtures.d1.length + 3;
  let seasons = 0;
  for (let d = 0; d < days; d++) {
    for (const id of L.managerIds(s)) {
      const v = L.viewFor(s, id), cid = v.mp.you, club = v.clubs[cid];
      L.apply(s, id, { type: 'TRAIN', focus: 'attack', individual: club.playerIds.slice(0, 3) });
      for (const o of v.offers) L.apply(s, id, { type: d % 2 ? 'ACCEPT_OFFER' : 'REJECT_OFFER', offerId: o.id });
      const t = Object.values(v.players).find(p => p.clubId && !v.clubs[p.clubId].human && p.skill > 55);
      if (t) L.apply(s, id, { type: 'BID', playerId: t.id, fee: t.value * 1.3 });
      const fa = v.freeAgents.find(x => !v.players[x].scouted);
      if (fa) L.apply(s, id, { type: 'SCOUT', playerId: fa });
      L.apply(s, id, { type: 'READ_MAIL' });
    }
    if (d === 5) assert.equal(L.joinClub(s, 'u3', 'Cy').ok, true);
    if (d === 9) assert.equal(L.leaveClub(s, 'u2').ok, true);
    if (d === 15) { const back = L.joinClub(s, 'u2', 'Ben'); assert.equal(back.ok, true); }
    const dig = L.advanceDay(s);
    assert.ok(dig.results.length >= 1);
    if (dig.newSeason) seasons++;
    s = roundtrip(s);
    for (const id of L.managerIds(s)) {
      const v = L.viewFor(s, id);
      assert.ok(v.today && v.inbox, 'every manager has today and an inbox');
      assert.ok(v.mp.lastMatch?.result?.events?.length, 'every manager can replay their last match');
      assert.ok(JSON.stringify(v).length < 1.5e6);
    }
    assert.ok(JSON.stringify(s).length < 1.8e6, 'fits in one Durable Object value');
  }
  assert.equal(seasons, 2);
  assert.equal(L.seasonsPlayed(s), 2);
  const st = L.standings(s);
  assert.deepEqual(st.map(r => r.place), [1, 2, 3]);
  assert.deepEqual(st.map(r => r.id).sort(), ['u1', 'u2', 'u3']);
  for (const r of st) assert.ok(r.points >= 0);
  const u1 = s.mgrs[s.mp.managers.u1];
  assert.equal(u1.history.length, 2);
  assert.ok(u1.inbox.some(m => /review/.test(m.title)));
});

test('a manager who leaves and comes back gets their club and inbox back', () => {
  const s = L.createLeague(5, M);
  const c2 = s.mp.managers.u2;
  L.apply(s, 'u2', { type: 'TRAIN', focus: 'balanced' });
  L.leaveClub(s, 'u2');
  assert.equal(s.clubs[c2].human, false);
  assert.deepEqual(L.managerIds(s).sort(), ['u1', 'u3']);
  assert.equal(L.viewFor(s, 'u2'), null);
  const r = L.joinClub(s, 'u2', 'Ben');
  assert.equal(r.clubId, c2);
  assert.equal(s.mgrs[c2].today.trained, true, 'leaving and rejoining does not reset the day');
  assert.equal(L.joinClub(s, 'u2', 'Ben').clubId, c2, 'joining twice is harmless');
});

test('live matchday: kick-off, half-time changes from both managers, then full time', () => {
  let s = L.createLeague(77, M);
  let met = false;
  for (let d = 0; d < 12; d++) {
    const t0 = 1e12 + d * 1e7;
    const ko = L.startMatchday(s, t0);
    assert.equal(ko.kickoffAt, t0 + L.LIVE.kickoffDelay);
    assert.equal(L.apply(s, 'u1', { type: 'AUTO_LINEUP' }).ok, false, 'the office is closed during the match');
    s = roundtrip(s);
    const lives = M.map(m => L.liveFor(s, m.id));
    for (const lv of lives) {
      assert.equal(lv.phase, 'first');
      assert.ok(lv.match.result.events.every(e => e.half === 1), 'no second half before half time');
      assert.equal(lv.match.result.ht.rngState, undefined);
      assert.equal(L.viewFor(s, 'u1').mp.live.phase, 'first');
    }
    const h2h = lives.find(lv => lv.match.opponentManager);
    // every manager sends changes; the last one completes half time
    const ids = M.map(m => m.id);
    ids.forEach((id, i) => {
      const lv = lives[i], T = lv.match.result.ht.teams[lv.match.userSide];
      const sub = { outId: T.on[5].id, inId: T.bench[0]?.id };
      const r = L.halftime(s, id, { mentality: 'attacking', formation: '4-3-3', subs: [sub, { outId: 'nope', inId: 'x' }] });
      assert.equal(r.ok, true);
      assert.equal(r.allIn, i === ids.length - 1);
    });
    assert.equal(L.halftime(s, 'u1', {}).ok, false, 'only once');
    const sh = L.secondHalf(s, t0 + 60e3);
    assert.equal(sh.secondAt, t0 + 60e3 + L.LIVE.secondDelay);
    const after = L.liveFor(s, 'u1');
    assert.equal(after.phase, 'second');
    assert.ok(after.match.result.events.some(e => e.half === 2));
    assert.ok(after.match.changes[after.match.userSide].subs.length === 1, 'bad subs are dropped');
    if (h2h) {
      met = true;
      const a = L.liveFor(s, h2h.match.opponentManager === 'Ana' ? 'u1' : h2h.match.opponentManager === 'Ben' ? 'u2' : 'u3');
      assert.ok(a.match.changes[0] && a.match.changes[1], 'both managers\' changes are in the same match');
    }
    const dig = L.advanceDay(s);
    assert.equal(s.live, null);
    const v = L.viewFor(s, 'u1');
    assert.equal(v.mp.live, null);
    assert.deepEqual(v.mp.lastMatch.result.score, dig.results.find(x => x.h === v.mp.lastMatch.home && x.a === v.mp.lastMatch.away).s);
    assert.ok(v.mp.lastMatch.changes);
    s = roundtrip(s);
  }
  assert.ok(met, 'two managers met at least once');
});

test('half time closes for managers who are away', () => {
  const s = L.createLeague(3, M);
  L.startMatchday(s, 0);
  assert.equal(L.halftime(s, 'u1', null).allIn, false);
  L.secondHalf(s, 5e5);
  assert.equal(L.halftime(s, 'u2', { mentality: 'attacking' }).ok, false, 'too late');
  L.advanceDay(s);
  assert.equal(s.md, 1);
});

test('four divisions of 16 to 20 clubs, and each manager can choose where to start', () => {
  for (const [ask, want] of [[undefined, 18], [16, 16], [20, 20], [12, 16], [99, 20], ['x', 18]]) {
    const s = L.createLeague(11, M, ask === undefined ? undefined : { clubsPerDivision: ask });
    assert.equal(s.divisions.length, 4);
    for (const d of s.divisions) assert.equal(d.clubIds.length, want);
    assert.equal(s.fixtures.d1.length, 2 * (want - 1), 'double round robin');
    const names = Object.values(s.clubs).map(c => c.name);
    assert.equal(new Set(names).size, names.length, 'every club has its own name');
  }
  const s = L.createLeague(12, [{ id: 'u1', name: 'Ana', startDiv: 4 }, { id: 'u2', name: 'Ben', startDiv: 'd2' }, { id: 'u3', name: 'Cy' }, { id: 'u4', name: 'Di', startDiv: 9 }], { startDiv: 3 });
  const div = id => s.clubs[s.mp.managers[id]].divisionId;
  assert.deepEqual(['u1', 'u2', 'u3', 'u4'].map(div), ['d4', 'd2', 'd3', 'd3'], 'own choice, else the league default');
  assert.equal(L.OPTIONS.divisions.length, 4);
  assert.equal(L.OPTIONS.clubsPerDivision.default, 18);
  // joining later can pick a division too
  assert.equal(s.clubs[L.joinClub(s, 'u5', 'Ed', 1).clubId].divisionId, 'd1');
});

test('lower divisions are smaller in every way', () => {
  const s = L.createLeague(13, M);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const per = f => s.divisions.map(d => avg(d.clubIds.map(id => f(s.clubs[id]))));
  for (const f of [c => c.rep, c => c.stadium.capacity, c => c.cash, c => c.stadium.ticketPrice, c => avg(c.playerIds.map(id => s.players[id].skill))]) {
    const v = per(f);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] < v[i - 1], `division ${i + 1} below division ${i}: ${v}`);
  }
  // a season: three up and three down between neighbouring divisions, less money further down
  for (let d = 0; d < s.fixtures.d1.length; d++) L.advanceDay(s);
  assert.equal(s.season, 2);
  for (const d of s.divisions) assert.equal(d.clubIds.length, 18);
  const income = per(c => { const f = c.fin.lastSeason; return f.tickets + f.tv + f.sponsor + f.prize; });
  for (let i = 1; i < income.length; i++) assert.ok(income[i] < income[i - 1], `income falls with the division: ${income}`);
});

test('standings rank by manager points, so place and score always agree', () => {
  const s = L.createLeague(14, [{ id: 'u1', name: 'Ana', startDiv: 1 }, { id: 'u2', name: 'Ben', startDiv: 4 }, { id: 'u3', name: 'Cy', startDiv: 2 }], { clubsPerDivision: 16 });
  for (let d = 0; d < s.fixtures.d1.length + 5; d++) {
    L.advanceDay(s);
    const st = L.standings(s);
    assert.deepEqual(st.map(r => r.place), [1, 2, 3]);
    for (let i = 1; i < st.length; i++) assert.ok(st[i].points <= st[i - 1].points);
  }
});

test('the league does not grow over many seasons', () => {
  let s = L.createLeague(15, M.slice(0, 2), { clubsPerDivision: 20 });
  const len = s.fixtures.d1.length, sizes = [];
  for (let d = 0; d < len * 4; d++) { L.advanceDay(s); if (s.md === 0) { s = roundtrip(s); sizes.push(JSON.stringify(s).length); } }
  assert.ok(s.freeAgents.length <= L.FREE_AGENTS_MAX);
  assert.ok(sizes[sizes.length - 1] < sizes[0] * 1.1, `state size stays flat: ${sizes}`);
  assert.ok(JSON.stringify(L.viewFor(s, 'u1')).length < 1.5e6);
});

test('the words fit a shared league: things happen after the matchday, not overnight', () => {
  const s = L.createLeague(16, M);
  const t = Object.values(s.players).find(p => p.clubId && !s.clubs[p.clubId].human);
  assert.match(L.apply(s, 'u1', { type: 'BID', playerId: t.id, fee: 1e5 }).msg, /after the matchday/);
  assert.match(L.apply(s, 'u1', { type: 'SCOUT', playerId: t.id }).msg, /after the matchday/);
});
