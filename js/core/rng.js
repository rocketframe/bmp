// Seeded, serializable RNG (mulberry32). The whole state is one 32-bit number,
// so it can be saved, sent to a server, or replayed deterministically.
export function makeRng(seed) {
  let s = seed >>> 0;
  const r = {
    get state() { return s; },
    set state(v) { s = v >>> 0; },
    next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(a, b) { return a + (b - a) * r.next(); },
    int(a, b) { return a + Math.floor(r.next() * (b - a + 1)); },
    chance(p) { return r.next() < p; },
    pick(arr) { return arr[Math.floor(r.next() * arr.length)]; },
    normal(mu = 0, sd = 1) {
      let u = 0; while (!u) u = r.next();
      const v = r.next();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      return arr;
    },
    weighted(items, wfn) {
      let tot = 0; for (const it of items) tot += Math.max(0, wfn(it));
      let x = r.next() * tot;
      for (const it of items) { x -= Math.max(0, wfn(it)); if (x <= 0) return it; }
      return items[items.length - 1];
    },
  };
  return r;
}

export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const str = String(p);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x9e3779b9; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
