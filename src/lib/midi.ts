import { NoteEvent, midiToFreq } from "./music";
import type { AnalysisParams, AnalysisResult, LogFn } from "./pitch";

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

export interface MidiNote {
  midi: number;
  startMs: number;
  endMs: number;
  velocity: number;
  track: number;
  channel: number;
}

export interface MidiTrackInfo {
  index: number;
  name: string;
  noteCount: number;
  channels: number[];
  minMidi: number;
  maxMidi: number;
}

export interface MidiFileData {
  name: string;
  format: number;
  trackCount: number;
  ticksPerQuarter: number; // 0, если SMPTE
  smpteTicksPerSec: number; // 0, если PPQ
  durationMs: number;
  notes: MidiNote[];
  tracks: MidiTrackInfo[];
  tempoCount: number;
  startBpm: number;
  minMidi: number;
  maxMidi: number;
}

export interface MidiOpts {
  /** -1 = автовыбор самой насыщенной дорожки */
  track: number;
  /** как разруливать полифонию */
  poly: "top" | "bottom";
}

export const DEFAULT_MIDI_OPTS: MidiOpts = { track: -1, poly: "top" };

/* ------------------------------------------------------------------ */
/*  Парсер SMF                                                         */
/* ------------------------------------------------------------------ */

function readVarLen(u8: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let b = 0;
  do {
    b = u8[pos++];
    value = (value << 7) | (b & 0x7f);
  } while (b & 0x80);
  return { value, next: pos };
}

export function parseMidi(buf: ArrayBuffer, name: string): MidiFileData {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const ascii = (o: number, n: number): string => {
    let s = "";
    for (let i = 0; i < n && o + i < u8.length; i++) s += String.fromCharCode(u8[o + i]);
    return s;
  };

  if (u8.length < 14 || ascii(0, 4) !== "MThd") {
    throw new Error("это не MIDI-файл (заголовок MThd не найден)");
  }
  const hLen = dv.getUint32(4, false);
  const format = dv.getUint16(8, false);
  const trackCount = dv.getUint16(10, false);
  const division = dv.getUint16(12, false);

  let tpq = 0;
  let tps = 0;
  if (division & 0x8000) {
    const fps = 256 - (division >> 8);
    tps = fps * (division & 0xff);
  } else {
    tpq = division || 480;
  }

  interface TickNote {
    midi: number;
    startTick: number;
    endTick: number;
    velocity: number;
    track: number;
    channel: number;
  }
  const tickNotes: TickNote[] = [];
  const tempos: { tick: number; usPerQ: number }[] = [];
  const tracks: MidiTrackInfo[] = [];

  let off = 8 + hLen;
  for (let ti = 0; ti < trackCount; ti++) {
    // добираемся до чанка MTrk (могут быть нестандартные чанки)
    while (off + 8 <= u8.length && ascii(off, 4) !== "MTrk") {
      const l = dv.getUint32(off + 4, false);
      off += 8 + l;
    }
    if (off + 8 > u8.length) break;
    const len = dv.getUint32(off + 4, false);
    let pos = off + 8;
    const end = pos + len;
    off = end;

    let tick = 0;
    let lastTick = 0;
    let running = 0;
    let tName = "";
    const chans = new Set<number>();
    const open = new Map<number, { tick: number; vel: number }[]>();
    let minM = 127;
    let maxM = 0;
    let cnt = 0;

    const emit = (note: number, ch: number, st: number, en: number, vel: number) => {
      if (en <= st) en = st + 1;
      tickNotes.push({ midi: note, startTick: st, endTick: en, velocity: vel, track: ti, channel: ch });
      cnt++;
      if (note < minM) minM = note;
      if (note > maxM) maxM = note;
    };

    while (pos < end) {
      const d = readVarLen(u8, pos);
      pos = d.next;
      tick += d.value;
      lastTick = tick;

      let status = u8[pos];
      if (status < 0x80) {
        status = running;
      } else {
        pos++;
        if (status < 0xf0) running = status;
      }

      if (status === 0xff) {
        const meta = u8[pos];
        const ml = readVarLen(u8, pos + 1);
        const dataStart = ml.next;
        pos = ml.next + ml.value;
        if (meta === 0x51 && ml.value === 3) {
          const us = (u8[dataStart] << 16) | (u8[dataStart + 1] << 8) | u8[dataStart + 2];
          if (us > 0) tempos.push({ tick, usPerQ: us });
        } else if (meta === 0x03 && !tName) {
          tName = ascii(dataStart, ml.value).replace(/\0/g, "").trim();
        }
        if (meta === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        const sl = readVarLen(u8, pos);
        pos = sl.next + sl.value;
      } else {
        const kind = status & 0xf0;
        const ch = status & 0x0f;
        if (kind === 0x90 || kind === 0x80) {
          const note = u8[pos];
          const vel = u8[pos + 1];
          pos += 2;
          const key = (ch << 8) | note;
          if (kind === 0x90 && vel > 0) {
            chans.add(ch);
            const arr = open.get(key) ?? [];
            arr.push({ tick, vel });
            open.set(key, arr);
          } else {
            const arr = open.get(key);
            if (arr && arr.length > 0) {
              const on = arr.pop()!;
              emit(note, ch, on.tick, tick, on.vel);
            }
          }
        } else if (kind === 0xc0 || kind === 0xd0) {
          pos += 1;
        } else {
          pos += 2;
        }
      }
    }
    // висячие ноты закрываем концом трека
    open.forEach((arr, key) => {
      for (const on of arr) emit(key & 0xff, key >> 8, on.tick, lastTick, on.vel);
    });

    tracks.push({
      index: ti,
      name: tName,
      noteCount: cnt,
      channels: [...chans].sort((a, b) => a - b),
      minMidi: cnt > 0 ? minM : 0,
      maxMidi: cnt > 0 ? maxM : 0,
    });
  }

  /* тики → миллисекунды через карту темпов */
  tempos.sort((a, b) => a.tick - b.tick);
  const tickToMs = (t: number): number => {
    if (tps > 0) return (t / tps) * 1000;
    let ms = 0;
    let last = 0;
    let cur = 500000; // 120 BPM по умолчанию
    for (const tp of tempos) {
      if (tp.tick >= t) break;
      ms += ((tp.tick - last) / tpq) * (cur / 1000);
      last = tp.tick;
      cur = tp.usPerQ;
    }
    ms += ((t - last) / tpq) * (cur / 1000);
    return ms;
  };

  const notes: MidiNote[] = tickNotes
    .map((n) => ({
      midi: n.midi,
      startMs: tickToMs(n.startTick),
      endMs: tickToMs(n.endTick),
      velocity: n.velocity,
      track: n.track,
      channel: n.channel,
    }))
    .sort((a, b) => a.startMs - b.startMs || b.midi - a.midi);

  let durationMs = 0;
  let minMidi = 127;
  let maxMidi = 0;
  for (const n of notes) {
    if (n.endMs > durationMs) durationMs = n.endMs;
    if (n.midi < minMidi) minMidi = n.midi;
    if (n.midi > maxMidi) maxMidi = n.midi;
  }

  return {
    name,
    format,
    trackCount,
    ticksPerQuarter: tpq,
    smpteTicksPerSec: tps,
    durationMs,
    notes,
    tracks,
    tempoCount: tempos.length,
    startBpm: tempos.length > 0 ? Math.round(60000000 / tempos[0].usPerQ) : 120,
    minMidi: notes.length > 0 ? minMidi : 0,
    maxMidi: notes.length > 0 ? maxMidi : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  MIDI → моно-мелодия → AnalysisResult                               */
/* ------------------------------------------------------------------ */

export function convertMidi(md: MidiFileData, p: AnalysisParams, o: MidiOpts, log: LogFn): AnalysisResult {
  const empty: AnalysisResult = {
    notes: [],
    totalMs: 0,
    voicedCount: 0,
    restCount: 0,
    freqMin: 0,
    freqMax: 0,
    droppedLow: 0,
    truncated: false,
    analyzedSec: md.durationMs / 1000,
  };

  /* 1) фильтр по лимиту времени и дорожке */
  let pool = md.notes;
  if (p.limitSec > 0) {
    const lim = p.limitSec * 1000;
    pool = pool.filter((n) => n.startMs < lim);
  }

  let trackIdx = o.track;
  if (trackIdx === -1) {
    let best = -1;
    let bestCnt = 0;
    for (const t of md.tracks) {
      const c = pool.reduce((a, n) => a + (n.track === t.index ? 1 : 0), 0);
      if (c > bestCnt) {
        bestCnt = c;
        best = t.index;
      }
    }
    trackIdx = best;
    if (best >= 0) {
      const ti = md.tracks.find((t) => t.index === best);
      log(
        `дорожка #${best + 1}${ti?.name ? ` «${ti.name}»` : ""} — ${bestCnt} нот (автовыбор мелодии)`,
        "info",
      );
    }
  }
  if (trackIdx >= 0) pool = pool.filter((n) => n.track === trackIdx);
  if (pool.length === 0) {
    log("в выбранной дорожке нет нот — попробуй другую", "err");
    return empty;
  }

  /* 2) монофоническая редукция: свип по границам интервалов */
  const bounds = new Set<number>();
  const starts = new Map<number, MidiNote[]>();
  for (const n of pool) {
    bounds.add(n.startMs);
    bounds.add(n.endMs);
    const arr = starts.get(n.startMs) ?? [];
    arr.push(n);
    starts.set(n.startMs, arr);
  }
  const pts = [...bounds].sort((a, b) => a - b);

  interface Ev {
    midi: number;
    durMs: number;
  }
  const segs: Ev[] = [];
  let active: MidiNote[] = [];
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i];
    active = active.filter((n) => n.endMs > t);
    const add = starts.get(t);
    if (add) active.push(...add);
    const next = pts[i + 1];
    if (next === undefined || next <= t) continue;
    let midi = 0;
    if (active.length > 0) {
      let best = active[0];
      for (const n of active) {
        if (o.poly === "top" ? n.midi > best.midi : n.midi < best.midi) best = n;
      }
      midi = best.midi;
    }
    segs.push({ midi, durMs: next - t });
  }

  /* 3) склейка, фильтры, транспозиция */
  const merged: Ev[] = [];
  let droppedOut = 0;
  let droppedLow = 0;
  for (const s of segs) {
    let midi = s.midi;
    if (midi > 0) {
      const f = midiToFreq(midi + p.transpose);
      if (f < p.minFreq * 0.45 || f > p.maxFreq * 1.7) {
        midi = 0;
        droppedOut++;
      } else if (f < 31) {
        midi = 0;
        droppedLow++;
      } else if (s.durMs < p.minNoteMs) {
        midi = 0;
      }
    }
    const last = merged[merged.length - 1];
    if (last && last.midi === midi) last.durMs += s.durMs;
    else merged.push({ midi, durMs: s.durMs });
  }

  /* 4) скорость, округление, лимиты */
  let truncated = false;
  if (merged.length > p.maxNotes) {
    merged.length = p.maxNotes;
    truncated = true;
  }
  const notes: NoteEvent[] = [];
  let totalMs = 0;
  let voiced = 0;
  let rests = 0;
  let fMin = Infinity;
  let fMax = 0;
  for (const e of merged) {
    const dur = Math.max(10, Math.round(e.durMs / p.speed));
    const f = e.midi > 0 ? Math.min(32000, Math.round(midiToFreq(Math.max(0, Math.min(127, e.midi + p.transpose))))) : 0;
    notes.push({ freq: f, durationMs: dur });
    totalMs += dur;
    if (f > 0) {
      voiced++;
      if (f < fMin) fMin = f;
      if (f > fMax) fMax = f;
    } else {
      rests++;
    }
  }

  if (voiced > 0) {
    log(`${voiced} нот · ${rests} пауз · ${(totalMs / 1000).toFixed(1)} с · ${Math.round(fMin)}–${Math.round(fMax)} Гц`, "ok");
  }
  if (droppedOut > 0) log(`${droppedOut} нот вне диапазона ${p.minFreq}–${p.maxFreq} Гц → паузы`, "warn");
  if (droppedLow > 0) log(`${droppedLow} нот ниже 31 Гц → паузы (лимит tone())`, "warn");
  if (truncated) log(`обрезано до ${p.maxNotes} событий`, "warn");

  return {
    notes,
    totalMs,
    voicedCount: voiced,
    restCount: rests,
    freqMin: voiced > 0 ? fMin : 0,
    freqMax: voiced > 0 ? fMax : 0,
    droppedLow,
    truncated,
    analyzedSec: p.limitSec > 0 ? Math.min(p.limitSec, md.durationMs / 1000) : md.durationMs / 1000,
  };
}
