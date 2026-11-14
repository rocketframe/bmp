// Bolzplatz Manager Pro shared-league rules for the Rocketframe Hub ("server" engine, stateful mode).
// This runs on bmp's own Worker (server/worker.js), not inside the hub, so rule changes deploy from this
// repo alone. Clients send commands; the server checks them with the same dispatch() the single-player
// game uses, so a modified client can't cheat. The hub keeps the room, timers and leaderboard.
// A matchday starts when every manager has pressed "ready", or at the deadline, whichever is first.
// A manager who leaves (or is dropped by the hub) is still waited for until they come back or the
// deadline passes: the others can't play the matchday without them just by pressing ready.
// It is played live: all matches kick off together, managers make half-time changes, the server plays
// the second half with everyone's changes, and the results become official at full time.
// A league has no last season: it runs until every manager has left. The host picks the clubs per division
// (option clubsPerDivision), and each manager picks the division they start in (player option startDiv).
import * as L from '../js/server/league.js';

const HOUR = 3600e3;

export default {
  start(ctx) {
    const managers = ctx.players.map((p) => ({ id: p.id, name: p.name, startDiv: p.opts?.startDiv }));
    ctx.state.league = L.createLeague(ctx.seed, managers, { clubsPerDivision: ctx.opts.clubsPerDivision });
    ctx.state.ready = {};
    ctx.state.waitFor = {};
    schedule(ctx);
    pushAll(ctx, { k: 'started' });
  },

  message(ctx, pid, d) {
    const s = ctx.state;
    if (d.k === 'cmd') {
      const res = L.apply(s.league, pid, d.cmd ?? {});
      ctx.send(pid, { k: 'cmdResult', id: d.id ?? null, res });
      if (res?.ok) ctx.send(pid, stateMsg(ctx, pid));
      return !!res?.ok;
    }
    if (d.k === 'ready') {
      if (s.league.live) return false; // a matchday is being played
      if (d.ready) s.ready[pid] = true; else delete s.ready[pid];
      ctx.broadcast({ k: 'ready', ready: readyList(s), away: awayList(s) });
      if (allReady(s)) kickoff(ctx);
      return true;
    }
    if (d.k === 'ht') {
      const res = L.halftime(s.league, pid, d.changes ?? null);
      ctx.send(pid, { k: 'htResult', res });
      if (res?.ok && res.allIn) secondHalf(ctx);
      return !!res?.ok;
    }
    if (d.k === 'rejoin') {
      // a manager back in the room without a club (the hub dropped them): give them their club back
      if (!L.viewFor(s.league, pid) && ctx.players.some((x) => x.id === pid) && rejoin(ctx, pid)) return true;
      ctx.send(pid, stateMsg(ctx, pid)); // nothing to get back: the client shows what it has
      return false;
    }
    return false;
  },

  join(ctx, pid) { rejoin(ctx, pid); },

  leave(ctx, pid) {
    const wasManager = L.leaveClub(ctx.state.league, pid)?.ok;
    delete ctx.state.ready[pid];
    if (L.managerIds(ctx.state.league).length === 0) return end(ctx);
    if (wasManager) (ctx.state.waitFor ??= {})[pid] = true; // waited for until they're back or the deadline
    ctx.broadcast({ k: 'left', pid });
    ctx.broadcast({ k: 'ready', ready: readyList(ctx.state), away: awayList(ctx.state) });
    // the one who left may have been the last manager the half-time break was waiting for
    if (L.halftimeComplete(ctx.state.league)) secondHalf(ctx);
  },

  timer(ctx, name) {
    if (name === 'matchday') kickoff(ctx);
    else if (name === 'ht') secondHalf(ctx);
    else if (name === 'ft') fullTime(ctx);
  },

  snapshot(ctx, pid) {
    return stateMsg(ctx, pid);
  },
};

function readyList(s) { return Object.keys(s.ready); }
// Managers who left and are still waited for: [{ id, name }].
function awayList(s) {
  return Object.keys(s.waitFor ?? {}).map((id) => ({ id, name: s.league.mp.away[id]?.slot?.managerName ?? 'Manager' }));
}
// Every manager in the league is ready, and nobody who left is still waited for.
function allReady(s) {
  return L.managerIds(s.league).every((id) => s.ready[id]) && awayList(s).length === 0;
}
function stateMsg(ctx, pid) {
  const s = ctx.state;
  return { k: 'state', view: L.viewFor(s.league, pid), ready: readyList(s), away: awayList(s), nextAt: s.nextAt };
}

// Someone joins mid-league or comes back: their old club if it is still free, otherwise a new one.
function rejoin(ctx, pid) {
  const s = ctx.state;
  const p = ctx.players.find((x) => x.id === pid);
  const res = L.joinClub(s.league, pid, p?.name ?? 'Manager', p?.opts?.startDiv);
  if (!res?.ok) return false;
  if (s.waitFor) delete s.waitFor[pid];
  ctx.broadcast({ k: 'joined', pid, clubId: res.clubId });
  pushAll(ctx);
  ctx.broadcast({ k: 'ready', ready: readyList(s), away: awayList(s) });
  return true;
}

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
  s.waitFor = {}; // the deadline has passed for anyone who left: their club is the computer's now
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
  s.lastDigest = digest;
  schedule(ctx);
  pushAll(ctx, { k: 'day', digest, nextAt: s.nextAt });
}

function pushAll(ctx, extra) {
  for (const p of ctx.players) {
    ctx.send(p.id, stateMsg(ctx, p.id));
  }
  if (extra) ctx.broadcast(extra);
}

// Every manager has left: send the final state, then the result goes to the hub's leaderboard.
function end(ctx) {
  ctx.clearTimer('matchday'); ctx.clearTimer('ht'); ctx.clearTimer('ft');
  ctx.state.nextAt = null;
  pushAll(ctx, { k: 'day', digest: ctx.state.lastDigest ?? null, nextAt: null, final: true });
  const table = L.standings(ctx.state.league); // [{ id, place, points }]
  ctx.finish({ valid: true, players: ctx.players.map((p) => {
    const row = table.find((r) => r.id === p.id);
    return { id: p.id, place: row?.place ?? null, score: row?.points };
  }) });
}
