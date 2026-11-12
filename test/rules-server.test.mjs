// Tests for bmp's rules server (server/), the way the hub calls it. Run with: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRules, rulesRoom, handleHubRequest } from '../server/rules-server.js';
import rules from '../server/rules.js';

const room = { code: 'ABCDE', round: 1, seed: 42, opts: { pace: 'ready', deadlineHours: 24, hourUtc: 0, clubsPerDivision: 16 }, hostId: 'u1',
  players: [{ id: 'u1', name: 'Ana', connected: true, opts: { startDiv: 1 } }, { id: 'u2', name: 'Ben', connected: true, opts: { startDiv: 3 } }] };

test('a league starts, checks commands per manager and kicks off when everyone is ready', async () => {
  const now = Date.UTC(2026, 10, 11, 12);
  let r = await runRules(rules, { event: 'start', room, now, state: {} });
  assert.ok(r.state.league, 'the league lives in the state');
  assert.equal(r.out.filter((o) => o.msg.k === 'state').length, 2, 'each manager gets their own view');
  assert.ok(r.timers.matchday > now, 'deadline timer for the matchday');
  let state = JSON.parse(JSON.stringify(r.state));

  r = await runRules(rules, { event: 'message', room, now, state, pid: 'u1', d: { k: 'cmd', id: 1, cmd: { type: 'RENAME_CLUB', targetId: 'x', name: 'Hacked' } } });
  assert.equal(r.out.find((o) => o.msg.k === 'cmdResult').msg.res.ok, false);
  assert.equal(r.changed, false);

  r = await runRules(rules, { event: 'message', room, now, state, pid: 'u1', d: { k: 'ready', ready: true } });
  state = r.state;
  r = await runRules(rules, { event: 'message', room, now, state, pid: 'u2', d: { k: 'ready', ready: true } });
  assert.ok(r.out.some((o) => o.msg.k === 'kickoff'));
  assert.ok(r.timers.ht > now, 'half-time timer');
  assert.equal(r.timers.matchday, null, 'deadline cleared');

  const snap = await runRules(rules, { event: 'snapshot', room, now, state: r.state, pid: 'u2' });
  assert.equal(snap.reply.k, 'state');
});

test('stateful mode keeps the league in the Durable Object and only checks signed requests', async () => {
  const data = new Map();
  const Room = rulesRoom(rules);
  const obj = new Room({ storage: { get: async (k) => data.get(k), put: async (k, v) => data.set(k, JSON.parse(JSON.stringify(v))), deleteAll: async () => data.clear() } });
  const rooms = { idFromName: (n) => n, get: () => obj };
  const sign = async (body, ts) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s3cret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts + '.' + body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const call = async (ev, secret = 's3cret') => {
    const body = JSON.stringify({ v: 1, room, now: Date.now(), ...ev }), ts = String(Date.now());
    return handleHubRequest(rules, new Request('https://x/', { method: 'POST', body, headers: { 'X-Hub-Timestamp': ts, 'X-Hub-Signature': await sign(body, ts) } }), secret, { rooms });
  };
  assert.equal((await call({ event: 'start' }, 'wrong')).status, 401);
  const res = await (await call({ event: 'start' })).json();
  assert.equal(res.state, undefined, 'the state is not sent back to the hub');
  assert.ok(data.get('state').league);
  const snap = await (await call({ event: 'snapshot', pid: 'u1' })).json();
  assert.equal(snap.reply.k, 'state');
});

const divOf = (league, pid) => {
  const cid = Object.entries(league.mgrs).find(([, m]) => m.managerId === pid)?.[0];
  return league.divisions.findIndex((d) => d.clubIds.includes(cid)) + 1;
};

test('the host picks clubs per division and each manager picks a starting division', async () => {
  const r = await runRules(rules, { event: 'start', room, now: Date.now(), state: {} });
  assert.ok(r.state.league.divisions.every((d) => d.clubIds.length === 16), 'clubsPerDivision reaches createLeague');
  assert.equal(divOf(r.state.league, 'u1'), 1);
  assert.equal(divOf(r.state.league, 'u2'), 3);
  // a manager who joins mid-league gets a club in the division they picked
  const players = [...room.players, { id: 'u3', name: 'Cem', connected: true, opts: { startDiv: 4 } }];
  const j = await runRules(rules, { event: 'join', room: { ...room, players }, now: Date.now(), state: r.state, pid: 'u3', name: 'Cem' });
  assert.equal(divOf(j.state.league, 'u3'), 4);
});

test('a league has no last season and ends, with a final push, only when every manager has left', async () => {
  const now = Date.now();
  let r = await runRules(rules, { event: 'start', room, now, state: {} });
  // play past a whole season: the league must keep going
  r.state.league.season += 5;
  for (const t of ['matchday', 'ht', 'ft']) {
    r = await runRules(rules, { event: 'timer', room, now, state: r.state, name: t });
    assert.ok(!r.finish, `no finish after ${t}`);
  }
  assert.ok(r.out.some((o) => o.msg.k === 'day'));
  r = await runRules(rules, { event: 'leave', room, now, state: r.state, pid: 'u1' });
  assert.ok(!r.finish, 'one manager is still there');
  r = await runRules(rules, { event: 'leave', room: { ...room, players: room.players.slice(1) }, now, state: r.state, pid: 'u2' });
  assert.ok(r.finish, 'the league ends when the last manager leaves');
  const last = r.out.findIndex((o) => o.msg.k === 'day' && o.msg.final);
  assert.ok(last >= 0, 'the final state is pushed before the result');
  assert.ok(r.out.slice(0, last).some((o) => o.msg.k === 'state'), 'each remaining player gets their final view');
});

test('the manifest offers what the league supports', async () => {
  const { readFile } = await import('node:fs/promises');
  const L = await import('../js/server/league.js');
  const m = JSON.parse(await readFile(new URL('../hub-game.json', import.meta.url), 'utf8'));
  assert.ok(!m.options.some((o) => o.key === 'seasons'), 'no seasons option');
  const c = m.options.find((o) => o.key === 'clubsPerDivision');
  assert.deepEqual([c.min, c.max, c.default], [L.OPTIONS.clubsPerDivision.min, L.OPTIONS.clubsPerDivision.max, L.OPTIONS.clubsPerDivision.default]);
  const sd = m.playerOptions.find((o) => o.key === 'startDiv');
  assert.deepEqual(sd.choices, L.OPTIONS.divisions.map((d) => d.tier));
  assert.deepEqual(Object.values(sd.names), L.OPTIONS.divisions.map((d) => d.name));
  assert.equal(m.score.label, 'Manager points');
});
