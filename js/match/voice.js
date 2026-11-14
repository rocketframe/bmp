// Spoken commentary with the browser's built-in speech synthesis (free, offline-capable, no server).
// A small director decides what is worth saying: build-up calls, the shot, and the outcome. Each line
// is cut into short bursts, and every burst gets its own pitch, rate and volume from how big the moment
// is and how the sentence ends ("!" louder and higher, "?!" a scream, "..." a held build-up), so the
// voice rises and falls like a real commentator instead of reading in one flat tone. Lesser lines are
// dropped rather than queued so the voice never lags behind the pictures. Cosmetic only: Math.random
// here never touches the match simulation.
const pick = a => a[Math.floor(Math.random() * a.length)];
const PRIO = { goal: 4, save: 3, miss: 3, penalty: 3, red: 3, shot: 2, ft: 2, ht: 2, kickoff: 1, second: 1, attack: 1, chance: 1, yellow: 1, offside: 0, corner: 0, sub: 0, foul: 0, injury: 0 };
// Intensity levels, 0 (calm) to 5 (all-out goal scream): [rate, pitch, volume]
const LEVEL = [[1.04, 1.08, 0.85], [1.1, 1.16, 0.9], [1.16, 1.26, 0.95], [1.22, 1.36, 1], [1.28, 1.5, 1], [1.34, 1.68, 1]];
const SHOUT = /\b(GOAL|YES|NO|IN|OFF|ERUPTS|SMASHES|PENALTY)\b/g;
const STYLE = { calm: 0, lively: 1, excited: 3, peak: 4, scream: 5 };
// Base intensity of each kind of line; sentence punctuation then raises or lowers it.
const BASE = { goal: 3, save: 3, miss: 3, penalty: 3, red: 3, chance: 2, kickoff: 2, second: 2, ft: 2, ht: 1, yellow: 1, foul: 1, offside: 1, corner: 1, sub: 1, injury: 0 };

// "Ohhh! Ronaldo has to score there! It's wide!" -> ["Ohhh!", "Ronaldo has to score there!", "It's wide!"]
export function bursts(text) {
  return (String(text).match(/[^.!?]+(?:\.\.\.|[.!?]+)?/g) || []).map(s => s.trim()).filter(Boolean);
}
// Intensity of one burst given the line's base level.
export function burstLevel(s, base) {
  let l = base;
  if (/\?!|!\?/.test(s)) l += 2;
  else if (/!$/.test(s)) l += 1;
  else if (/\.\.\.$/.test(s)) l = Math.max(1, l - 1); // hold back for the build-up
  else if (/\.$/.test(s)) l -= 1;
  if (new RegExp(SHOUT.source).test(s)) l += 1;              // shouted words: GOAL, OFF, NO
  return Math.max(0, Math.min(5, l));
}

export class Commentator {
  constructor() {
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    this.enabled = false; this.cur = -1; this.voice = null; this.speed = 1; this.onSpeaking = null;
    if (this.ok) { this.pickVoice(); window.speechSynthesis.onvoiceschanged = () => this.pickVoice(); }
  }
  voices() { return this.ok ? window.speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)) : []; }
  pickVoice(name) {
    const vs = this.voices(); if (!vs.length) return;
    name = name || this.preferred;
    if (name && vs.find(v => v.name === name)) { this.voice = vs.find(v => v.name === name); return; }
    if (this.voice && vs.includes(this.voice)) return;
    // Prefer lively, natural-sounding British male voices: the neural "Natural/Online" voices in Edge,
    // Chrome's "Google UK English Male" (which follows pitch and rate well), then Apple's enhanced voices.
    // Novelty and robotic voices (eSpeak, Fred, Albert, whisper...) go to the bottom.
    const score = v => {
      const n = v.name;
      if (/espeak|fred|albert|bad news|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|kathy|grandpa|grandma|rocko|shelley|eddy|flo|reed|sandy/i.test(n)) return -20;
      return (/natural|neural/i.test(n) ? 10 : 0) + (/online|premium|enhanced/i.test(n) ? 4 : 0)
        + (/google uk english male/i.test(n) ? 9 : /google/i.test(n) ? 3 : 0)
        + (/en-GB/i.test(v.lang) ? 3 : /en-(IE|AU)/i.test(v.lang) ? 1 : 0)
        + (/\bmale\b|daniel|ryan|guy|arthur|george|oliver|brian|thomas|connor|william|eric|christopher/i.test(n) && !/female/i.test(n) ? 3 : 0)
        + (v.localService ? 0 : 1);
    };
    this.voice = vs.slice().sort((a, b) => score(b) - score(a))[0];
  }
  setEnabled(on) { this.enabled = on && this.ok; if (!this.enabled) this.stop(); }
  stop() { if (this.ok) window.speechSynthesis.cancel(); this.cur = -1; this.onSpeaking?.(false); }

  // text: a string, or a list of [text, style|level, fixed?] parts (fixed: keep the level as given). Each part is split into bursts.
  speak(text, prio = 1, style = 'lively') {
    if (!this.enabled || !text) return;
    const ss = window.speechSynthesis;
    const busy = ss.speaking || ss.pending;
    if (busy && prio <= this.cur && prio < 3) return;  // drop smaller moments
    if (busy && prio > this.cur) ss.cancel();        // a bigger moment interrupts
    const parts = Array.isArray(text) ? text : [[text, style]];
    const out = [];
    for (const [t, st, fixed] of parts) {
      const base = typeof st === 'number' ? st : STYLE[st] ?? 1;
      for (const b of bursts(t)) out.push([b, fixed ? base : burstLevel(b, base)]);
    }
    out.forEach(([t, lv], i) => {
      const u = new SpeechSynthesisUtterance(t.replace(/\.\.\./g, ', ').replace(SHOUT, w => w[0] + w.slice(1).toLowerCase()));
      const [r, p, v] = LEVEL[lv];
      const wob = 1 + (Math.random() - 0.5) * 0.08;   // no two calls in exactly the same tone
      u.rate = Math.min(1.7, r * (this.speed > 1 ? 1.12 : 1)); u.pitch = Math.min(2, p * wob); u.volume = v;
      try { if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'en-GB'; } catch { u.lang = 'en-GB'; }
      if (i === 0) u.onstart = () => this.onSpeaking?.(true);
      if (i === out.length - 1) u.onend = u.onerror = () => { this.cur = -1; this.onSpeaking?.(false); };
      ss.speak(u);
    });
    this.cur = prio;
  }

  // ---- match moments ----
  attack(team) { this.speak(pick([`${team} on the attack!`, `Here come ${team}!`, `${team}, building now...`, `${team} pouring forward!`, `Danger here! ${team} break!`]), PRIO.attack, 'lively'); }
  shot(name, e) {
    const t = e.header ? pick([`Header, ${name}!`, `${name} rises!`, `${name}, with the head!`]) : e.long ? pick([`${name} lets fly!`, `${name}, from distance!`, `${name}, have a go!`]) : pick([`${name}!`, `${name} shoots!`, `Chance for ${name}!`, `${name}, here it is!`, `${name}, for the goal!`]);
    this.speak(t, PRIO.shot, 'peak');
  }
  line(kind, text) {
    const p = PRIO[kind] ?? 0;
    const base = BASE[kind] ?? 1;
    if (kind === 'goal') {
      const scream = pick([['GOAL!', 'GOAL!', 'GOAL!'], ['GOAL!', 'GOAL!'], ['YES!', 'GOAL!'], ["It's IN!", 'GOAL!']]);
      return this.speak([...scream.map((s, i) => [s, Math.min(5, 4 + i), true]), [text.replace(/^GOAL!\s*/i, ''), base]], 4);
    }
    if (p >= 1) this.speak(text, p, base);
  }
}
