import { NoteEvent, centsBetween, quantizeFreq } from "./music";

export interface AnalysisParams {
  /** разрешение по времени, мс (шаг анализа) */
  frameMs: number;
  /** 0..100 — порог громкости */
  sensitivity: number;
  minFreq: number;
  maxFreq: number;
  /** ноты короче — превращаются в паузы */
  minNoteMs: number;
  quantize: boolean;
  /** полутоны, -24..24 */
  transpose: number;
  /** множитель скорости: длительности делятся на него */
  speed: number;
  maxNotes: number;
  /** ограничение длительности анализа, сек (0 = весь трек) */
  limitSec: number;
}

export const DEFAULT_PARAMS: AnalysisParams = {
  frameMs: 60,
  sensitivity: 30,
  minFreq: 50,
  maxFreq: 2200,
  minNoteMs: 90,
  quantize: true,
  transpose: 0,
  speed: 1,
  maxNotes: 700,
  limitSec: 60,
};

export type LogKind = "info" | "ok" | "warn" | "err";
export type LogFn = (msg: string, kind?: LogKind) => void;

export interface SourceAudio {
  mono: Float32Array;
  sampleRate: number;
  duration: number;
  peaks: number[];
  name: string;
}

export interface AnalysisResult {
  notes: NoteEvent[];
  totalMs: number;
  voicedCount: number;
  restCount: number;
  freqMin: number;
  freqMax: number;
  droppedLow: number;
  truncated: boolean;
  analyzedSec: number;
}

/* ------------------------------------------------------------------ */
/*  Декодирование файла                                                */
/* ------------------------------------------------------------------ */

export async function decodeToSource(file: Blob, name: string): Promise<SourceAudio> {
  const W = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = W.AudioContext || W.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API не поддерживается в этом браузере");
  const ctx = new Ctor();
  try {
    const raw = await file.arrayBuffer();
    const buf = await ctx.decodeAudioData(raw.slice(0));
    const len = buf.length;
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;

    const bucketCount = Math.min(1800, Math.max(240, Math.floor(buf.duration * 90)));
    const peaks: number[] = new Array(bucketCount).fill(0);
    const step = len / bucketCount;
    for (let b = 0; b < bucketCount; b++) {
      const s0 = Math.floor(b * step);
      const s1 = Math.min(len, Math.floor((b + 1) * step));
      let m = 0;
      for (let i = s0; i < s1; i += 6) {
        const v = Math.abs(mono[i]);
        if (v > m) m = v;
      }
      peaks[b] = m;
    }

    return { mono, sampleRate: buf.sampleRate, duration: buf.duration, peaks, name };
  } finally {
    void ctx.close();
  }
}

/* ------------------------------------------------------------------ */
/*  Автокорреляционный детектор питча                                  */
/* ------------------------------------------------------------------ */

function corrAt(data: Float32Array, off: number, win: number, lag: number): number {
  let num = 0;
  let den = 0;
  const lim = win - lag;
  for (let i = 0; i < lim; i++) {
    const a = data[off + i];
    num += a * data[off + i + lag];
    den += a * a;
  }
  return den > 1e-12 ? num / den : 0;
}

function pitchFrame(
  data: Float32Array,
  off: number,
  win: number,
  sr: number,
  minP: number,
  maxP: number,
): number {
  let bestP = -1;
  let bestV = 0.4;
  for (let p = minP; p <= maxP; p++) {
    const c = corrAt(data, off, win, p);
    if (c > bestV) {
      bestV = c;
      bestP = p;
    }
  }
  if (bestP < 0) return 0;
  // параболическая интерполяция для суб-сэмпловой точности
  const c = corrAt(data, off, win, bestP);
  const l = corrAt(data, off, win, Math.max(minP, bestP - 1));
  const r = corrAt(data, off, win, Math.min(maxP, bestP + 1));
  const denom = l - 2 * c + r;
  let shift = 0;
  if (Math.abs(denom) > 1e-9) shift = (0.5 * (l - r)) / denom;
  if (shift < -0.5 || shift > 0.5) shift = 0;
  return sr / (bestP + shift);
}

/* ------------------------------------------------------------------ */
/*  Основной анализ                                                    */
/* ------------------------------------------------------------------ */

export async function analyze(
  src: SourceAudio,
  p: AnalysisParams,
  onProgress: (pct: number) => void,
  log: LogFn,
): Promise<AnalysisResult> {
  const t0 = performance.now();
  let len = src.mono.length;
  if (p.limitSec > 0 && src.duration > p.limitSec) {
    len = Math.floor(p.limitSec * src.sampleRate);
    log(`анализируются первые ${p.limitSec} с из ${Math.round(src.duration)} с`, "info");
  }

  // даунсэмплинг (box-decimate) — биперу выше ~2.4 кГц всё равно нечего делать
  const target = p.maxFreq > 2400 ? 11025 : 6016;
  const factor = Math.max(1, Math.round(src.sampleRate / target));
  const srA = src.sampleRate / factor;
  const n = Math.floor(len / factor);
  const data = new Float32Array(n);
  const srcMono = src.mono;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) s += srcMono[base + k];
    data[i] = s / factor;
  }
  if (factor > 1) log(`даунсэмплинг до ${Math.round(srA)} Гц (×${factor})`, "info");

  const hop = Math.max(16, Math.round((srA * p.frameMs) / 1000));
  const hopMs = (hop / srA) * 1000;
  let win = 512;
  while (win < hop * 3 && win < 4096) win *= 2;
  if (data.length < win + hop) throw new Error("Фрагмент слишком короткий для анализа");

  const minP = Math.max(2, Math.floor(srA / p.maxFreq));
  const maxP = Math.min(win - 2, Math.ceil(srA / p.minFreq));
  const thr = 0.0012 + Math.pow(p.sensitivity / 100, 2) * 0.07;
  const semi = Math.pow(2, p.transpose / 12);
  const total = Math.floor((data.length - win) / hop) + 1;
  log(`${total} кадров · окно ${Math.round((win / srA) * 1000)} мс · шаг ${p.frameMs} мс`, "info");

  // 1) кадры → частоты
  const frames: number[] = new Array(total);
  let sinceYield = 0;
  for (let f = 0; f < total; f++) {
    const off = f * hop;
    let rms = 0;
    for (let i = 0; i < win; i++) {
      const v = data[off + i];
      rms += v * v;
    }
    rms = Math.sqrt(rms / win);
    let freq = 0;
    if (rms >= thr) {
      const det = pitchFrame(data, off, win, srA, minP, maxP);
      if (det > 0) {
        freq = det * semi;
        if (freq < p.minFreq * 0.45 || freq > p.maxFreq * 1.7) freq = 0;
      }
    }
    frames[f] = freq;
    if (++sinceYield >= 160) {
      sinceYield = 0;
      onProgress(f / total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress(1);

  // 2) склейка кадров в события
  interface Ev {
    f: number;
    frames: number;
  }
  const raw: Ev[] = [];
  for (let i = 0; i < total; i++) {
    let f = frames[i];
    if (f > 0 && p.quantize) f = quantizeFreq(f);
    const last = raw[raw.length - 1];
    if (last) {
      const bothRest = last.f === 0 && f === 0;
      const sameNote = last.f > 0 && f > 0 && Math.abs(centsBetween(last.f, f)) <= 60;
      if (bothRest || sameNote) {
        last.frames++;
        continue;
      }
    }
    raw.push({ f, frames: 1 });
  }

  // 3) фильтр коротких нот и суб-31 Гц (лимит tone())
  const merged: Ev[] = [];
  let droppedLow = 0;
  for (const e of raw) {
    let f = e.f;
    const dur = e.frames * hopMs;
    if (f > 0 && dur < p.minNoteMs) f = 0;
    if (f > 0 && f < 31) {
      f = 0;
      droppedLow++;
    }
    const last = merged[merged.length - 1];
    if (last && last.f === f) {
      last.frames += e.frames;
    } else {
      merged.push({ f, frames: e.frames });
    }
  }

  // 4) применяем скорость, считаем статистику
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
    const dur = Math.max(10, Math.round((e.frames * hopMs) / p.speed));
    const f = e.f > 0 ? Math.min(32000, Math.round(e.f)) : 0;
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

  if (voiced === 0) {
    log("мелодия не найдена — подними чувствительность или расширь диапазон", "err");
  } else {
    log(`${voiced} нот · ${rests} пауз · ${(totalMs / 1000).toFixed(1)} с · ${Math.round(fMin)}–${Math.round(fMax)} Гц`, "ok");
  }
  if (droppedLow > 0) log(`${droppedLow} нот ниже 31 Гц → паузы (лимит tone())`, "warn");
  if (truncated) log(`обрезано до ${p.maxNotes} событий — сократи лимит длительности или увеличь шаг`, "warn");
  if (voiced > 0 && rests / (voiced + rests) > 0.7) log("слишком много пауз? попробуй снизить чувствительность", "warn");
  log(`анализ завершён за ${((performance.now() - t0) / 1000).toFixed(1)} с`, "ok");

  return {
    notes,
    totalMs,
    voicedCount: voiced,
    restCount: rests,
    freqMin: voiced > 0 ? fMin : 0,
    freqMax: voiced > 0 ? fMax : 0,
    droppedLow,
    truncated,
    analyzedSec: len / src.sampleRate,
  };
}
