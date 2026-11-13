// Estatísticas amostradas desta sessão. Não cria ocorrências no Firebase.
export function motionValue(value) {
  if ([1, "1", true].includes(value)) return 1;
  if ([0, "0", false].includes(value)) return 0;
  return null;
}
export class MotionSession {
  constructor() {
    this.previous = null;
    this.time = null;
    this.clock = null;
    this.events = 0;
    this.observedMs = 0;
    this.activeMs = 0;
    this.currentMs = 0;
    this.lastEvent = null;
    this.partial = false;
  }
  interrupt() {
    this.previous = null;
    this.time = null;
    this.currentMs = 0;
    this.partial = false;
  }
  add(value, time, clock) {
    const state = motionValue(value);
    if (state === null || !Number.isFinite(time) || time < 0) {
      this.interrupt();
      return { state: null, gap: true, duplicate: false };
    }
    const delta = this.time === null ? null : time - this.time;
    if (this.clock === clock && delta === 0) return { state, duplicate: true, gap: false };
    const gap = this.previous === null || this.clock !== clock || delta <= 0 || delta > 15000;
    if (gap) {
      this.interrupt();
      this.partial = state === 1;
    } else {
      this.observedMs += delta;
      if (this.previous === 1) {
        this.activeMs += delta;
        this.currentMs += delta;
      }
      if (this.previous === 0 && state === 1) {
        this.events++;
        this.currentMs = 0;
        this.partial = false;
      }
      if (this.previous === 1 && state === 0) {
        this.lastEvent = { durationMs: this.currentMs, partial: this.partial };
        this.currentMs = 0;
        this.partial = false;
      }
    }
    this.previous = state;
    this.time = time;
    this.clock = clock;
    return { state, duplicate: false, gap };
  }
  get frequency() { return this.observedMs > 0 ? this.events * 60000 / this.observedMs : null; }
}
