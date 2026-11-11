// Spoken commentary with the browser's built-in speech synthesis (free, offline-capable, no server).
// A small director decides what is worth saying: build-up calls, the shot, and the outcome, with
// faster and higher delivery as the moment gets bigger. Lesser lines are dropped rather than queued
// so the voice never lags behind the pictures.
const pick = a => a[Math.floor(Math.random() * a.length)];
const PRIO = { goal: 4, save: 3, miss: 3, penalty: 3, red: 3, shot: 2, ft: 2, ht: 2, kickoff: 1, second: 1, attack: 1, chance: 1, yellow: 1, offside: 0, corner: 0, sub: 0, foul: 0, injury: 0 };
const STYLE = { // rate, pitch
  calm: [1.0, 1.0], lively: [1.08, 1.08], excited: [1.16, 1.2], peak: [1.22, 1.32],
};

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
    const score = v => (/natural|online|neural|premium|enhanced/i.test(v.name) ? 8 : 0) + (/en-GB/i.test(v.lang) ? 3 : 0) + (/male|daniel|ryan|guy|arthur|george|oliver|brian/i.test(v.name) && !/female/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
    this.voice = vs.slice().sort((a, b) => score(b) - score(a))[0];
  }
  setEnabled(on) { this.enabled = on && this.ok; if (!this.enabled) this.stop(); }
  stop() { if (this.ok) window.speechSynthesis.cancel(); this.cur = -1; this.onSpeaking?.(false); }

  speak(text, prio = 1, style = 'calm') {
    if (!this.enabled || !text) return;
    const ss = window.speechSynthesis;
    const busy = ss.speaking || ss.pending;
    if (busy && prio <= this.cur && prio < 3) return;  // drop smaller moments
    if (busy && prio > this.cur) ss.cancel();        // a bigger moment interrupts
    const parts = Array.isArray(text) ? text : [[text, style]];
    parts.forEach(([t, st], i) => {
      const u = new SpeechSynthesisUtterance(t.replace(/\.\.\./g, ', '));
      const [r, p] = STYLE[st] || STYLE.calm;
      u.rate = Math.min(1.6, r * (this.speed > 1 ? 1.12 : 1)); u.pitch = p; u.volume = 1;
      try { if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'en-GB'; } catch { u.lang = 'en-GB'; }
      if (i === 0) u.onstart = () => this.onSpeaking?.(true);
      if (i === parts.length - 1) u.onend = u.onerror = () => { this.cur = -1; this.onSpeaking?.(false); };
      ss.speak(u);
    });
    this.cur = prio;
  }

  // ---- match moments ----
  attack(team) { this.speak(pick([`${team} on the attack.`, `Here come ${team}.`, `${team}, building now.`, `${team} coming forward.`]), PRIO.attack, 'calm'); }
  shot(name, e) {
    const t = e.header ? pick([`Header, ${name}!`, `${name} rises!`]) : e.long ? pick([`${name} lets fly!`, `${name}, from distance!`]) : pick([`${name}!`, `${name} shoots!`, `Chance for ${name}!`, `${name}, here it is!`]);
    this.speak(t, PRIO.shot, 'excited');
  }
  line(kind, text) {
    const p = PRIO[kind] ?? 0;
    if (kind === 'goal') return this.speak([[pick(['GOAL!', 'Goal! Goal!', 'It\'s in!', 'YES! Goal!']), 'peak'], [text.replace(/^GOAL!\s*/i, ''), 'excited']], 4);
    if (kind === 'save' || kind === 'miss' || kind === 'penalty' || kind === 'red') return this.speak(text, p, 'excited');
    if (kind === 'ht' || kind === 'ft' || kind === 'kickoff' || kind === 'second') return this.speak(text, p, 'lively');
    if (p >= 1) this.speak(text, p, 'calm');
  }
}
