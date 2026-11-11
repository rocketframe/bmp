// Bolzplatz Manager Pro shared-league rules for the Rocketframe Hub ("server" engine, stateful mode).
// This runs on bmp's own Worker (server/worker.js), not inside the hub, so rule changes deploy from this
// repo alone. Clients send commands; the server checks them with the same dispatch() the single-player
// game uses, so a modified client can't cheat. The hub keeps the room, timers and leaderboard.
// A matchday starts when every manager has pressed "ready", or at the deadline, whichever is first.
// It is played live: all matches kick off together, managers make half-time changes, the server plays
// the second half with everyone's changes, and the results become official at full time.
import * as L from '../js/server/league.js';

const HOUR = 3600e3;

export default {
  start(ctx) {
    const managers = ctx.players.map((p) => ({ id: p.id, name: p.name }));
    ctx.state.league = L.createLeague(ctx.seed, managers);
    ctx.state.ready = {};
    schedule(ctx);
    pushAll(ctx, { k: 'started' });
  },

  message(ctx, pid, d) {
    const s = ctx.state;
    if (d.k === 'cmd') {
      const res = L.apply(s.league, pid, d.cmd ?? {});
      ctx.send(pid, { k: 'cmdResult', id: d.id ?? null, res });
      if (res?.ok) ctx.send(pid, { k: 'state', view: L.viewFor(s.league, pid), ready: readyList(s), nextAt: s.nextAt });
      return !!res?.ok;
    }
    if (d.k === 'ready') {
      if (s.league.live) return false; // a matchday is being played
      if (d.ready) s.ready[pid] = true; else delete s.ready[pid];
      ctx.broadcast({ k: 'ready', ready: readyList(s) });
      if (L.managerIds(s.league).every((id) => s.ready[id])) kickoff(ctx);
      return true;
    }
    if (d.k === 'ht') {
      const res = L.halftime(s.league, pid, d.changes ?? null);
      ctx.send(pid, { k: 'htResult', res });
      if (res?.ok && res.allIn) secondHalf(ctx);
      return !!res?.ok;
    }
    return false;
  },

  join(ctx, pid) {
    const p = ctx.players.find((x) => x.id === pid);
    const res = L.joinClub(ctx.state.league, pid, p?.name ?? 'Manager');
    if (res?.ok) ctx.broadcast({ k: 'joined', pid, clubId: res.clubId });
  },

  leave(ctx, pid) {
    L.leaveClub(ctx.state.league, pid);
    delete ctx.state.ready[pid];
    ctx.broadcast({ k: 'left', pid });
    if (L.managerIds(ctx.state.league).length === 0) return end(ctx);
    // the one who left may have been the last manager the half-time break was waiting for
    if (L.halftimeComplete(ctx.state.league)) secondHalf(ctx);
  },

  timer(ctx, name) {
    if (name === 'matchday') kickoff(ctx);
    else if (name === 'ht') secondHalf(ctx);
    else if (name === 'ft') fullTime(ctx);
  },

  snapshot(ctx, pid) {
    return { k: 'state', view: L.viewFor(ctx.state.league, pid), ready: readyList(ctx.state), nextAt: ctx.state.nextAt };
  },
};

function readyList(s) { return Object.keys(s.ready); }

function schedule(ctx) {
  const now = ctx.now();
  let at;
  if (ctx.opts.pace === 'daily') {
    const d = new Date(now);
    d.setUTCHours(ctx.opts.hourUtc, 0, 0, 0);
    if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
    at = d.getTime();
  } else {
    at = now + ctx.opts.deadlineHours * HOUR;
  }
  ctx.state.nextAt = at;
  ctx.setTimer('matchday', at);
}

// Everyone ready, or the deadline: all matches kick off together a few seconds from now.
function kickoff(ctx) {
  const s = ctx.state;
  if (s.league.live) return;
  ctx.clearTimer('matchday');
  s.ready = {};
  const { htCloseAt } = L.startMatchday(s.league, ctx.now());
  ctx.setTimer('ht', htCloseAt);
  pushAll(ctx, { k: 'kickoff' });
}

// Every manager's half-time changes are in, or the break is over: play the second half.
function secondHalf(ctx) {
  const s = ctx.state;
  if (s.league.live?.phase !== 'first') return;
  ctx.clearTimer('ht');
  const { ftAt } = L.secondHalf(s.league, ctx.now());
  ctx.setTimer('ft', ftAt);
  pushAll(ctx, { k: 'secondHalf' });
}

// Full time: the results become official and the night runs.
function fullTime(ctx) {
  const s = ctx.state;
  const digest = L.advanceDay(s.league);
  s.ready = {};
  if (L.seasonsPlayed(s.league) >= ctx.opts.seasons) return end(ctx);
  schedule(ctx);
  pushAll(ctx, { k: 'day', digest, nextAt: s.nextAt });
}

function pushAll(ctx, extra) {
  for (const p of ctx.players) {
    ctx.send(p.id, { k: 'state', view: L.viewFor(ctx.state.league, p.id), ready: readyList(ctx.state), nextAt: ctx.state.nextAt });
  }
  if (extra) ctx.broadcast(extra);
}

function end(ctx) {
  const table = L.standings(ctx.state.league); // [{ id, place, points }]
  ctx.finish({ valid: true, players: ctx.players.map((p) => {
    const row = table.find((r) => r.id === p.id);
    return { id: p.id, place: row?.place ?? null, score: row?.points };
  }) });
}
