export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = v => {
  const a = Math.abs(v); const s = v < 0 ? '−' : '';
  if (a >= 1e6) return `${s}€${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e3) return `${s}€${Math.round(a / 1e3)}K`;
  return `${s}€${Math.round(a)}`;
};
export const num = v => Math.round(v).toLocaleString('en-US');
export function toast(msg, kind = 'info') {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3800); setTimeout(() => t.remove(), 4300);
}
export function bar(v, max = 100, cls = '') { return `<span class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, v / max * 100))}%"></i></span>`; }
export function skillClass(s) { return s >= 80 ? 's-elite' : s >= 70 ? 's-good' : s >= 60 ? 's-ok' : s >= 50 ? 's-low' : 's-poor'; }
