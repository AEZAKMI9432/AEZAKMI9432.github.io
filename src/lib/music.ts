export interface NoteEvent {
  /** Hz, 0 = пауза */
  freq: number;
  /** итоговая длительность, мс (скорость уже применена) */
  durationMs: number;
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function freqToMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function midiToName(m: number): string {
  const r = Math.round(m);
  const name = NOTE_NAMES[((r % 12) + 12) % 12];
  return `${name}${Math.floor(r / 12) - 1}`;
}

export function freqToName(f: number): string {
  return midiToName(freqToMidi(f));
}

/** привязка частоты к ближайшему полутону */
export function quantizeFreq(f: number): number {
  return midiToFreq(Math.round(freqToMidi(f)));
}

export function centsBetween(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}

export function formatTime(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

export function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return cleaned || "my_melody";
}
