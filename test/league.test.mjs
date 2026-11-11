// Tests for the shared-league module the game hub runs. Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/server/league.js';

const M = [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Ben' }, { id: 'u3', name: 'Cy' }];
const roundtrip = s => JSON.parse(JSON.stringify(s)); // the hub stores the state as JSON between calls

test('createLeague gives each manager a club in the top division', () => {
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
  let s = L.createLeague(1234, M.slice(0, 2));
  const days = 2 * 22 + 3;
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
