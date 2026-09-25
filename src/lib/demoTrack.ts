/**
 * Демо-трек: «Коробейники» (народная мелодия), синтезированный квадратной
 * волной и упакованный в WAV — чтобы конвейер был честным, как с MP3.
 */

type Row = [midi: number, ms: number];

const MELODY: Row[] = [
  [76, 380], [71, 190], [72, 190], [74, 380], [72, 190], [71, 190],
  [69, 570], [69, 190], [72, 380], [76, 380], [74, 190], [72, 190],
  [71, 570], [71, 190], [72, 380], [74, 380], [76, 380],
  [72, 380], [69, 380], [69, 380], [0, 380],
  [74, 570], [77, 190], [81, 380], [79, 190], [77, 190],
  [76, 950],
  [72, 190], [76, 380], [74, 190], [72, 190],
  [71, 570], [71, 190], [72, 380], [74, 380], [76, 380],
  [72, 380], [69, 380], [69, 380], [0, 760],
];

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function encodeWav(samples: Float32Array, sr: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, "data");
  dv.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** variable length quantity для SMF */
function vlq(v: number): number[] {
  const out = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

/** Демо-MIDI: та же «Коробейники», но записанная как настоящий SMF format 0 */
export function createDemoMidiFile(): File {
  const tpq = 480;
  const ticksPerMs = tpq / 500; // при 120 BPM четверть = 500 мс
  const track: number[] = [];

  // tempo meta: 500000 мкс/четверть
  track.push(0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);
  const nm = "demo korobeiniki";
  track.push(0x00, 0xff, 0x03, nm.length, ...[...nm].map((c) => c.charCodeAt(0) & 0x7f));

  let pendingDelta = 0;
  for (const [midi, ms] of MELODY) {
    const ticks = Math.max(1, Math.round(ms * ticksPerMs));
    if (midi === 0) {
      pendingDelta += ticks;
      continue;
    }
    track.push(...vlq(pendingDelta), 0x90, midi & 0x7f, 100);
    track.push(...vlq(ticks), 0x80, midi & 0x7f, 64);
    pendingDelta = 0;
  }
  track.push(...vlq(Math.max(1, pendingDelta)), 0xff, 0x2f, 0x00);

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpq >> 8) & 0xff, tpq & 0xff];
  const trk = [
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >>> 24) & 0xff,
    (track.length >>> 16) & 0xff,
    (track.length >>> 8) & 0xff,
    track.length & 0xff,
  ];
  const bytes = new Uint8Array([...header, ...trk, ...track]);
  return new File([bytes], "demo_korobeiniki.mid", { type: "audio/midi" });
}

export function createDemoFile(): File {
  const sr = 22050;
  const totalMs = MELODY.reduce((a, r) => a + r[1], 0);
  const out = new Float32Array(Math.ceil((totalMs / 1000) * sr));
  let pos = 0;
  for (const [midi, ms] of MELODY) {
    const nSamples = Math.floor((ms / 1000) * sr);
    if (midi > 0) {
      const f = midiToFreq(midi);
      const attack = Math.floor(0.006 * sr);
      const release = Math.floor(0.03 * sr);
      for (let i = 0; i < nSamples; i++) {
        const phase = (f * i) / sr;
        const sq = phase - Math.floor(phase) < 0.5 ? 1 : -1;
        // лёгкий подтон октавой ниже для «жирности»
        const phase2 = (f * 0.5 * i) / sr;
        const sq2 = phase2 - Math.floor(phase2) < 0.5 ? 1 : -1;
        let env = 1;
        if (i < attack) env = i / attack;
        if (i > nSamples - release) env = Math.min(env, (nSamples - i) / release);
        out[pos + i] += (sq * 0.32 + sq2 * 0.14) * env;
        // вибрато-звоночек не нужен — бипер сам звенит
      }
    }
    pos += nSamples;
  }
  const blob = encodeWav(out, sr);
  return new File([blob], "demo_korobeiniki.wav", { type: "audio/wav" });
}
