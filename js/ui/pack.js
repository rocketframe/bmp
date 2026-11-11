// Name packs: a local-only overlay of club, league and player names/colours.
// Packs live in this browser only. They never change the shared game data, so in a future
// multiplayer mode other managers always see the default fictional names.
const KEY = 'ml.namepack.v1';
export const PACK_FORMAT = 'bolzplatz-manager-pro-namepack';
// Packs exported before the rename still import.
const LEGACY_FORMATS = ['matchday-legends-namepack'];
const isPack = (p) => p && (p.format === PACK_FORMAT || LEGACY_FORMATS.includes(p.format));
let pack = load();
function load() {
  try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); if (isPack(p)) return { ...p, format: PACK_FORMAT }; } catch (e) {}
  return blank();
}
export function blank() { return { format: PACK_FORMAT, version: 1, title: 'My name pack', author: '', clubs: {}, players: {}, divisions: {} }; }
export function getPack() { return pack; }
export function savePack() { try { localStorage.setItem(KEY, JSON.stringify(pack)); } catch (e) {} }
export function resetPack() { pack = blank(); savePack(); }
export function setPack(p) { pack = p; savePack(); }

export const cname = c => pack.clubs[c.id]?.name || c.name;
export const cshort = c => pack.clubs[c.id]?.short || c.short;
export const cstadium = c => pack.clubs[c.id]?.stadium || c.stadium.name;
export const ccolors = c => ({ ...c.colors, ...(pack.clubs[c.id]?.colors || {}) });
export const ccrest = c => ({ ...c.crest, ...(pack.clubs[c.id]?.crest || {}) });
export const pfirst = p => pack.players[p.id]?.first ?? p.first;
export const plast = p => pack.players[p.id]?.last || p.last;
export const pname = p => `${pfirst(p)} ${plast(p)}`.trim();
export const pshort = p => { const f = pfirst(p); return `${f ? f[0] + '. ' : ''}${plast(p)}`; };
export const dname = d => pack.divisions[d.id] || d.name;
// a club object with the pack applied, for crest/kit rendering
export const cview = c => ({ ...c, name: cname(c), short: cshort(c), colors: ccolors(c), crest: ccrest(c) });

export function editClub(id, field, value) {
  const e = pack.clubs[id] ||= {};
  if (field === 'primary' || field === 'secondary' || field === 'pattern') (e.colors ||= {})[field] = value;
  else if (field === 'shape') (e.crest ||= {}).shape = value;
  else e[field] = value;
  savePack();
}
export function editPlayer(id, field, value) { (pack.players[id] ||= {})[field] = value; savePack(); }
export function editDivision(id, value) { pack.divisions[id] = value; savePack(); }

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n) : undefined);
// Validate an imported pack: only known fields, plain strings, sane lengths. Nothing executable.
export function sanitizePack(raw) {
  if (!isPack(raw)) throw new Error('This file is not a Bolzplatz Manager Pro name pack.');
  const out = blank();
  out.title = str(raw.title, 60) || 'Imported pack'; out.author = str(raw.author, 40) || '';
  let n = 0;
  for (const [id, c] of Object.entries(raw.clubs || {})) {
    if (!/^c[0-9a-z]+$/.test(id) || typeof c !== 'object') continue;
    const e = {};
    if (str(c.name, 40)) e.name = str(c.name, 40);
    if (str(c.short, 4)) e.short = str(c.short, 4).toUpperCase();
    if (str(c.stadium, 40)) e.stadium = str(c.stadium, 40);
    if (c.colors) { e.colors = {}; for (const k of ['primary', 'secondary']) if (HEX.test(c.colors[k])) e.colors[k] = c.colors[k]; if (['plain', 'stripes', 'hoops', 'halves', 'sash', 'sleeves', 'pinstripe'].includes(c.colors.pattern)) e.colors.pattern = c.colors.pattern; }
    if (c.crest && ['shield', 'round', 'diamond', 'pointed', 'square'].includes(c.crest.shape)) e.crest = { shape: c.crest.shape };
    out.clubs[id] = e; n++;
  }
  for (const [id, p] of Object.entries(raw.players || {})) {
    if (!/^p[0-9a-z]+$/.test(id) || typeof p !== 'object') continue;
    const e = {}; const f = str(p.first, 24), l = str(p.last, 30);
    if (f !== undefined) e.first = f; if (l) e.last = l;
    out.players[id] = e; n++;
  }
  for (const [id, d] of Object.entries(raw.divisions || {})) if (/^d\d$/.test(id) && str(d, 40)) out.divisions[id] = str(d, 40);
  return { pack: out, count: n };
}
export function exportPack() { return JSON.stringify({ ...pack, exported: new Date().toISOString().slice(0, 10) }, null, 1); }
