import { GAME_TITLE, DEV_TOOLS, SAVE_KEY, PREFS_KEY } from './config.js';
import { createWorld, SAVE_VERSION } from './core/world.js';
import * as G from './core/game.js';
import { FORMATIONS, FORMATION_KEYS, MENTALITIES, TRAINING_FOCUS, LEAGUE, POS_LABEL } from './core/constants.js';
import { makeSheet } from './core/sim.js';
import { MatchView, SCENE_LABEL } from './match/view.js';
import { StadiumAudio } from './match/audio.js';
import { Commentator } from './match/voice.js';
import { $, $$, esc, money, num, toast, bar, skillClass } from './ui/dom.js';
import { crest } from './ui/crest.js';
import * as Pk from './ui/pack.js';
import { adSlot, mountAds } from './ads.js';

const app = { state: null, view: 'today', ui: { tab: {}, sel: null, filter: { pos: 'ALL', max: 0, sort: 'skill', q: '' }, indiv: [], focus: 'balanced', mdView: null, divView: null, edClub: null, mailOpen: null }, prefs: loadPrefs(), audio: new StadiumAudio(), voice: new Commentator() };
app.voice.preferred = app.prefs.voiceName; app.voice.pickVoice(app.prefs.voiceName);
const S = () => app.state;
const me = () => G.human(app.state);
const P = id => app.state.players[id];
const CL = id => app.state.clubs[id];

// ---------- persistence ----------
function loadPrefs() { try { return { speed: 1, camera: 'broadcast', sound: false, voice: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch (e) { return { speed: 1, camera: 'broadcast', sound: false }; } }
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(app.prefs)); } catch (e) {} }
function save() {
  if (!app.state) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(app.state)); } catch (e) { toast('Could not save in this browser. Export your save from Options to keep it.', 'bad'); }
}
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && s.version === SAVE_VERSION && s.humans?.length) return s; } catch (e) {}
  return null;
}

// ---------- helpers ----------
const cv = c => Pk.cview(c);
const cn = c => esc(Pk.cname(c));
const cs = c => esc(Pk.cshort(c));
const pn = p => esc(Pk.pname(p));
const ps = p => esc(Pk.pshort(p));
const posTag = p => `<span class="pos pos-${p}">${p}</span>`;
const stars = r => { const n = Math.max(1, Math.min(5, Math.round((r - 45) / 8))); return '★'.repeat(n) + '<span style="opacity:.25">' + '★'.repeat(5 - n) + '</span>'; };
const seasonLabel = () => `${S().year}/${String(S().year + 1).slice(2)}`;
const potLabel = p => (p.clubId && CL(p.clubId)?.human) || p.scouted ? `<span class="skill ${skillClass(p.potential)}">${p.potential}</span>` : '<span class="muted" title="Send a scout to find out">?</span>';
const statusChips = (p, club) => {
  const out = [];
  if (p.injury > 0) out.push(`<span class="chip bad">Injured ${p.injury}d</span>`);
  if (p.suspended > 0) out.push(`<span class="chip bad">Suspended</span>`);
  if (p.listed) out.push(`<span class="chip warn">Listed</span>`);
  if (club && club.lineup.includes(p.id)) out.push(`<span class="chip ok">XI</span>`);
  else if (club && club.bench.includes(p.id)) out.push(`<span class="chip">Bench</span>`);
  if (p.contract <= 1 && club) out.push(`<span class="chip warn">${p.contract ? '1 yr left' : 'Expiring'}</span>`);
  return out.join(' ');
};
function msToMidnight() { const n = new Date(Date.now() + (S()?.calendar.devOffset || 0) * 864e5); const m = new Date(n); m.setHours(24, 0, 0, 0); return m - n; }
function fmtDur(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }

const ICONS = {
  today: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  squad: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0z',
  training: 'M4 10h2v4H4zm14 0h2v4h-2zM7 7h2v10H7zm8 0h2v10h-2zM9 11h6v2H9z',
  transfers: 'M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3',
  league: 'M7 4h10v3a5 5 0 0 1-10 0zM4 5h3v2a3 3 0 0 1-3-2zm16 0h-3v2a3 3 0 0 0 3-2zM10 14h4v4h3v2H7v-2h3z',
  club: 'M3 21V9l9-5 9 5v12zM8 21v-6h8v6M7 11h2m6 0h2',
  inbox: 'M3 6h18v12H3zm0 0 9 7 9-7',
  names: 'M4 20h4L19 9l-4-4L4 16zm11-15 4 4',
  options: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8-3 2-1-2-4-2 1-2-2V4h-4v2l-2 2-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 2v2h4v-2l2-2 2 1 2-4-2-1z',
};
const NAV = [['today', 'Today'], ['squad', 'Squad'], ['training', 'Training'], ['transfers', 'Transfers'], ['league', 'League'], ['club', 'Club'], ['inbox', 'Inbox'], ['names', 'Names'], ['options', 'Options']];
const icon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[k]}"/></svg>`;

// ---------- shell ----------
function render() {
  const root = $('#app');
  if (!app.state) { renderTitle(root); return; }
  const s = S(), c = me();
  const unread = s.inbox.filter(m => !m.read).length;
  const view = VIEWS[app.view] ? app.view : 'today';
  root.innerHTML = `
  <div class="app">
    <header class="top"><div class="top-in">
      <a class="logo" href="#today"><span class="logo-mark"></span><span>Bolzplatz <b>Manager Pro</b></span></a>
      <div class="top-club">${crest(cv(c), 34)}<div><div class="nm">${cn(c)}</div><div class="label">${esc(Pk.dname(G.divisionOf(s, c.id)))} · ${seasonLabel()}</div></div></div>
      <div class="top-stats">
        <div class="stat hide-m"><span class="label">Day</span><span class="v">${s.calendar.day} · MD ${Math.min(s.md + 1, G.seasonLength(s))}/${G.seasonLength(s)}</span></div>
        <div class="stat"><span class="label">Cash</span><span class="v" style="color:${c.cash < 0 ? 'var(--red)' : 'inherit'}">${money(c.cash)}</span></div>
        <div class="stat streak" title="Days in a row you've managed the club"><span class="label">Streak</span><span class="v">${s.calendar.streak}🔥</span></div>
      </div>
    </div></header>
    <div class="ad-row">${adSlot('top')}</div>
    <div class="shell">
      <nav class="nav" aria-label="Sections">${NAV.map(([k, l]) => `<a href="#${k}" class="${view === k ? 'on' : ''}">${icon(k)}<span>${l}</span>${k === 'inbox' && unread ? `<span class="badge">${unread}</span>` : ''}</a>`).join('')}</nav>
      <main id="main">${VIEWS[view]()}</main>
      <aside class="rail">${adSlot('rail')}<p class="legal">${esc(GAME_TITLE)} is a work of fiction. Clubs, leagues and players are invented. <a href="#legal">Terms & disclaimer</a></p></aside>
    </div>
  </div>`;
  mountAds(root);
  afterRender();
}
function afterRender() {
  const cd = $('[data-countdown]');
  clearInterval(app.cdTimer);
  if (cd) app.cdTimer = setInterval(() => {
    const ms = msToMidnight(); cd.textContent = fmtDur(ms);
    if (ms < 1000) { clearInterval(app.cdTimer); setTimeout(() => { sync(); render(); }, 1500); }
  }, 1000);
}
function go(v) { if (location.hash !== '#' + v) location.hash = v; else { app.view = v; render(); } }
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && app.state) { closeModal(); app.view = v; app.ui.sel = null; render(); window.scrollTo(0, 0); } });

// ---------- views ----------
const VIEWS = {
  today() {
    const s = S(), c = me(), fx = G.fixtureFor(s, c.id);
    const t = s.today; const rep = t.report;
    const home = CL(fx ? fx.h : c.id), away = CL(fx ? fx.a : c.id);
    const tbl = G.computeTable(s, c.divisionId);
    const myRow = tbl.find(r => r.id === c.id);
    const visitedSquad = t.teamSet, visitedMarket = t.marketSeen || s.bids.length > 0;
    const steps = [
      ['training', 'Train', t.trained ? 'Session done' : 'Pick today’s focus', t.trained],
      ['squad', 'Set your team', visitedSquad ? 'Team checked' : `${c.formation} · ${MENTALITIES[c.mentality].label}`, visitedSquad || t.played],
      ['play', 'Play matchday', t.played ? 'Full time' : 'Kick off when ready', t.played],
      ['transfers', 'Market', s.bids.length ? `${s.bids.length} bid${s.bids.length > 1 ? 's' : ''} pending` : 'Bids resolve overnight', visitedMarket],
    ];
    const nextI = steps.findIndex(x => !x[3]);
    const window5 = (() => { const i = tbl.findIndex(r => r.id === c.id); const a = Math.max(0, Math.min(i - 2, tbl.length - 5)); return tbl.slice(a, a + 5); })();
    const userScore = rep ? (rep.home === c.id ? rep.score : rep.score) : null;
    const flames = Array.from({ length: 7 }, (_, i) => `<i class="${i < (s.calendar.streak % 7 || (s.calendar.streak ? 7 : 0)) ? 'on' : ''}"></i>`).join('');
    const mails = s.inbox.slice(0, 5);
    return `
    <div class="page-h"><div><div class="kicker">Day ${s.calendar.day} · Matchday ${Math.min(s.md + (t.played ? 0 : 1), G.seasonLength(s))} of ${G.seasonLength(s)}</div><h2>Good ${greeting()}, ${esc(s.managerName)}</h2></div>
      <div class="row">${myRow ? `<span class="chip">${G.ordinal(myRow.pos)} in ${esc(Pk.dname(G.divisionOf(s, c.id)))}</span>` : ''}<span class="chip">Board target: ${G.ordinal(c.board.target)}</span></div></div>
    <section class="card hero-match"><div class="bg"></div><div class="hero-in">
      <div class="row"><span class="label">${t.played ? 'Today’s result' : 'Today’s match'} · ${esc(Pk.cstadium(home))}</span><span class="sp"></span>${!t.played ? `<span class="chip">${home.id === c.id ? 'Home' : 'Away'}</span>` : ''}</div>
      <div class="versus">
        <div class="side">${crest(cv(home), 64)}<div><div class="nm">${cn(home)}</div><div class="sub">${formChips(tbl, home.id)}</div></div></div>
        <div class="vs">${rep ? `<div class="score">${rep.score[0]}–${rep.score[1]}</div>` : 'VS'}</div>
        <div class="side r">${crest(cv(away), 64)}<div><div class="nm">${cn(away)}</div><div class="sub">${formChips(tbl, away.id)}</div></div></div>
      </div>
      <div class="steps">${steps.map(([k, l, sub, done], i) => `<a class="step ${done ? 'done' : ''} ${i === nextI ? 'next' : ''}" href="${k === 'play' ? '#today' : '#' + k}" ${k === 'play' && !t.played ? 'data-act="preview"' : ''}><span class="label">${done ? '✓' : i + 1}. ${l}</span><b>${esc(sub)}</b></a>`).join('')}</div>
      <div class="row">${t.played
        ? `<div><div class="label">Next matchday unlocks in</div><div class="countdown" data-countdown>${fmtDur(msToMidnight())}</div></div><span class="sp"></span><a class="btn" href="#league">See all results</a>`
        : `<button class="btn primary" data-act="preview">▶ Play matchday</button><button class="btn ghost" data-act="quick">Quick result</button><span class="sp"></span><span class="muted" style="font-size:13px">Miss today and your assistant plays it. Training is lost.</span>`}</div>
    </div></section>
    <div class="grid2">
      <section class="card"><div class="card-h"><h3>Daily objectives</h3><span class="label">Reset at midnight</span></div>
        ${t.objectives.map(o => `<div class="obj ${o.done ? 'done' : ''}"><span class="tick"></span><span class="t">${esc(o.label)}</span><span class="reward">+${money(o.reward)}</span></div>`).join('')}
      </section>
      <section class="card"><div class="card-h"><h3>Login streak</h3><span class="label">Best: ${s.calendar.bestStreak} days</span></div>
        <div class="row" style="justify-content:space-between"><div class="flame">${flames}</div><div class="big-money">${s.calendar.streak}<span class="label"> days</span></div></div>
        <p class="muted" style="margin:10px 0 0;font-size:14px">Your sponsor pays a loyalty bonus every day you show up, growing for 7 days in a row. Every 7th day the fans get a hype boost.</p>
      </section>
    </div>
    <div class="grid2">
      <section class="card"><div class="card-h"><h3>Inbox</h3><a href="#inbox" class="label">All messages</a></div>
        ${mails.map(m => `<div class="mail ${m.read ? '' : 'unread'}" data-act="openmail" data-id="${m.id}"><span class="t">${esc(m.title)}</span><span class="label">Day ${m.day}</span></div>`).join('') || '<p class="muted">No messages yet.</p>'}
      </section>
      <section class="card"><div class="card-h"><h3>League</h3><a href="#league" class="label">Full table</a></div>
        <table><thead><tr><th>#</th><th>Club</th><th class="n">P</th><th class="n">GD</th><th class="n">Pts</th></tr></thead><tbody>
        ${window5.map(r => `<tr class="${r.id === c.id ? 'me' : ''}"><td class="n">${r.pos}</td><td><span class="pl">${crest(cv(CL(r.id)), 20)}${cn(CL(r.id))}</span></td><td class="n">${r.p}</td><td class="n">${r.gf - r.ga}</td><td class="n"><b>${r.pts}</b></td></tr>`).join('')}
        </tbody></table>
      </section>
    </div>
    ${adSlot('inline')}
    <section class="card"><div class="card-h"><h3>Around the league</h3></div>
      ${s.news.slice(0, 6).map(n => `<div class="mail"><span class="b">${esc(n.text)}</span></div>`).join('') || '<p class="muted">Quiet so far. Transfers and results will show up here.</p>'}
    </section>`;
  },

  squad() {
    const s = S(), c = me();
    s.today.teamSet = true;
    const slots = FORMATIONS[c.formation];
    const sel = app.ui.sel;
    const squad = c.playerIds.map(P).sort((a, b) => (c.lineup.includes(b.id) - c.lineup.includes(a.id)) || (c.bench.includes(b.id) - c.bench.includes(a.id)) || ('GKDFMFFW'.indexOf(a.pos) - 'GKDFMFFW'.indexOf(b.pos)) || b.skill - a.skill);
    const kit = Pk.ccolors(c);
    const board = slots.map((sl, i) => {
      const p = P(c.lineup[i]); const left = (68 - sl[3]) / 68 * 100, top = 95 - sl[2] / 64 * 86;
      const bad = p && p.pos !== sl[0];
      return `<button class="slot ${sel === 'slot' + i ? 'sel' : ''} ${bad ? 'warn' : ''}" style="left:${left}%;top:${top}%" data-act="slot" data-i="${i}" title="${sl[1]}${bad ? ' (out of position)' : ''}">
        <span class="dot" style="background:${sl[0] === 'GK' ? '#f5d90a' : kit.primary};color:${sl[0] === 'GK' ? '#111' : kit.secondary}">${p ? p.number : '?'}</span>
        <span class="nm">${p ? esc(Pk.plast(p)) : 'Empty'}</span><span class="rl">${sl[1]}${p ? ' · ' + p.skill : ''}</span></button>`;
    }).join('');
    return `
    <div class="page-h"><div><div class="kicker">${c.playerIds.length} players · cohesion ${Math.round(c.cohesion)}%</div><h2>Squad & tactics</h2></div>
      <div class="row"><button class="btn" data-act="autopick">Auto-pick best XI</button></div></div>
    <div class="grid2" style="grid-template-columns:minmax(0,5fr) minmax(0,7fr)">
      <section class="card" style="display:grid;gap:14px;align-content:start">
        <div><div class="label" style="margin-bottom:6px">Formation</div><div class="seg">${FORMATION_KEYS.map(f => `<button class="${c.formation === f ? 'on' : ''}" data-act="formation" data-f="${f}">${f}</button>`).join('')}</div></div>
        <div><div class="label" style="margin-bottom:6px">Mentality</div><div class="seg">${Object.entries(MENTALITIES).map(([k, m]) => `<button class="${c.mentality === k ? 'on' : ''}" data-act="mentality" data-m="${k}">${m.label}</button>`).join('')}</div></div>
        <div class="board">${board}</div>
        <p class="muted" style="margin:0;font-size:13px">${sel ? 'Now pick a player from the list, or another position, to swap.' : 'Click a position, then a player, to swap them. Red rings mean out of position.'}</p>
      </section>
      <section class="card"><div class="card-h"><h3>Players</h3><span class="label">Click a row for details</span></div>
        <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Pos</th><th>Name</th><th class="n">Age</th><th class="n">Skill</th><th class="n">Pot</th><th class="n">Form</th><th>Fitness</th><th class="n">Wage/wk</th><th>Status</th></tr></thead><tbody>
        ${squad.map(p => `<tr class="click ${sel === p.id ? 'me' : ''}" data-act="prow" data-id="${p.id}"><td class="n">${p.number}</td><td>${posTag(p.pos)}</td><td><b>${pn(p)}</b></td><td class="n">${p.age}</td><td class="n"><span class="skill ${skillClass(p.skill)}">${p.skill}</span></td><td class="n">${potLabel(p)}</td><td class="n">${p.form.toFixed(1)}</td><td>${bar(p.fitness, 100, p.fitness < 70 ? 'red' : p.fitness < 85 ? 'amber' : '')}</td><td class="n">${money(p.wage)}</td><td>${statusChips(p, c)}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
    </div>`;
  },

  training() {
    const s = S(), c = me(), t = s.today;
    if (t.trained) {
      const r = t.trainingReport || { report: [] };
      return `<div class="page-h"><div><div class="kicker">${TRAINING_FOCUS[r.focus]?.label || 'Session'} · done</div><h2>Training report</h2></div></div>
      <section class="card"><div class="card-h"><h3>Who improved today</h3><span class="label">Training ground level ${c.facilities.training}</span></div>
        ${r.report.length ? `<table><thead><tr><th>Player</th><th>Improved</th><th class="n">Skill</th></tr></thead><tbody>${r.report.map(x => { const p = P(x.id); return p ? `<tr><td><span class="pl">${posTag(p.pos)} <b>${pn(p)}</b></span></td><td>${x.gained.map(a => `<span class="chip ok">+1 ${a}</span>`).join(' ')}</td><td class="n"><span class="skill ${skillClass(p.skill)}">${p.skill}</span>${x.up ? ` <span style="color:var(--pitch)">▲${x.up}</span>` : ''}</td></tr>` : ''; }).join('')}</tbody></table>` : '<p class="muted">Nobody made a visible step today. Young players with high potential improve fastest.</p>'}
        <p class="muted" style="font-size:14px">The squad can train once a day. Come back tomorrow for the next session.</p>
      </section>`;
    }
    const pool = c.playerIds.map(P).filter(p => p.injury <= 0).sort((a, b) => G.trainingGainChance(b, c.facilities.training) - G.trainingGainChance(a, c.facilities.training));
    return `
    <div class="page-h"><div><div class="kicker">Once a day · skipped days are lost</div><h2>Training</h2></div><button class="btn primary" data-act="train">Run today's session</button></div>
    <section class="card"><div class="card-h"><h3>Session focus</h3></div>
      <div class="focus-grid">${Object.entries(TRAINING_FOCUS).map(([k, f]) => `<button class="focus ${app.ui.focus === k ? 'on' : ''}" data-act="focus" data-k="${k}"><b>${f.label}</b><span>${f.desc}</span></button>`).join('')}</div>
    </section>
    <section class="card"><div class="card-h"><h3>Individual coaching</h3><span class="label">${app.ui.indiv.length}/3 picked · 2.6× gains</span></div>
      <div class="tbl-wrap"><table><thead><tr><th></th><th>Pos</th><th>Name</th><th class="n">Age</th><th class="n">Skill</th><th class="n">Potential</th><th class="n">Daily growth chance</th></tr></thead><tbody>
      ${pool.map(p => `<tr class="click ${app.ui.indiv.includes(p.id) ? 'me' : ''}" data-act="indiv" data-id="${p.id}"><td>${app.ui.indiv.includes(p.id) ? '✓' : ''}</td><td>${posTag(p.pos)}</td><td><b>${pn(p)}</b></td><td class="n">${p.age}</td><td class="n"><span class="skill ${skillClass(p.skill)}">${p.skill}</span></td><td class="n">${p.potential}</td><td class="n">${Math.round(G.trainingGainChance(p, c.facilities.training) * 100)}%</td></tr>`).join('')}
      </tbody></table></div>
    </section>`;
  },

  transfers() {
    const s = S(), c = me(); s.today.marketSeen = true;
    const tab = app.ui.tab.tr || 'market';
    const f = app.ui.filter;
    const tabs = [['market', 'Market'], ['free', 'Free agents'], ['bids', `My bids (${s.bids.length})`], ['offers', `Offers (${s.offers.filter(o => o.status === 'open').length})`], ['listed', 'My listed']];
    let body = '';
    if (tab === 'market' || tab === 'free') {
      let list = Object.values(s.players).filter(p => tab === 'free' ? (!p.clubId && (!p.youthOf || p.youthOf === c.id)) : (p.clubId && p.clubId !== c.id));
      if (f.pos !== 'ALL') list = list.filter(p => p.pos === f.pos);
      if (f.q) { const q = f.q.toLowerCase(); list = list.filter(p => Pk.pname(p).toLowerCase().includes(q) || (p.clubId && Pk.cname(CL(p.clubId)).toLowerCase().includes(q))); }
      if (f.max) list = list.filter(p => p.value <= f.max);
      const key = { skill: p => -p.skill, value: p => p.value, age: p => p.age, pot: p => -(p.scouted ? p.potential : 0) }[f.sort];
      list.sort((a, b) => key(a) - key(b));
      const shown = list.slice(0, 80);
      body = `<div class="row" style="margin-bottom:12px">
        <div class="seg">${['ALL', 'GK', 'DF', 'MF', 'FW'].map(x => `<button class="${f.pos === x ? 'on' : ''}" data-act="fpos" data-v="${x}">${x === 'ALL' ? 'All' : x}</button>`).join('')}</div>
        <select id="fmax" data-chg="fmax"><option value="0">Any value</option>${[250e3, 500e3, 1e6, 2e6, 5e6, 10e6].map(v => `<option value="${v}" ${f.max == v ? 'selected' : ''}>Up to ${money(v)}</option>`).join('')}</select>
        <select id="fsort" data-chg="fsort">${[['skill', 'Best first'], ['value', 'Cheapest first'], ['age', 'Youngest first'], ['pot', 'Scouted potential']].map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input id="fq" type="text" placeholder="Search name or club" value="${esc(f.q)}" data-chg="fq">
      </div>
      <div class="tbl-wrap"><table><thead><tr><th>Pos</th><th>Name</th><th class="n">Age</th><th>Club</th><th class="n">Skill</th><th class="n">Pot</th><th class="n">Value</th><th class="n">Wage</th><th></th></tr></thead><tbody>
      ${shown.map(p => { const cl = p.clubId ? CL(p.clubId) : null; const bid = s.bids.find(b => b.playerId === p.id); return `<tr class="click" data-act="prow" data-id="${p.id}"><td>${posTag(p.pos)}</td><td><b>${pn(p)}</b>${p.youthOf ? ' <span class="chip ok">Academy</span>' : ''}</td><td class="n">${p.age}</td><td>${cl ? `<span class="pl">${crest(cv(cl), 18)}${cs(cl)}</span>` : '<span class="muted">Free</span>'}</td><td class="n"><span class="skill ${skillClass(p.skill)}">${p.skill}</span></td><td class="n">${potLabel(p)}</td><td class="n">${money(p.value)}</td><td class="n">${money(p.wage)}</td><td>${bid ? `<span class="chip warn">Bid ${money(bid.fee)}</span>` : p.listed ? '<span class="chip">Listed</span>' : ''}</td></tr>`; }).join('')}
      </tbody></table></div>${list.length > 80 ? `<p class="muted">Showing 80 of ${list.length}. Narrow the filters to see more.</p>` : ''}`;
    } else if (tab === 'bids') {
      body = s.bids.length ? `<table><thead><tr><th>Player</th><th>Club</th><th class="n">Your bid</th><th class="n">Value</th><th></th></tr></thead><tbody>${s.bids.map(b => { const p = P(b.playerId); return `<tr><td><b>${pn(p)}</b></td><td>${cn(CL(p.clubId))}</td><td class="n">${money(b.fee)}</td><td class="n">${money(p.value)}</td><td><button class="btn small" data-act="cancelbid" data-id="${p.id}">Withdraw</button></td></tr>`; }).join('')}</tbody></table><p class="muted">Clubs answer overnight. You'll find their replies in your inbox tomorrow.</p>` : '<p class="muted">No open bids. Find a player in the market and make an offer. Clubs reply overnight.</p>';
    } else if (tab === 'offers') {
      const open = s.offers.filter(o => o.status === 'open');
      body = open.length ? `<table><thead><tr><th>Player</th><th>From</th><th class="n">Offer</th><th class="n">Value</th><th class="n">Expires</th><th></th></tr></thead><tbody>${open.map(o => { const p = P(o.playerId); return `<tr><td><b>${pn(p)}</b> ${posTag(p.pos)}</td><td><span class="pl">${crest(cv(CL(o.from)), 18)}${cn(CL(o.from))}</span></td><td class="n"><b>${money(o.fee)}</b></td><td class="n">${money(p.value)}</td><td class="n">${o.expires - s.calendar.day <= 1 ? 'Tonight' : 'Tomorrow night'}</td><td class="row"><button class="btn small primary" data-act="accept" data-id="${o.id}">Accept</button><button class="btn small" data-act="reject" data-id="${o.id}">Reject</button></td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">No offers right now. List players to attract bids. New offers arrive overnight.</p>';
    } else {
      const l = c.playerIds.map(P).filter(p => p.listed);
      body = l.length ? `<table><tbody>${l.map(p => `<tr class="click" data-act="prow" data-id="${p.id}"><td>${posTag(p.pos)}</td><td><b>${pn(p)}</b></td><td class="n">${money(p.value)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No players listed. Open a player from your squad and choose "List for transfer".</p>';
    }
    return `<div class="page-h"><div><div class="kicker">Budget ${money(c.cash)} · squad ${c.playerIds.length}/${LEAGUE.squadMax}</div><h2>Transfers</h2></div></div>
    <section class="card"><div class="tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-g="tr" data-v="${k}">${l}</button>`).join('')}</div>${body}</section>`;
  },

  league() {
    const s = S(), c = me();
    const divId = app.ui.divView || c.divisionId;
    const div = s.divisions.find(d => d.id === divId);
    const tbl = G.computeTable(s, divId);
    const n = tbl.length;
    const mdMax = G.seasonLength(s);
    const md = app.ui.mdView ?? Math.max(0, Math.min(s.md - (s.today.played ? 1 : 0), mdMax - 1));
    const round = s.fixtures[divId][md] || [];
    const scorers = div.clubIds.flatMap(id => CL(id).playerIds.map(P)).filter(p => p.stats.goals > 0).sort((a, b) => b.stats.goals - a.stats.goals).slice(0, 8);
    return `<div class="page-h"><div><div class="kicker">Season ${seasonLabel()}</div><h2>${esc(Pk.dname(div))}</h2></div>
      <div class="seg">${s.divisions.map(d => `<button class="${d.id === divId ? 'on' : ''}" data-act="div" data-v="${d.id}">${esc(Pk.dname(d))}</button>`).join('')}</div></div>
    <section class="card"><div class="tbl-wrap"><table><thead><tr><th class="n">#</th><th>Club</th><th class="n">P</th><th class="n">W</th><th class="n">D</th><th class="n">L</th><th class="n">GF</th><th class="n">GA</th><th class="n">GD</th><th class="n">Pts</th><th>Form</th></tr></thead><tbody>
      ${tbl.map(r => { const cl = CL(r.id); const z = divId === s.divisions[0].id ? (r.pos > n - LEAGUE.promote ? 'zone-down' : '') : (r.pos <= LEAGUE.promote ? 'zone-up' : ''); return `<tr class="${r.id === c.id ? 'me' : ''} ${z}"><td class="n">${r.pos}</td><td><span class="pl">${crest(cv(cl), 22)}<span class="nm">${cn(cl)}</span></span></td><td class="n">${r.p}</td><td class="n">${r.w}</td><td class="n">${r.d}</td><td class="n">${r.l}</td><td class="n">${r.gf}</td><td class="n">${r.ga}</td><td class="n">${r.gf - r.ga}</td><td class="n"><b>${r.pts}</b></td><td>${r.form.map(x => `<span class="form-${x}">${x}</span>`).join('')}</td></tr>`; }).join('')}
    </tbody></table></div><p class="label" style="margin:10px 0 0">${divId === s.divisions[0].id ? `Bottom ${LEAGUE.promote} are relegated` : `Top ${LEAGUE.promote} are promoted`}</p></section>
    <div class="grid2">
      <section class="card"><div class="card-h"><h3>Matchday ${md + 1}</h3><div class="row"><button class="btn small" data-act="md" data-v="${md - 1}" ${md <= 0 ? 'disabled' : ''}>◀</button><button class="btn small" data-act="md" data-v="${md + 1}" ${md >= mdMax - 1 ? 'disabled' : ''}>▶</button></div></div>
        <table><tbody>${round.map(f => `<tr class="${f.h === c.id || f.a === c.id ? 'me' : ''}"><td style="text-align:right">${cn(CL(f.h))}</td><td class="n" style="text-align:center;width:64px"><b>${f.r ? `${f.r.s[0]} – ${f.r.s[1]}` : 'v'}</b></td><td>${cn(CL(f.a))}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="card"><div class="card-h"><h3>Top scorers</h3></div>
        ${scorers.length ? `<table><tbody>${scorers.map(p => `<tr><td><b>${pn(p)}</b></td><td>${cs(CL(p.clubId))}</td><td class="n"><b>${p.stats.goals}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No goals yet this season.</p>'}
      </section>
    </div>`;
  },

  club() {
    const s = S(), c = me();
    const led = c.fin.season;
    const inc = led.tickets + led.merch + led.sponsor + led.tv + led.prize + led.transfersIn + led.bonus;
    const exp = led.wages + led.transfersOut + led.building + led.other;
    const wages = c.playerIds.reduce((a, id) => a + P(id).wage, 0);
    const tbl = G.computeTable(s, c.divisionId); const pos = tbl.find(r => r.id === c.id)?.pos || 6;
    const fx = G.fixtureFor(s, c.id);
    const att = G.expectedAttendance(s, c, fx ? CL(fx.h === c.id ? fx.a : fx.h) : null, pos);
    const hist = c.fin.history.slice(-30);
    const opts = G.buildOptions(s, c);
    const builds = s.builds.filter(b => b.clubId === c.id);
    return `<div class="page-h"><div><div class="kicker">${esc(Pk.cstadium(c))} · ${num(c.stadium.capacity)} seats</div><h2>Club office</h2></div></div>
    <div class="grid2">
      <section class="card"><div class="card-h"><h3>Finances</h3><span class="label">Season ${seasonLabel()}</span></div>
        <div class="big-money" style="color:${c.cash < 0 ? 'var(--red)' : 'var(--text)'}">${money(c.cash)}</div>
        ${sparkline(hist)}
        <dl class="kv">
          <dt>Weekly wages</dt><dd>${money(-wages)}</dd><dt>Weekly sponsor</dt><dd>${money(G.sponsorWeekly(c))}</dd>
          <dt>Gate receipts</dt><dd>${money(led.tickets)}</dd><dt>Merchandise</dt><dd>${money(led.merch)}</dd><dt>TV money</dt><dd>${money(led.tv)}</dd>
          <dt>Sponsors</dt><dd>${money(led.sponsor)}</dd><dt>Bonuses & objectives</dt><dd>${money(led.bonus)}</dd><dt>Player sales</dt><dd>${money(led.transfersIn)}</dd>
          <dt>Wages paid</dt><dd>${money(led.wages)}</dd><dt>Transfers</dt><dd>${money(led.transfersOut)}</dd><dt>Building</dt><dd>${money(led.building)}</dd>
          <dt><b>Season net</b></dt><dd><b style="color:${inc + exp >= 0 ? 'var(--pitch)' : 'var(--red)'}">${money(inc + exp)}</b></dd>
        </dl>
      </section>
      <section class="card"><div class="card-h"><h3>Matchday tickets</h3></div>
        <label class="label" for="tp">Ticket price: <b style="color:var(--text)">€${c.stadium.ticketPrice}</b></label>
        <input id="tp" type="range" min="5" max="120" value="${c.stadium.ticketPrice}" data-chg="ticket">
        <dl class="kv" style="margin-top:10px"><dt>Expected crowd next home game</dt><dd>${num(att)} (${Math.round(att / c.stadium.capacity * 100)}%)</dd><dt>Expected gate</dt><dd>${money(att * c.stadium.ticketPrice)}</dd><dt>Fan hype</dt><dd>${Math.round(c.hype || 0)}</dd></dl>
        <p class="muted" style="font-size:13px">Cheaper tickets fill the ground. Winning and a long login streak raise hype.</p>
        <div class="card-h" style="margin-top:16px"><h3>Board</h3></div>
        <dl class="kv"><dt>Target</dt><dd>${G.ordinal(c.board.target)} or better</dd><dt>Confidence</dt><dd>${bar(c.board.confidence, 100, c.board.confidence < 35 ? 'red' : c.board.confidence < 60 ? 'amber' : '')} ${Math.round(c.board.confidence)}%</dd></dl>
      </section>
    </div>
    <section class="card"><div class="card-h"><h3>Building projects</h3><span class="label">Training ground L${c.facilities.training} · Academy L${c.facilities.youth}</span></div>
      ${builds.length ? builds.map(b => `<div class="notice" style="margin-bottom:10px">🏗 ${b.kind === 'stadium' ? `Stadium expansion (+${num(b.amount)})` : b.kind === 'training' ? 'Training ground upgrade' : 'Academy upgrade'} · ready in ${b.readyDay - s.calendar.day} day${b.readyDay - s.calendar.day === 1 ? '' : 's'}</div>`).join('') : ''}
      <table><tbody>${opts.map(o => `<tr><td><b>${o.label}</b><div class="muted" style="font-size:13px">${o.days} days to build</div></td><td class="n">${money(o.cost)}</td><td class="n">${o.maxed ? '<span class="chip">Max</span>' : o.busy ? '<span class="chip warn">Building</span>' : `<button class="btn small" data-act="build" data-k="${o.key}" ${c.cash < o.cost ? 'disabled' : ''}>Start</button>`}</td></tr>`).join('')}</tbody></table>
    </section>
    ${s.history.length ? `<section class="card"><div class="card-h"><h3>History</h3></div><table><tbody>${s.history.map(h => `<tr><td>${h.year}/${String(h.year + 1).slice(2)}</td><td>${esc(Pk.dname(s.divisions.find(d => d.id === h.div)))}</td><td class="n"><b>${G.ordinal(h.pos)}</b></td><td>Champions: ${cn(CL(h.champion))}</td></tr>`).join('')}</tbody></table></section>` : ''}`;
  },

  inbox() {
    const s = S();
    return `<div class="page-h"><div><div class="kicker">${s.inbox.filter(m => !m.read).length} unread</div><h2>Inbox</h2></div><button class="btn" data-act="readall">Mark all read</button></div>
    <section class="card">${s.inbox.map(m => `<div class="mail ${m.read ? '' : 'unread'}" data-act="openmail" data-id="${m.id}"><div class="row"><span class="t">${esc(m.title)}</span><span class="sp"></span><span class="label">Day ${m.day}</span></div>${app.ui.mailOpen === m.id ? `<div class="b">${esc(m.body)}</div>${m.playerId && P(m.playerId) ? `<div class="row" style="margin-top:8px"><button class="btn small" data-act="prow" data-id="${m.playerId}">View player</button>${m.kind === 'offer' ? '<a class="btn small" href="#transfers" data-act="tab" data-g="tr" data-v="offers">Go to offers</a>' : ''}</div>` : ''}` : ''}</div>`).join('') || '<p class="muted">No messages.</p>'}</section>`;
  },

  names() {
    const s = S(); const tab = app.ui.tab.ed || 'clubs'; const pk = Pk.getPack();
    const tabs = [['clubs', 'Clubs'], ['players', 'Players'], ['leagues', 'Leagues'], ['share', 'Share & import']];
    let body = '';
    if (tab === 'clubs') {
      const all = s.divisions.flatMap(d => d.clubIds).map(CL);
      body = `<div class="tbl-wrap"><table><thead><tr><th></th><th>Club name</th><th>Short</th><th>Stadium</th><th>Colours</th><th>Pattern</th><th>Crest</th></tr></thead><tbody>
      ${all.map(c => { const col = Pk.ccolors(c), cr = Pk.ccrest(c); return `<tr><td>${crest(cv(c), 28)}</td>
        <td><input type="text" value="${esc(Pk.cname(c))}" maxlength="40" data-chg="eclub" data-id="${c.id}" data-f="name" aria-label="Club name"></td>
        <td><input type="text" value="${esc(Pk.cshort(c))}" maxlength="4" size="4" data-chg="eclub" data-id="${c.id}" data-f="short" aria-label="Short name"></td>
        <td><input type="text" value="${esc(Pk.cstadium(c))}" maxlength="40" data-chg="eclub" data-id="${c.id}" data-f="stadium" aria-label="Stadium"></td>
        <td><input type="color" value="${col.primary}" data-chg="eclub" data-id="${c.id}" data-f="primary" aria-label="Primary colour"> <input type="color" value="${col.secondary}" data-chg="eclub" data-id="${c.id}" data-f="secondary" aria-label="Secondary colour"></td>
        <td><select data-chg="eclub" data-id="${c.id}" data-f="pattern">${['plain', 'stripes', 'hoops', 'halves', 'sash', 'sleeves', 'pinstripe'].map(x => `<option ${col.pattern === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
        <td><select data-chg="eclub" data-id="${c.id}" data-f="shape">${['shield', 'round', 'diamond', 'pointed', 'square'].map(x => `<option ${cr.shape === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td></tr>`; }).join('')}
      </tbody></table></div>`;
    } else if (tab === 'players') {
      const cid = app.ui.edClub || me().id;
      const all = s.divisions.flatMap(d => d.clubIds).map(CL);
      const list = CL(cid).playerIds.map(P).sort((a, b) => 'GKDFMFFW'.indexOf(a.pos) - 'GKDFMFFW'.indexOf(b.pos) || a.number - b.number);
      body = `<div class="row" style="margin-bottom:12px"><label class="label" for="edc">Club</label><select id="edc" data-chg="edclub">${all.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${cn(c)}</option>`).join('')}</select></div>
      <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Pos</th><th>First name</th><th>Last name</th><th class="n">Skill</th></tr></thead><tbody>
      ${list.map(p => `<tr><td class="n">${p.number}</td><td>${posTag(p.pos)}</td><td><input type="text" value="${esc(Pk.pfirst(p))}" maxlength="24" data-chg="eplayer" data-id="${p.id}" data-f="first" aria-label="First name"></td><td><input type="text" value="${esc(Pk.plast(p))}" maxlength="30" data-chg="eplayer" data-id="${p.id}" data-f="last" aria-label="Last name"></td><td class="n">${p.skill}</td></tr>`).join('')}
      </tbody></table></div>`;
    } else if (tab === 'leagues') {
      body = s.divisions.map(d => `<div class="row" style="margin-bottom:10px"><label class="label" style="min-width:90px" for="dv-${d.id}">${d.id === 'd1' ? 'Top tier' : 'Second tier'}</label><input id="dv-${d.id}" type="text" value="${esc(Pk.dname(d))}" maxlength="40" data-chg="ediv" data-id="${d.id}"></div>`).join('');
    } else {
      const counts = `${Object.keys(pk.clubs).length} clubs, ${Object.keys(pk.players).length} players`;
      body = `<div class="grid2">
        <div style="display:grid;gap:10px;align-content:start"><h3>Export your pack</h3>
          <div class="row"><input type="text" id="pk-title" value="${esc(pk.title)}" placeholder="Pack title" data-chg="pkmeta" data-f="title" maxlength="60"><input type="text" id="pk-author" value="${esc(pk.author)}" placeholder="Your name (optional)" data-chg="pkmeta" data-f="author" maxlength="40"></div>
          <p class="muted" style="margin:0;font-size:14px">Your pack holds edits for ${counts}. Share the file or the text with friends.</p>
          <textarea id="pk-out" readonly>${esc(Pk.exportPack())}</textarea>
          <div class="row"><button class="btn" data-act="pkcopy">Copy text</button><button class="btn" data-act="pkdownload">Download file</button><button class="btn danger" data-act="pkreset">Reset to defaults</button></div>
        </div>
        <div style="display:grid;gap:10px;align-content:start"><h3>Import a pack</h3>
          <p class="muted" style="margin:0;font-size:14px">Paste a pack, or choose a .json file. Importing replaces your current pack in this browser only.</p>
          <textarea id="pk-in" placeholder='{"format":"bolzplatz-manager-pro-namepack", ...}'></textarea>
          <input type="file" id="pk-file" accept=".json,application/json" data-chg="pkfile">
          <label class="row" style="align-items:flex-start;gap:8px;font-size:14px"><input type="checkbox" id="pk-ok"> <span>I confirm this pack contains no trademarks, real people's names or likenesses I have no right to use, and nothing harmful, hateful or illegal. I use it at my own responsibility.</span></label>
          <button class="btn primary" data-act="pkimport">Import pack</button>
        </div></div>`;
    }
    return `<div class="page-h"><div><div class="kicker">Local name pack · ${esc(pk.title)}</div><h2>Names & kits</h2></div></div>
    <div class="notice"><b>Your edits stay on this device.</b> Name packs change what you see in your own browser. They are never uploaded or shown to other players. Do not use trademarks, club crests, or real people's names without permission, or anything harmful, hateful or illegal. You are responsible for the packs you create, import and share. <a href="#legal">Read the full terms</a>.</div>
    <section class="card"><div class="tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-g="ed" data-v="${k}">${l}</button>`).join('')}</div>${body}</section>`;
  },

  options() {
    const s = S();
    return `<div class="page-h"><div><div class="kicker">${esc(GAME_TITLE)}</div><h2>Options</h2></div></div>
    <div class="grid2">
      <section class="card" style="display:grid;gap:12px;align-content:start"><h3>Match viewing</h3>
        <div><div class="label">Highlight speed</div><div class="seg">${[[1, '1×'], [2, '2×']].map(([v, l]) => `<button class="${(app.prefs.speed === 2 ? 2 : 1) === v ? 'on' : ''}" data-act="pref" data-k="speed" data-v="${v}">${l}</button>`).join('')}</div></div>
        <div><div class="label">Camera</div><div class="seg">${[['broadcast', 'Broadcast'], ['tactical', 'Tactical']].map(([v, l]) => `<button class="${app.prefs.camera === v ? 'on' : ''}" data-act="pref" data-k="camera" data-v="${v}">${l}</button>`).join('')}</div></div>
        <div><div class="label">Commentary voice</div><div class="seg">${[[true, 'On'], [false, 'Off']].map(([v, l]) => `<button class="${app.prefs.voice !== false === v ? 'on' : ''}" data-act="pref" data-k="voice" data-v="${v}">${l}</button>`).join('')}</div>${app.voice.ok && app.voice.voices().length ? `<select data-chg="voicepick" style="margin-top:6px;max-width:260px">${app.voice.voices().map(v => `<option ${app.voice.voice === v ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : '<div class="muted" style="font-size:13px">This browser has no speech voices.</div>'}</div>
        <div><div class="label">Stadium sound</div><div class="seg">${[[true, 'On'], [false, 'Off']].map(([v, l]) => `<button class="${app.prefs.sound === v ? 'on' : ''}" data-act="pref" data-k="sound" data-v="${v}">${l}</button>`).join('')}</div></div>
      </section>
      <section class="card" style="display:grid;gap:12px;align-content:start"><h3>Your save</h3>
        <p class="muted" style="margin:0;font-size:14px">Your career is saved in this browser automatically. Export it to move it to another device or keep a backup.</p>
        <div class="row"><button class="btn" data-act="saveexport">Copy save to clipboard</button><button class="btn" data-act="savedownload">Download save</button></div>
        <textarea id="save-in" placeholder="Paste a save here to load it"></textarea>
        <div class="row"><button class="btn" data-act="saveimport">Load pasted save</button></div>
        <div class="row" style="margin-top:8px">${app.ui.confirmNew ? `<span>Start over? Your current career will be deleted.</span><button class="btn danger" data-act="newgame">Yes, start a new career</button><button class="btn" data-act="cancelnew">Keep playing</button>` : `<button class="btn danger" data-act="asknew">Start a new career</button>`}</div>
      </section>
    </div>
    ${DEV_TOOLS ? `<section class="card"><div class="card-h"><h3>Testing tools</h3><span class="chip warn">Turn off before launch</span></div><p class="muted" style="font-size:14px;margin-top:0">Moves the game clock forward one day so you can try the daily loop without waiting. Clock offset: ${s.calendar.devOffset || 0} day(s).</p><button class="btn" data-act="devday">Skip to tomorrow</button></section>` : ''}
    <p class="legal"><a href="#legal">Terms & disclaimer</a> · Save version ${s.version}</p>`;
  },

  legal() {
    return `<div class="page-h"><div><div class="kicker">Please read</div><h2>Terms & disclaimer</h2></div></div>
    <section class="card" style="max-width:72ch;display:grid;gap:12px">
      <p><b>A work of fiction.</b> All clubs, leagues, stadiums and players in ${esc(GAME_TITLE)} are invented. Any resemblance to real clubs or people is coincidental.</p>
      <p><b>Name packs are private and local.</b> You can rename clubs, leagues and players and share those edits as name packs. Packs only change what you see in your own browser. They are never uploaded to our servers or shown to other players, including in any future multiplayer mode.</p>
      <p><b>What you may not put in a pack.</b> Do not use trademarks, protected logos, club crests, or the names or likenesses of real people unless you have the right to do so. Do not create or share anything harmful, hateful, defamatory, sexual, or otherwise illegal.</p>
      <p><b>Your responsibility.</b> You are solely responsible for the packs you create, import and share, and for complying with the laws that apply to you. We do not review, host or distribute packs.</p>
      <p><b>Credits.</b> Player movement in match highlights is based on public sample tracking data by Metrica Sports (github.com/metrica-sports/sample-data). No real names, teams or footage are used.</p>
      <p><b>Advertising.</b> This game is funded by ads. Ad partners may use cookies where you have agreed to it.</p>
      <p class="muted" style="font-size:13px">This text is a draft placeholder and must be reviewed by a lawyer before public launch.</p>
    </section>`;
  },
};

function greeting() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; }
function formChips(tbl, id) { const r = tbl.find(x => x.id === id); return r && r.form.length ? r.form.map(x => `<span class="form-${x}">${x}</span>`).join('') : `${G.ordinal(r?.pos || 1)} place`; }
function sparkline(vals) {
  if (vals.length < 2) return '<p class="muted" style="font-size:13px">Your cash history appears after a few matchdays.</p>';
  const w = 300, h = 70, mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const pts = vals.map((v, i) => [i / (vals.length - 1) * w, h - 6 - (v - mn) / rg * (h - 12)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Cash over the last ${vals.length} matchdays"><path d="${d} L${w} ${h} L0 ${h} Z" fill="rgba(255,182,39,.12)"/><path d="${d}" fill="none" stroke="var(--amber)" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--amber)"/></svg>`;
}

// ---------- player modal ----------
function playerModal(id) {
  const s = S(), p = P(id), c = me(); if (!p) return;
  const own = p.clubId === c.id;
  const cl = p.clubId ? CL(p.clubId) : null;
  const known = own || p.scouted;
  const scouting = s.scouting.some(x => x.playerId === p.id);
  const bid = s.bids.find(b => b.playerId === p.id);
  const avg = p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(1) : '–';
  const attrs = ['pace', 'shooting', 'passing', 'defending', 'keeping', 'stamina'];
  const suggest = Math.round(p.value * 1.15 / 10000) * 10000;
  let actions = '';
  if (own) actions = `<button class="btn" data-act="list" data-id="${p.id}">${p.listed ? 'Remove from transfer list' : 'List for transfer'}</button><button class="btn" data-act="renew" data-id="${p.id}">Offer new contract (~${money(G.wageDemand(p) * 1.08)}/wk)</button><button class="btn danger" data-act="release" data-id="${p.id}">Release (pay ${money(p.wage * Math.max(1, p.contract) * 8)})</button>`;
  else if (!p.clubId) actions = `<button class="btn primary" data-act="sign" data-id="${p.id}">Sign now (${money(p.wage)}/wk${p.youthOf ? '' : ' + bonus ' + money(G.wageDemand(p) * 4)})</button>${!known && !scouting ? `<button class="btn" data-act="scout" data-id="${p.id}">Send scout</button>` : ''}`;
  else actions = `<div class="row" style="width:100%"><label class="label" for="bidfee">Your bid (€)</label><input id="bidfee" type="number" step="10000" min="0" value="${bid ? bid.fee : suggest}" style="width:150px"><button class="btn primary" data-act="bid" data-id="${p.id}">${bid ? 'Update bid' : 'Place bid'}</button>${!known && !scouting ? `<button class="btn" data-act="scout" data-id="${p.id}">Send scout</button>` : ''}${scouting ? '<span class="chip warn">Scout report tomorrow</span>' : ''}</div><p class="muted" style="margin:0;font-size:13px">Market value ${money(p.value)}. Clubs want more for key players and less for listed ones. The answer comes overnight.</p>`;
  openModal(`
    <div class="row">${cl ? crest(cv(cl), 44) : ''}<div><div class="kicker">${POS_LABEL[p.pos]} · ${p.nat} · age ${p.age}</div><h2 style="font-size:30px">${pn(p)}</h2><div class="muted">${cl ? cn(cl) : (p.youthOf ? 'Your academy prospect' : 'Free agent')}${p.number && cl ? ' · #' + p.number : ''}</div></div><span class="sp"></span><button class="btn ghost" data-act="close" aria-label="Close">✕</button></div>
    <div class="grid3"><div><div class="label">Skill</div><div class="big-money ${skillClass(p.skill)}">${p.skill}</div></div><div><div class="label">Potential</div><div class="big-money">${known ? p.potential : '?'}</div></div><div><div class="label">Value</div><div class="big-money" style="font-size:30px">${money(p.value)}</div></div></div>
    <div style="display:grid;gap:6px">${attrs.map(a => `<div class="attr"><span class="label">${a}</span>${bar(p.attrs[a], 100, p.attrs[a] < 50 ? 'red' : p.attrs[a] < 70 ? 'amber' : '')}<b class="num">${p.attrs[a]}</b></div>`).join('')}</div>
    <dl class="kv"><dt>Wage</dt><dd>${money(p.wage)} / week</dd><dt>Contract</dt><dd>${p.contract} year${p.contract === 1 ? '' : 's'}</dd><dt>Form · fitness · morale</dt><dd>${p.form.toFixed(1)} · ${Math.round(p.fitness)}% · ${Math.round(p.morale)}%</dd><dt>This season</dt><dd>${p.stats.apps} apps · ${p.stats.goals} goals · ${p.stats.assists} assists · avg ${avg}</dd></dl>
    <div class="row">${actions}</div>`);
}
function openModal(html) {
  closeModal();
  const d = document.createElement('div'); d.className = 'modal-back'; d.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  d.addEventListener('click', e => { if (e.target === d) closeModal(); });
  document.body.appendChild(d);
}
function closeModal() { $$('.modal-back').forEach(x => x.remove()); }

// ---------- actions ----------
function run(cmd, okMsg) {
  const r = G.dispatch(S(), cmd);
  if (!r.ok) { toast(r.msg, 'bad'); return r; }
  if (r.msg || okMsg) toast(r.msg || okMsg, 'ok');
  save(); return r;
}
const ACTIONS = {
  close: closeModal,
  tab(d) { app.ui.tab[d.g] = d.v; render(); },
  prow(d) {
    const sel = app.ui.sel;
    if (sel && app.view === 'squad' && P(d.id)?.clubId === me().id) {
      const c = me();
      if (sel.startsWith('slot')) { const i = +sel.slice(4); const cur = c.lineup[i]; if (cur && cur !== d.id) run({ type: 'SWAP', a: cur, b: d.id }); else if (!cur) { c.lineup[i] = d.id; save(); } }
      else if (sel !== d.id) run({ type: 'SWAP', a: sel, b: d.id });
      app.ui.sel = null; render(); return;
    }
    closeModal(); playerModal(d.id);
  },
  slot(d) {
    const c = me(); const key = 'slot' + d.i; const sel = app.ui.sel;
    if (sel && sel !== key) {
      const a = sel.startsWith('slot') ? c.lineup[+sel.slice(4)] : sel, b = c.lineup[+d.i];
      if (a && b) run({ type: 'SWAP', a, b });
      app.ui.sel = null;
    } else app.ui.sel = sel === key ? null : key;
    render();
  },
  autopick() { run({ type: 'AUTO_LINEUP' }, 'Best available XI picked.'); render(); },
  formation(d) { run({ type: 'SET_FORMATION', formation: d.f }); render(); },
  mentality(d) { run({ type: 'SET_MENTALITY', mentality: d.m }); render(); },
  focus(d) { app.ui.focus = d.k; render(); },
  indiv(d) { const a = app.ui.indiv; const i = a.indexOf(d.id); if (i >= 0) a.splice(i, 1); else if (a.length < 3) a.push(d.id); else toast('You can coach up to 3 players individually.', 'bad'); render(); },
  train() { const r = run({ type: 'TRAIN', focus: app.ui.focus, individual: app.ui.indiv }); if (r.ok) { app.ui.indiv = []; toast(`Session done. ${r.report.length} player${r.report.length === 1 ? '' : 's'} improved.`, 'ok'); render(); } },
  fpos(d) { app.ui.filter.pos = d.v; render(); },
  div(d) { app.ui.divView = d.v; app.ui.mdView = null; render(); },
  md(d) { app.ui.mdView = Math.max(0, +d.v); render(); },
  bid(d) { const fee = +($('#bidfee')?.value || 0); if (!(fee > 0)) return toast('Enter a fee.', 'bad'); const r = run({ type: 'BID', playerId: d.id, fee }); if (r.ok) { closeModal(); render(); } },
  sign(d) { const r = run({ type: 'BID', playerId: d.id, fee: 0 }); if (r.ok) { closeModal(); render(); } },
  scout(d) { const r = run({ type: 'SCOUT', playerId: d.id }); if (r.ok) { closeModal(); render(); } },
  cancelbid(d) { run({ type: 'CANCEL_BID', playerId: d.id }); render(); },
  accept(d) { run({ type: 'ACCEPT_OFFER', offerId: d.id }); render(); },
  reject(d) { run({ type: 'REJECT_OFFER', offerId: d.id }, 'Offer rejected.'); render(); },
  list(d) { run({ type: 'LIST', playerId: d.id }); closeModal(); render(); },
  renew(d) { run({ type: 'RENEW', playerId: d.id }); closeModal(); render(); },
  release(d) { const r = run({ type: 'RELEASE', playerId: d.id }); if (r.ok) { closeModal(); render(); } },
  build(d) { run({ type: 'BUILD', key: d.k }); render(); },
  openmail(d) { const m = S().inbox.find(x => x.id === d.id); if (m) { m.read = true; save(); } if (app.view !== 'inbox') { app.ui.mailOpen = d.id; go('inbox'); return; } app.ui.mailOpen = app.ui.mailOpen === d.id ? null : d.id; render(); },
  readall() { S().inbox.forEach(m => m.read = true); save(); render(); },
  pref(d) { let v = d.v; if (v === 'true') v = true; else if (v === 'false') v = false; else if (/^\d+$/.test(v)) v = +v; app.prefs[d.k] = v; savePrefs(); render(); },
  pkcopy() { copyText($('#pk-out').value); },
  pkdownload() { download('bolzplatz-manager-pro-namepack.json', Pk.exportPack()); },
  pkreset() { if (app.ui.confirmReset) { Pk.resetPack(); app.ui.confirmReset = false; toast('Name pack reset to the default names.', 'ok'); render(); } else { app.ui.confirmReset = true; toast('Press "Reset to defaults" again to confirm.', 'bad'); } },
  pkimport() {
    if (!$('#pk-ok').checked) return toast('Please confirm the pack follows the rules before importing.', 'bad');
    try { const { pack, count } = Pk.sanitizePack(JSON.parse($('#pk-in').value)); Pk.setPack(pack); toast(`Imported "${pack.title}" with ${count} edits.`, 'ok'); render(); }
    catch (e) { toast(e instanceof SyntaxError ? 'That text is not valid JSON. Check you copied the whole pack.' : e.message, 'bad'); }
  },
  saveexport() { copyText(JSON.stringify(S())); },
  savedownload() { download(`bolzplatz-manager-pro-save-day${S().calendar.day}.json`, JSON.stringify(S())); },
  saveimport() {
    try { const s = JSON.parse($('#save-in').value); if (s.version !== SAVE_VERSION || !s.humans) throw new Error(); app.state = s; sync(); save(); toast('Save loaded.', 'ok'); go('today'); }
    catch (e) { toast('That is not a valid save.', 'bad'); }
  },
  asknew() { app.ui.confirmNew = true; render(); },
  cancelnew() { app.ui.confirmNew = false; render(); },
  newgame() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} app.state = null; app.ui.confirmNew = false; location.hash = ''; render(); },
  devday() { G.devSkipDay(S()); const d = sync(); save(); render(); briefing(d); },
  preview() { matchPreview(); },
  quick() { quickResult(); },
};
function copyText(t) {
  try { navigator.clipboard.writeText(t).then(() => toast('Copied to clipboard.', 'ok'), () => toast('Copy failed. Select the text and copy it yourself.', 'bad')); }
  catch (e) { toast('Copy failed. Select the text and copy it yourself.', 'bad'); }
}
function download(name, text) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Download started. If nothing happens, use Copy instead.'); }
  catch (e) { toast('Downloads are blocked here. Use Copy instead.', 'bad'); }
}
const CHANGES = {
  voicepick(el) { app.prefs.voiceName = el.value; savePrefs(); app.voice.pickVoice(el.value); const was = app.voice.enabled; app.voice.enabled = true; app.voice.speak([['And it\'s a goal!', 'peak'], ['What a finish, right into the top corner!', 'excited']], 4); app.voice.enabled = was; },
  fmax(el) { app.ui.filter.max = +el.value; render(); },
  fsort(el) { app.ui.filter.sort = el.value; render(); },
  fq(el) { app.ui.filter.q = el.value; render(); },
  ticket(el) { run({ type: 'TICKET_PRICE', price: +el.value }); render(); },
  eclub(el) { Pk.editClub(el.dataset.id, el.dataset.f, el.value.trim()); render(); },
  eplayer(el) { Pk.editPlayer(el.dataset.id, el.dataset.f, el.value.trim()); },
  ediv(el) { Pk.editDivision(el.dataset.id, el.value.trim()); render(); },
  edclub(el) { app.ui.edClub = el.value; render(); },
  pkmeta(el) { const p = Pk.getPack(); p[el.dataset.f] = el.value.trim().slice(0, 60); Pk.savePack(); render(); },
  pkfile(el) { const f = el.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $('#pk-in').value = r.result; toast('File loaded. Tick the box and press Import.'); }; r.readAsText(f); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = ACTIONS[el.dataset.act]; if (!a) return;
  if (el.tagName === 'A' && el.dataset.act !== 'tab') e.preventDefault();
  if (!app.audio.ctx && app.prefs.sound) app.audio.enable();
  a(el.dataset, el);
});
document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el && CHANGES[el.dataset.chg]) CHANGES[el.dataset.chg](el); });
document.addEventListener('input', e => { const el = e.target; if (el.id === 'tp') { const l = el.previousElementSibling?.querySelector('b'); if (l) l.textContent = '€' + el.value; } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- day sync & briefing ----------
function sync() { const d = G.syncClock(S()); save(); return d; }
function briefing(d) {
  if (!d || (!d.days && !d.streakBonus)) return;
  const s = S(), c = me();
  const auto = d.autoPlayed.map(a => `<tr><td>${cn(CL(a.home))}</td><td class="n"><b>${a.score[0]}–${a.score[1]}</b></td><td>${cn(CL(a.away))}</td></tr>`).join('');
  const unread = s.inbox.filter(m => !m.read).length;
  const offers = s.offers.filter(o => o.status === 'open').length;
  openModal(`<div class="row"><div><div class="kicker">Day ${s.calendar.day} · ${seasonLabel()}</div><h2>Morning briefing</h2></div><span class="sp"></span><button class="btn ghost" data-act="close" aria-label="Close">✕</button></div>
    ${d.streakBonus ? `<div class="notice">🔥 <b>${s.calendar.streak}-day streak.</b> Your sponsor paid a loyalty bonus of <b>${money(d.streakBonus)}</b>.</div>` : ''}
    ${d.autoPlayed.length ? `<div><div class="label">While you were away, your assistant played ${d.autoPlayed.length} match${d.autoPlayed.length > 1 ? 'es' : ''}</div><table><tbody>${auto}</tbody></table></div>` : ''}
    <dl class="kv"><dt>Unread messages</dt><dd>${unread}</dd><dt>Transfer offers waiting</dt><dd>${offers}</dd><dt>Cash</dt><dd>${money(c.cash)}</dd></dl>
    <div class="row"><button class="btn primary" data-act="close">Go to the office</button>${unread ? '<a class="btn" href="#inbox" data-act="close">Read messages</a>' : ''}</div>`);
}

// ---------- match flow ----------
function decoratedSheet(sheet) {
  const c = CL(sheet.clubId);
  const dec = p => { const pl = P(p.id); return pl ? { ...p, name: Pk.pshort(pl), last: Pk.plast(pl) } : p; };
  return { ...sheet, name: Pk.cname(c), short: Pk.cshort(c), colors: Pk.ccolors(c), xi: sheet.xi.map(dec), bench: (sheet.bench || []).map(dec) };
}
function matchPreview() {
  const s = S(), c = me();
  if (s.today.played) return toast('Today’s match is already played. The next one unlocks at midnight.');
  const fx = G.fixtureFor(s, c.id);
  const H = CL(fx.h), A = CL(fx.a);
  const pending = s.today.pending;
  const xi = cl => { const sh = pending ? (cl.id === pending.user.home ? pending.user.result.sheets[0] : pending.user.result.sheets[1]) : makeSheet(s, cl); return sh.xi.map(p => `<div class="row" style="gap:6px">${posTag(p.role)}<span>${esc(Pk.pshort(P(p.id)) || p.name)}</span><span class="sp"></span><span class="skill ${skillClass(p.skill)}">${p.skill}</span></div>`).join(''); };
  if (!pending) { G.repairLineup?.(s, c); }
  openModal(`<div class="row"><div><div class="kicker">Matchday ${s.md + 1} · ${esc(Pk.cstadium(H))}</div><h2>Match preview</h2></div><span class="sp"></span><button class="btn ghost" data-act="close" aria-label="Close">✕</button></div>
    <div class="versus"><div class="side">${crest(cv(H), 52)}<div class="nm" style="font-size:22px">${cn(H)}</div></div><div class="vs">VS</div><div class="side r">${crest(cv(A), 52)}<div class="nm" style="font-size:22px">${cn(A)}</div></div></div>
    <div class="grid2"><div style="display:grid;gap:4px"><div class="label">${H.formation}</div>${xi(H)}</div><div style="display:grid;gap:4px"><div class="label">${A.formation}</div>${xi(A)}</div></div>
    ${pending ? '<div class="notice">This match is already under way. You can watch it again from the start.</div>' : ''}
    <div class="row"><button class="btn primary" data-act="watch">▶ Watch live</button><button class="btn" data-act="quick">Quick result</button>${!pending ? '<a class="btn ghost" href="#squad" data-act="close">Change team first</a>' : ''}</div>`);
}
ACTIONS.watch = () => { closeModal(); watchMatch(); };

function quickResult() {
  closeModal();
  const s = S();
  if (s.today.played) return;
  G.prepareMatchday(s);
  finishMatchday(false);
}

function finishMatchday(watched) {
  const s = S();
  const u = s.today.pending?.user;
  if (watched) G.dispatch(s, { type: 'WATCHED' });
  G.commitMatchday(s);
  save();
  render();
  showResults(u);
}

function showResults(u) {
  const s = S(), c = me();
  if (!u) return;
  const r = u.result, H = CL(u.home), A = CL(u.away);
  const myIdx = u.userSide;
  const myIds = r.sheets[myIdx].xi.map(p => p.id).concat(Object.keys(r.ps).filter(id => r.ps[id].subOn !== undefined && P(id)?.clubId === c.id));
  const others = s.divisions.flatMap(d => (s.fixtures[d.id][s.md - 1] || []).filter(f => f !== s.fixtures[u.div][s.md - 1][u.idx]).map(f => ({ f, d })));
  const goals = r.events.filter(e => e.kind === 'goal');
  const objs = s.today.objectives;
  openModal(`<div class="row"><div><div class="kicker">Full time · matchday ${s.md}</div><h2>${r.score[myIdx] > r.score[1 - myIdx] ? 'Victory!' : r.score[myIdx] < r.score[1 - myIdx] ? 'Defeat' : 'A draw'}</h2></div><span class="sp"></span><button class="btn ghost" data-act="close" aria-label="Close">✕</button></div>
    <div class="versus"><div class="side">${crest(cv(H), 48)}<div class="nm" style="font-size:20px">${cn(H)}</div></div><div class="vs"><div class="score" style="font-size:46px">${r.score[0]}–${r.score[1]}</div></div><div class="side r">${crest(cv(A), 48)}<div class="nm" style="font-size:20px">${cn(A)}</div></div></div>
    ${goals.length ? `<div style="font-size:14px">${goals.map(g => `⚽ ${Math.round(g.t)}' ${esc(Pk.pshort(P(g.pid)) || '')} <span class="muted">(${g.team === 0 ? cs(H) : cs(A)}${g.penalty ? ', pen' : ''})</span>`).join(' · ')}</div>` : ''}
    <div class="grid2">
      <div><div class="label">Your player ratings</div><table><tbody>${myIds.filter(id => P(id)).map(id => `<tr><td>${esc(Pk.pshort(P(id)))}${id === r.motm ? ' <span class="chip ok">Man of the match</span>' : ''}</td><td class="n"><b>${(r.ratings[id] ?? 6).toFixed(1)}</b></td></tr>`).join('')}</tbody></table></div>
      <div><div class="label">Other results</div><table><tbody>${others.slice(0, 12).map(({ f }) => `<tr><td>${cs(CL(f.h))}</td><td class="n"><b>${f.r.s[0]}–${f.r.s[1]}</b></td><td>${cs(CL(f.a))}</td></tr>`).join('')}</tbody></table>
        <div class="label" style="margin-top:12px">Objectives</div>${objs.map(o => `<div class="obj ${o.done ? 'done' : ''}"><span class="tick"></span><span class="t">${esc(o.label)}</span><span class="reward">+${money(o.reward)}</span></div>`).join('')}</div>
    </div>
    ${adSlot('fulltime')}
    <div class="row"><button class="btn primary" data-act="close">Back to the office</button><a class="btn" href="#league" data-act="close">League table</a></div>`);
  mountAds(document.querySelector('.modal'));
}

function watchMatch() {
  const s = S(), c = me();
  const pend = G.prepareMatchday(s); save();
  const u = pend.user; if (!u) return;
  const side = u.userSide;
  const home = decoratedSheet(u.result.sheets[0]), away = decoratedSheet(u.result.sheets[1]);
  const H = CL(u.home);
  const el = document.createElement('div'); el.className = 'match';
  const kitCol = k => Pk.ccolors(CL(k === 0 ? u.home : u.away)).primary;
  el.innerHTML = `
    <div class="pitch-wrap"><canvas aria-label="Animated match between ${esc(home.name)} and ${esc(away.name)}"></canvas>
      <div class="sb"><div class="tm"><i style="background:${kitCol(0)}"></i>${esc(home.short)}</div><div class="sc" id="m-sc">0–0</div><div class="tm">${esc(away.short)}<i style="background:${kitCol(1)}"></i></div><div class="clk" id="m-clk">0'</div></div>
      <div id="m-pop"></div>
      <div class="ctrl">
        <div class="seg" id="m-speed">${[[1, '1×'], [2, '2×']].map(([v, l]) => `<button data-sp="${v}" class="${(app.prefs.speed === 2 ? 2 : 1) === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="seg" id="m-cam">${[['broadcast', 'TV'], ['tactical', 'Tactical']].map(([v, l]) => `<button data-cam="${v}" class="${app.prefs.camera === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="btn small" id="m-snd" title="Stadium sound">${app.prefs.sound ? '🔊' : '🔇'}</button>
        ${app.voice.ok ? `<button class="btn small" id="m-voice" title="Commentary voice">${app.prefs.voice !== false ? '🎙️' : '🎙️✕'}</button>` : ''}
        <button class="btn small" id="m-skip">Skip to full time</button>
      </div>
    </div>
    <aside class="feed"><div class="feed-h"><div class="label">${esc(Pk.cstadium(H))}</div><b>${esc(home.name)} v ${esc(away.name)}</b></div>
      <div class="mstats" id="m-stats"></div><div class="lines" id="m-lines"></div></aside>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  if (app.prefs.sound) app.audio.enable();
  const vo = app.voice; vo.speed = app.prefs.speed === 2 ? 2 : 1;
  vo.setEnabled(app.prefs.voice !== false);
  vo.onSpeaking = on => app.audio.duck?.(on);
  const lines = $('#m-lines', el), pop = $('#m-pop', el);
  const addLine = (txt, kind, clock) => { const d = document.createElement('div'); d.className = 'ln ' + (kind || ''); d.innerHTML = `<span class="m">${esc(clock || '')}</span><span>${esc(txt)}</span>`; lines.prepend(d); };
  const showStats = st => {
    const row = (l, a, b, pct) => `<div class="ms"><span>${a}</span><span class="lbl">${l}</span><span class="r">${b}</span>${pct ? `<div class="duo"><i style="width:${a}%;background:${kitCol(0)}"></i><i style="flex:1;background:${kitCol(1)}"></i></div>` : ''}</div>`;
    $('#m-stats', el).innerHTML = row('Possession %', st.possession[0], st.possession[1], true) + row('Shots', st.shots[0], st.shots[1]) + row('On target', st.sot[0], st.sot[1]) + row('Corners', st.corners[0], st.corners[1]);
  };
  showStats({ possession: [50, 50], shots: [0, 0], sot: [0, 0], corners: [0, 0] });
  let watchedHalf = false, skipped = false;
  const view = new MatchView($('canvas', el), {
    home, away, result: u.result, speed: app.prefs.speed === 2 ? 2 : 1, camera: app.prefs.camera, audio: app.audio, stadium: Pk.cstadium(H),
    boards: ['BOLZPLATZ MANAGER PRO', 'YOUR AD HERE', Pk.cname(H).toUpperCase(), 'KESSEL COLA', 'NORDWIND ENERGY', 'PIXELBANK'],
    hooks: {
      onClock: l => { $('#m-clk', el).textContent = l; },
      onScore: sc => { $('#m-sc', el).textContent = `${sc[0]}–${sc[1]}`; },
      onCommentary: (t, k, e, clock) => { addLine(t, k, clock); vo.line(k, t); },
      onShot: (e, name) => vo.shot(name, e),
      onAmbient: t => addLine(t, 'amb', $('#m-clk', el).textContent),
      onStats: showStats,
      onClip: (label, e) => { if (['goal', 'save', 'miss'].includes(e.kind) && !e.penalty) vo.attack(e.team === 0 ? home.name : away.name); },
      onGoal: (e, name, team) => {
        const col = Pk.ccolors(CL(team === 0 ? u.home : u.away));
        pop.innerHTML = `<div class="goal-banner" style="--gc:${col.primary};--gt:${col.secondary}"><div class="g">Goal!</div><div class="w">${esc(name)} · ${esc(team === 0 ? home.name : away.name)}</div></div>`;
        setTimeout(() => { pop.innerHTML = ''; }, 3600);
      },
      onReplay: on => { if (on) pop.innerHTML = ''; },
      onCard: (e, name) => { pop.innerHTML = `<div class="card-pop"><i style="background:${e.kind === 'yellow' ? '#ffd400' : '#e01b24'}"></i>${esc(name)}</div>`; setTimeout(() => { pop.innerHTML = ''; }, 2400); },
      onSub: (e, outN, inN) => { pop.innerHTML = `<div class="card-pop" style="font-size:15px"><span style="color:var(--pitch)">▲ ${esc(inN)}</span><span style="color:var(--red)">▼ ${esc(outN)}</span></div>`; setTimeout(() => { pop.innerHTML = ''; }, 2400); },
      onHalfTime: st => { setTimeout(() => vo.stop(), 2500); watchedHalf = true; halftime(el, view, u, side, st); },
      onFullTime: st => { showStats(st); fulltime(el, view, watchedHalf && !skipped); },
    },
  });
  view.start();
  $('#m-voice', el)?.addEventListener('click', e => { app.prefs.voice = app.prefs.voice === false; savePrefs(); vo.setEnabled(app.prefs.voice); e.currentTarget.textContent = app.prefs.voice ? '🎙️' : '🎙️✕'; });
  $('#m-speed', el).addEventListener('click', e => { const b = e.target.closest('[data-sp]'); if (!b) return; const v = +b.dataset.sp; view.setSpeed(v); vo.speed = v; app.prefs.speed = v; savePrefs(); $$('#m-speed button', el).forEach(x => x.classList.toggle('on', x === b)); });
  $('#m-cam', el).addEventListener('click', e => { const b = e.target.closest('[data-cam]'); if (!b) return; view.setCamera(b.dataset.cam); app.prefs.camera = b.dataset.cam; savePrefs(); $$('#m-cam button', el).forEach(x => x.classList.toggle('on', x === b)); });
  $('#m-snd', el).addEventListener('click', e => { app.prefs.sound = !app.prefs.sound; savePrefs(); if (app.prefs.sound) app.audio.enable(); else app.audio.disable(); e.currentTarget.textContent = app.prefs.sound ? '🔊' : '🔇'; });
  $('#m-skip', el).addEventListener('click', () => { vo.stop(); skipped = !watchedHalf; $$('.overlay', el).forEach(x => x.remove()); view.skipToEnd(); });
  app.matchView = view;
}

function halftime(el, view, u, side, st) {
  const s = S();
  const T = u.result.ht.teams[side];
  const ov = document.createElement('div'); ov.className = 'overlay';
  const benchOpts = T.bench.filter(b => !T.used.includes(b.id)).map(b => `<option value="${b.id}">${esc(Pk.pshort(P(b.id)) || b.name)} (${b.pos} ${b.skill})</option>`).join('');
  const onOpts = T.on.map(p => `<option value="${p.id}">${esc(Pk.pshort(P(p.id)) || p.name)} (${p.role}, ${Math.round(p.fit)}% fit)</option>`).join('');
  const subRows = Array.from({ length: T.subsLeft }, (_, i) => `<div class="row"><select class="ht-out" aria-label="Player off"><option value="">Take off…</option>${onOpts}</select><span>⇄</span><select class="ht-in" aria-label="Player on"><option value="">Bring on…</option>${benchOpts}</select></div>`).join('');
  ov.innerHTML = `<div class="ov-card">
    <div class="row"><div><div class="kicker">Half time</div><h2>${esc(view.home.short)} ${view.score[0]}–${view.score[1]} ${esc(view.away.short)}</h2></div></div>
    <div class="grid2">
      <div style="display:grid;gap:12px;align-content:start">
        <div><div class="label">Team talk: mentality</div><div class="seg" id="ht-m">${Object.entries(MENTALITIES).map(([k, m]) => `<button data-m="${k}" class="${T.mentality === k ? 'on' : ''}">${m.label}</button>`).join('')}</div></div>
        <div><div class="label">Formation</div><select id="ht-f">${FORMATION_KEYS.map(f => `<option ${T.formation === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div><div class="label">Substitutions (${T.subsLeft} left)</div><div class="subs-list">${subRows || '<span class="muted">No substitutions left.</span>'}</div></div>
      </div>
      <div style="display:grid;gap:10px;align-content:start">${adSlot('halftime')}</div>
    </div>
    <div class="row"><button class="btn primary" id="ht-go">Start the second half</button><span class="muted" style="font-size:13px">Changes here really change the second half.</span></div></div>`;
  $('.pitch-wrap', el).appendChild(ov);
  mountAds(ov);
  let ment = T.mentality;
  $('#ht-m', ov).addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; ment = b.dataset.m; $$('#ht-m button', ov).forEach(x => x.classList.toggle('on', x === b)); });
  $('#ht-go', ov).addEventListener('click', () => {
    const formation = $('#ht-f', ov).value;
    const subs = []; const outs = $$('.ht-out', ov), ins = $$('.ht-in', ov);
    const usedIn = new Set(), usedOut = new Set();
    outs.forEach((o, i) => { const a = o.value, b = ins[i].value; if (a && b && !usedIn.has(b) && !usedOut.has(a)) { subs.push({ outId: a, inId: b }); usedIn.add(b); usedOut.add(a); } });
    const changes = {};
    if (ment !== T.mentality) changes.mentality = ment;
    if (formation !== T.formation) changes.formation = formation;
    if (subs.length) changes.subs = subs;
    if (Object.keys(changes).length) {
      const r = G.halftimeChange(s, changes); save();
      // the re-simulated result includes the new bench/sub events; give the viewer the new names
      const dec = decoratedSheet({ ...u.result.sheets[side], bench: r.ht.teams[side].bench.map(b => ({ ...b })) });
      view.sheets[side].bench = dec.bench.concat(view.sheets[side].bench || []);
      view.replaceSecondHalf(r);
      if (changes.formation) view.applyFormation(side, changes.formation);
    }
    ov.remove();
    view.resume();
  });
}

function fulltime(el, view, watched) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="ov-card" style="width:min(460px,100%)"><div class="kicker" style="text-align:center">Full time</div><div class="ft-score">${esc(view.home.short)} ${view.score[0]}–${view.score[1]} ${esc(view.away.short)}</div><button class="btn primary" id="ft-go" style="justify-self:center">See ratings & results</button></div>`;
  setTimeout(() => $('.pitch-wrap', el).appendChild(ov), 1200);
  ov.addEventListener('click', e => {
    if (!e.target.closest('#ft-go')) return;
    view.destroy(); el.remove(); document.body.style.overflow = '';
    app.audio.disable(); app.voice.stop();
    finishMatchday(watched);
  });
}

// ---------- title / new game ----------
function renderTitle(root) {
  const world = app.titleWorld || (app.titleWorld = createWorld((Math.random() * 1e9) | 0));
  const sel = app.ui.pickClub;
  root.innerHTML = `<div class="title"><canvas id="demo"></canvas><div class="title-in">
    <div class="kicker">One matchday a day · build a dynasty</div>
    <h1>Bolzplatz <b>Manager Pro</b></h1>
    <p class="tag">Run a football club in 15 minutes a day. Train the squad, trade players overnight, and watch every match come alive.</p>
    <div class="card" style="display:grid;gap:14px;background:rgba(18,26,35,.92)">
      <div class="row"><label class="label" for="mgr">Your name</label><input id="mgr" type="text" maxlength="24" value="${esc(app.ui.mgr || '')}" placeholder="Manager"><span class="sp"></span><span class="label">Pick your club. Fewer stars means a harder job.</span></div>
      ${world.divisions.map(d => `<div><div class="label" style="margin-bottom:6px">${esc(Pk.dname(d))}</div><div class="club-pick">${d.clubIds.map(id => { const c = world.clubs[id]; return `<button class="cp ${sel === id ? 'on' : ''}" data-act="pickclub" data-id="${id}">${crest(Pk.cview(c), 36)}<span><span class="nm">${esc(Pk.cname(c))}</span><br><span class="stars">${stars(c.rep)}</span> <span class="label">${money(c.cash)}</span></span></button>`; }).join('')}</div></div>`).join('')}
      <div class="row"><button class="btn primary" data-act="start" ${sel ? '' : 'disabled'}>Start career</button><span class="sp"></span><button class="btn ghost" data-act="titleload">Load a save</button></div>
      <div id="title-load" hidden><textarea id="save-in" placeholder="Paste a save here"></textarea><button class="btn" data-act="saveimport">Load save</button></div>
    </div>
    <p class="legal">All clubs and players are fictional. You can rename everything in the game. <a href="#legal" data-act="titlelegal">Terms & disclaimer</a></p>
  </div></div>`;
  startDemo(world);
}
function startDemo(world) {
  if (app.demo) { app.demo.destroy(); app.demo = null; }
  const cv0 = $('#demo'); if (!cv0) return;
  const ids = world.divisions[0].clubIds;
  const a = world.clubs[ids[0]], b = world.clubs[ids[1]];
  import('./core/sim.js').then(({ simulateMatch, makeSheet }) => {
    if (!$('#demo')) return;
    const h = makeSheet(world, a), w = makeSheet(world, b);
    const r = simulateMatch(h, w, 777);
    app.demo = new MatchView(cv0, { home: decoratedTitle(world, h), away: decoratedTitle(world, w), result: r, speed: 1, camera: 'broadcast', demo: true, night: true });
    app.demo.start();
  });
}
function decoratedTitle(world, sh) { const c = world.clubs[sh.clubId]; return { ...sh, name: Pk.cname(c), short: Pk.cshort(c), colors: Pk.ccolors(c) }; }
ACTIONS.pickclub = d => { app.ui.mgr = $('#mgr')?.value || ''; app.ui.pickClub = d.id; $$('.cp').forEach(x => x.classList.toggle('on', x.dataset.id === d.id)); $('[data-act="start"]').disabled = false; };
ACTIONS.titleload = () => { const x = $('#title-load'); x.hidden = !x.hidden; };
ACTIONS.titlelegal = () => { app.ui.showLegal = true; openModal(`<div class="row"><h2>Terms & disclaimer</h2><span class="sp"></span><button class="btn ghost" data-act="close">✕</button></div>${VIEWS.legal().replace(/<div class="page-h">[\s\S]*?<\/div><\/div>/, '')}`); };
ACTIONS.start = () => {
  const name = ($('#mgr')?.value || '').trim() || 'Manager';
  const world = app.titleWorld; if (!app.ui.pickClub) return;
  if (app.demo) { app.demo.destroy(); app.demo = null; }
  app.state = G.newGame({ world, managerName: name, clubId: app.ui.pickClub });
  app.titleWorld = null;
  save();
  app.view = 'today'; location.hash = 'today';
  render();
  const c = me();
  setTimeout(() => openModal(`<div class="kicker">Welcome, ${esc(name)}</div><h2>${cn(c)} is yours</h2>
    <p>Every real day is one matchday. A good daily session takes 10 to 30 minutes:</p>
    <ol style="margin:0;padding-left:20px;display:grid;gap:6px"><li><b>Train</b> the squad once a day. It is the only way players improve.</li><li><b>Set your team</b> and tactics.</li><li><b>Play the match</b>, live or as a quick result. You can change tactics at half time.</li><li><b>Trade</b>: bids and scout reports come back overnight.</li></ol>
    <p class="muted">Miss a day and your assistant plays the match, but training and offers are lost. Come back daily to build your streak.</p>
    <button class="btn primary" data-act="close">Let's go</button>`), 60);
};

// ---------- boot ----------
function boot() {
  const saved = loadSave();
  const v = location.hash.slice(1);
  if (saved) {
    app.state = saved;
    app.view = VIEWS[v] ? v : 'today';
    const d = sync();
    render();
    briefing(d);
  } else {
    if (v === 'legal') { app.state = null; }
    render();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.state && !$('.match')) { const d = sync(); if (d.days || d.streakBonus) { render(); briefing(d); } }
  });
}
boot();
