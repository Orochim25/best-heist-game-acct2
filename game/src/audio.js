// Night Ledger — synthesized tension: a low drone, a heartbeat that quickens
// as the alarm rises, and small stings for loot, coins and being caught.
// No audio files: every sound is a WebAudio oscillator. M mutes.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.drone = null;
    this.heartbeat = 0;
  }

  ensure() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.035;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      this.drone = { osc, gain };
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 110.5;
      const gain2 = this.ctx.createGain();
      gain2.gain.value = 0.012;
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start();
    } catch (e) {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.ctx.destination.gain = m ? 0 : 1;
  }

  blip(freq, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Called every frame with the world's tension 0..1. */
  tension(level, dt) {
    if (!this.ctx || this.muted) return;
    this.heartbeat -= dt;
    if (level > 0.25 && this.heartbeat <= 0) {
      this.heartbeat = 1.1 - level * 0.6;
      this.blip(70, 0.12, 'sine', 0.12);
      setTimeout(() => this.blip(60, 0.1, 'sine', 0.09), 140);
    }
  }

  drainEvents(events) {
    if (!this.ctx || this.muted) return;
    for (const e of events) {
      if (e.type === 'loot') this.blip(880, 0.08, 'sine', 0.06);
      else if (e.type === 'prize') { this.blip(523, 0.12, 'sine', 0.09); setTimeout(() => this.blip(784, 0.18, 'sine', 0.09), 110); }
      else if (e.type === 'coin-land') this.blip(1320, 0.05, 'triangle', 0.05);
      else if (e.type === 'spotted' || e.type === 'camera') this.blip(220, 0.3, 'sawtooth', 0.1);
      else if (e.type === 'strike') { this.blip(160, 0.4, 'sawtooth', 0.12); setTimeout(() => this.blip(110, 0.5, 'sawtooth', 0.12), 150); }
      else if (e.type === 'escape') { [523, 659, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'sine', 0.09), i * 120)); }
    }
  }
}
