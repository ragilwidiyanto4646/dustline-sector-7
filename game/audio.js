/* ============================================================================
   DUSTLINE // Sector 7 — audio.js
   Synthesized audio: every sound is built from oscillators and filtered
   noise at runtime, so the game ships no audio files and makes no network
   request. One object, one job.
   ========================================================================== */
import { clamp, rand } from './util.js';

export const AudioSys = {
  ctx: null, master: null, enabled: true, volume: 0.55,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  _noiseBuf(dur = 0.3) {
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  },
  shot(weaponId, dist = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, vol = clamp(1 - dist / 70, 0.15, 1);
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf(0.22);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = weaponId === 'lw308' ? 900 : weaponId === 'sg12' ? 1200 : 2600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.85 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.25);
    // body thump
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(weaponId === 'lw308' ? 90 : 150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = this.ctx.createGain(); og.gain.setValueAtTime(0.5 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.11);
  },
  _tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  dryFire() { this._tone(1400, 0.05, 'square', 0.12); },
  reload() { this._tone(900, 0.06, 'square', 0.12); setTimeout(() => this._tone(620, 0.06, 'square', 0.14), 140); },
  hit(head = false) { this._tone(head ? 2400 : 1700, 0.07, 'sine', 0.3); },
  kill() { this._tone(520, 0.1, 'sine', 0.3); setTimeout(() => this._tone(780, 0.14, 'sine', 0.3), 90); },
  hurt() { this._tone(160, 0.16, 'sawtooth', 0.25, 90); },
  step() { if (Math.random() < 0.5) this._tone(rand(70, 110), 0.05, 'sine', 0.07); },
  beep(fast = false) { this._tone(fast ? 1250 : 950, 0.12, 'square', 0.22); },
  plant() { this._tone(700, 0.12, 'square', 0.2); setTimeout(() => this._tone(1050, 0.16, 'square', 0.2), 130); },
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 'triangle', 0.28), i * 120)); },
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.24, 'triangle', 0.25), i * 130)); },
  explosion() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(1.2);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
    this._tone(60, 0.9, 'sine', 0.5, 30);
  },
};
