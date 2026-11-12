// Rocketframe Hub, API version 1: runs a game's rules module as a "server" engine game server.
// Copy this file into your game's server (for example a Cloudflare Worker) next to your rules:
//
//   import { handleHubRequest } from './rules-server.js';
//   import rules from './rules.js';
//   export default { fetch: (req, env) => handleHubRequest(rules, req, env.HUB_GAME_SECRET) };
//
// HUB_GAME_SECRET is the secret the hub admin page shows when your game is added.
// Your rules module exports any of these (only start and message are required):
//   start(ctx)                   a match begins: set up ctx.state, send the first messages
//   message(ctx, playerId, msg)  a player sent room.sendGame(msg); return false if nothing changed
//   join(ctx, playerId)          someone joined mid-match (manifest "joinMidGame": true)
//   leave(ctx, playerId, why)    someone left or stayed disconnected too long
//   timer(ctx, name)             a timer set with ctx.setTimer fired
//   snapshot(ctx, playerId)      return the message a (re)connecting player needs to catch up
// ctx: state (yours, saved by the hub), opts, seed, round, code, hostId, players [{ id, name, connected }],
//      now(), connected(id), send(id, msg), broadcast(msg, exceptId?), setTimer(name, atMs), clearTimer(name),
//      finish({ valid, reason?, players: [{ id, place, score? }] }), mem (scratch, empty on every call).
// The same rules module is what the hub would run for you if it ever hosts game rules itself.
//
// Big state (more than about 100 KB)? Keep it on your server instead of sending it back and forth:
// set "stateful": true in the manifest's engineConfig, add a Durable Object, and pass it here:
//   export const RulesRoom = rulesRoom(rules);    // wrangler.toml: a durable_objects binding ROOMS -> RulesRoom
//   export default { fetch: (req, env) => handleHubRequest(rules, req, env.HUB_GAME_SECRET, { rooms: env.ROOMS }) };

const enc = new TextEncoder();
const MAX_AGE_MS = 5 * 60e3;

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Checks that a request really comes from the hub. Returns the parsed body, or null.
export async function verifyHubRequest(req, secret) {
  if (req.method !== 'POST' || !secret) return null;
  const ts = req.headers.get('X-Hub-Timestamp') || '';
  const body = await req.text();
  if (!(Math.abs(Date.now() - Number(ts)) < MAX_AGE_MS)) return null;
  if (!same(await hmacHex(secret, ts + '.' + body), req.headers.get('X-Hub-Signature') || '')) return null;
  try { return JSON.parse(body); } catch { return null; }
}

// Runs one hub event through the rules and returns what the hub should do.
export async function runRules(rules, ev) {
  const out = [], timers = {};
  let finish = null;
  const state = ev.state && typeof ev.state === 'object' ? ev.state : {};
  const room = ev.room || {};
  const players = room.players || [];
  const ctx = {
    state, opts: room.opts || {}, seed: room.seed, round: room.round, code: room.code, hostId: room.hostId, startedAt: room.startedAt,
    players: players.map((p) => ({ id: p.id, name: p.name, opts: p.opts ?? {} })), mem: {},
    now: () => ev.now ?? Date.now(),
    connected: (id) => !!players.find((p) => p.id === id)?.connected,
    send: (to, msg) => out.push({ to, msg }),
    broadcast: (msg, except) => out.push({ msg, except: except ?? null }),
    setTimer: (name, at) => { timers[name] = at; },
    clearTimer: (name) => { timers[name] = null; },
    finish: (result) => { finish = result; },
  };
  let changed = true, reply = null;
  switch (ev.event) {
    case 'start': await rules.start?.(ctx); break;
    case 'message': changed = (await rules.message?.(ctx, ev.pid, ev.d ?? {})) !== false; break;
    case 'join': await rules.join?.(ctx, ev.pid); break;
    case 'leave': await rules.leave?.(ctx, ev.pid, ev.why); break;
    case 'timer': await rules.timer?.(ctx, ev.name); break;
    case 'snapshot': reply = (await rules.snapshot?.(ctx, ev.pid)) ?? null; return { reply };
    default: return { error: 'unknown event' };
  }
  return { state, out, timers, finish, changed };
}

// A Durable Object class that keeps one match's state (stateful mode). One object per room and round.
export function rulesRoom(rules) {
  return class RulesRoom {
    constructor(ctx) { this.ctx = ctx; }
    async fetch(req) {
      const ev = await req.json();
      ev.state = (await this.ctx.storage.get('state')) ?? {};
      const res = await runRules(rules, ev);
      if (res.finish) await this.ctx.storage.deleteAll();       // the match is over; nothing to keep
      else if (ev.event !== 'snapshot' && res.state) await this.ctx.storage.put('state', res.state);
      delete res.state;
      return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json' } });
    }
  };
}

export async function handleHubRequest(rules, req, secret, { rooms } = {}) {
  const ev = await verifyHubRequest(req, secret);
  if (!ev) return new Response(JSON.stringify({ error: 'not from the hub' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if (rooms) {
    const id = rooms.idFromName(String(ev.room?.code) + ':' + String(ev.room?.round));
    return rooms.get(id).fetch(new Request('https://rules-room/', { method: 'POST', body: JSON.stringify(ev) }));
  }
  try {
    return new Response(JSON.stringify(await runRules(rules, ev)), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'rules failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
