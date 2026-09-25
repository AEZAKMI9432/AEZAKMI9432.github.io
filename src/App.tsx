import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Asterisk,
  AudioWaveform,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  Download,
  FileCode2,
  ListMusic,
  Loader2,
  MemoryStick,
  Music2,
  Play,
  SlidersHorizontal,
  Square,
  Timer,
  TriangleAlert,
  Waves,
  Wand2,
  Zap,
} from "lucide-react";
import {
  AnalysisParams,
  AnalysisResult,
  DEFAULT_PARAMS,
  LogFn,
  SourceAudio,
  analyze,
  decodeToSource,
} from "./lib/pitch";
import { DEFAULT_MIDI_OPTS, MidiFileData, MidiOpts, convertMidi, parseMidi } from "./lib/midi";
import { SketchOpts, estimateFlash, generateSketch } from "./lib/sketch";
import { formatClock, formatTime, midiToName, sanitizeName } from "./lib/music";
import { createDemoFile, createDemoMidiFile } from "./lib/demoTrack";
import { Background } from "./components/Background";
import { Dropzone, SourceFileInfo } from "./components/Dropzone";
import { PanelCard, SliderRow, SwitchRow, PRESETS, LIMIT_OPTIONS } from "./components/Controls";
import { Terminal, LogLine } from "./components/Terminal";
import { CodeBlock } from "./components/CodeBlock";
import { PianoRoll } from "./components/PianoRoll";
import { WaveCanvas } from "./components/WaveCanvas";

const MARQUEE = [
  "TONE()",
  "PROGMEM",
  "ПАССИВНЫЙ ЗУММЕР",
  "PITCH DETECTION",
  "MIDI SMF",
  "MELODY.INO",
  "ATMEGA328P",
  "SQUARE WAVE",
  "MP3 → БИП",
];

interface Player {
  ctx: AudioContext;
  osc: OscillatorNode;
  gain: GainNode;
  raf: number;
}

function fmtSize(bytes: number): string {
  return bytes < 102400 ? `${(bytes / 1024).toFixed(1)} КБ` : `${(bytes / 1024 / 1024).toFixed(2)} МБ`;
}

export default function App() {
  const [source, setSource] = useState<SourceAudio | null>(null);
  const [midiFile, setMidiFile] = useState<MidiFileData | null>(null);
  const [midiOpts, setMidiOpts] = useState<MidiOpts>({ ...DEFAULT_MIDI_OPTS });
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [params, setParams] = useState<AnalysisParams>({ ...DEFAULT_PARAMS });
  const [usedParams, setUsedParams] = useState<AnalysisParams>({ ...DEFAULT_PARAMS });
  const [sketch, setSketch] = useState<SketchOpts>({ title: "my_melody", pin: 8, style: "progmem" });
  const [presetId, setPresetId] = useState<string | null>("full");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [res, setRes] = useState<AnalysisResult | null>(null);
  const [playMs, setPlayMs] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  const playerRef = useRef<Player | null>(null);
  const logIdRef = useRef(0);
  const baseTsRef = useRef(0);

  const kind: "audio" | "midi" | null = midiFile ? "midi" : source ? "audio" : null;

  /* ---------------- лог ---------------- */

  const pushLog: LogFn = useCallback((msg, logKind = "info") => {
    const t = ((performance.now() - baseTsRef.current) / 1000).toFixed(2);
    setLogs((prev) => [...prev.slice(-90), { id: ++logIdRef.current, t, msg, kind: logKind }]);
  }, []);

  const resetLogs = useCallback(() => {
    baseTsRef.current = performance.now();
    logIdRef.current = 0;
    setLogs([]);
  }, []);

  /* ---------------- плеер ---------------- */

  const stopPlayback = useCallback((resetCursor = true) => {
    const p = playerRef.current;
    if (p) {
      cancelAnimationFrame(p.raf);
      try {
        p.osc.stop();
      } catch {
        /* уже остановлен */
      }
      try {
        p.osc.disconnect();
        p.gain.disconnect();
      } catch {
        /* ок */
      }
      void p.ctx.close().catch(() => undefined);
      playerRef.current = null;
    }
    setPlaying(false);
    if (resetCursor) setPlayMs(null);
  }, []);

  const resRef = useRef<AnalysisResult | null>(null);
  resRef.current = res;

  const playFrom = useCallback(
    (ms: number) => {
      const r = resRef.current;
      if (!r || r.voicedCount === 0) return;
      stopPlayback(false);
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.type = "square";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const t0 = ctx.currentTime + 0.09;
      let acc = 0;
      for (const e of r.notes) {
        const st = acc;
        const en = acc + e.durationMs;
        if (en > ms) {
          const tt = t0 + (Math.max(st, ms) - ms) / 1000;
          if (e.freq > 0) {
            osc.frequency.setValueAtTime(Math.max(31, e.freq), tt);
            gain.gain.setValueAtTime(0.14, tt);
          } else {
            gain.gain.setValueAtTime(0, tt);
          }
        }
        acc = en;
      }
      const total = r.totalMs;
      osc.start(t0);
      osc.stop(t0 + (total - ms) / 1000 + 0.05);

      const tick = () => {
        const nowMs = (ctx.currentTime - t0) * 1000 + ms;
        if (nowMs >= total) {
          stopPlayback(true);
          return;
        }
        setPlayMs(nowMs);
        const cur = playerRef.current;
        if (cur) cur.raf = requestAnimationFrame(tick);
      };
      playerRef.current = { ctx, osc, gain, raf: requestAnimationFrame(tick) };
      setPlaying(true);
      setPlayMs(ms);
    },
    [stopPlayback],
  );

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const handleSeek = useCallback(
    (ms: number) => {
      if (playing) playFrom(ms);
      else setPlayMs(ms);
    },
    [playing, playFrom],
  );

  /* ---------------- конвертация ---------------- */

  const runConvert = useCallback(
    async (overrides?: { src?: SourceAudio; midi?: MidiFileData; params?: AnalysisParams; midiOpts?: MidiOpts }) => {
      const src = overrides?.src ?? source;
      const md = overrides?.midi ?? midiFile;
      const p = overrides?.params ?? params;
      const mo = overrides?.midiOpts ?? midiOpts;
      stopPlayback();

      if (md) {
        /* MIDI — мгновенная сборка, логи не чистим (там сведения о парсинге) */
        try {
          pushLog(`сборка мелодии · ${mo.poly === "top" ? "верхний голос" : "нижний голос"}`);
          const r = convertMidi(md, p, mo, pushLog);
          setRes(r);
          setUsedParams({ ...p, quantize: true });
        } catch (e) {
          pushLog(e instanceof Error ? e.message : String(e), "err");
          setRes(null);
        }
        return;
      }

      if (!src) return;
      setBusy(true);
      setProgress(0);
      resetLogs();
      pushLog(`запуск анализа «${src.name}»`);
      if (p.transpose !== 0) pushLog(`транспозиция ${p.transpose > 0 ? "+" : ""}${p.transpose} полутонов`);
      try {
        const r = await analyze(src, p, (pct) => setProgress(Math.round(pct * 100)), pushLog);
        setRes(r);
        setUsedParams({ ...p });
      } catch (e) {
        pushLog(e instanceof Error ? e.message : String(e), "err");
        setRes(null);
      } finally {
        setBusy(false);
      }
    },
    [source, midiFile, params, midiOpts, pushLog, resetLogs, stopPlayback],
  );

  /* авто-пересборка при изменении MIDI-настроек и релевантных параметров */
  const midiFxKey = `${params.transpose}|${params.speed}|${params.minNoteMs}|${params.limitSec}|${params.minFreq}|${params.maxFreq}|${midiOpts.track}|${midiOpts.poly}`;
  const midiFxRef = useRef(midiFxKey);
  useEffect(() => {
    if (!midiFile) {
      midiFxRef.current = midiFxKey;
      return;
    }
    if (midiFxRef.current === midiFxKey) return;
    midiFxRef.current = midiFxKey;
    const id = window.setTimeout(() => void runConvert(), 200);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midiFxKey, midiFile, runConvert]);

  /* ---------------- файлы ---------------- */

  const handleFile = useCallback(
    async (f: File) => {
      if (busy) return;
      stopPlayback();
      setBusy(true);
      setRes(null);
      resetLogs();

      let isMidi = /\.midi?$/i.test(f.name);
      try {
        if (!isMidi) {
          const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
          isMidi = head[0] === 0x4d && head[1] === 0x54 && head[2] === 0x68 && head[3] === 0x64; // "MThd"
        }
      } catch {
        /* считаем аудио */
      }

      if (isMidi) {
        pushLog(`парсинг MIDI «${f.name}»…`);
        try {
          const buf = await f.arrayBuffer();
          const md = parseMidi(buf, f.name);
          setMidiFile(md);
          setSource(null);
          setFileSize(f.size);
          setSketch((s) => ({ ...s, title: sanitizeName(f.name) }));
          pushLog(
            `формат ${md.format} · ${md.trackCount} дорожек · ${
              md.ticksPerQuarter > 0 ? `${md.ticksPerQuarter} тик/четверть` : `SMPTE ${md.smpteTicksPerSec} тик/с`
            }`,
            "ok",
          );
          if (md.tempoCount > 0)
            pushLog(`темп: ~${md.startBpm} BPM${md.tempoCount > 1 ? ` · ${md.tempoCount} изменений` : ""}`, "info");
          if (md.notes.length === 0) {
            pushLog("в файле нет нот — конвертировать нечего", "err");
          } else {
            pushLog(
              `${md.notes.length} нот · ${formatClock(md.durationMs)} · диапазон ${midiToName(md.minMidi)}–${midiToName(md.maxMidi)}`,
              "ok",
            );
          }
          setBusy(false);
          midiFxRef.current = ""; // форсируем первичную конвертацию через эффект
        } catch (e) {
          pushLog(e instanceof Error ? e.message : "не удалось разобрать MIDI-файл", "err");
          setMidiFile(null);
          setBusy(false);
        }
        return;
      }

      pushLog(`декодирование «${f.name}»…`);
      try {
        const src = await decodeToSource(f, f.name);
        setSource(src);
        setMidiFile(null);
        setFileSize(f.size);
        setSketch((s) => ({ ...s, title: sanitizeName(f.name) }));
        pushLog(`${src.duration.toFixed(1)} с · ${src.sampleRate} Гц · моно-микс готов`, "ok");
        setBusy(false);
        void runConvert({ src, params });
      } catch {
        pushLog("не удалось декодировать файл — попробуй mp3 / wav / ogg / mid", "err");
        setBusy(false);
      }
    },
    [busy, params, pushLog, resetLogs, runConvert, stopPlayback],
  );

  const handleDemo = useCallback(() => {
    if (busy) return;
    void handleFile(createDemoFile());
  }, [busy, handleFile]);

  const handleDemoMidi = useCallback(() => {
    if (busy) return;
    void handleFile(createDemoMidiFile());
  }, [busy, handleFile]);

  /* ---------------- код ---------------- */

  const code = useMemo(() => (res ? generateSketch(res, usedParams, sketch) : ""), [res, usedParams, sketch]);
  const codeLines = useMemo(() => (code ? code.split("\n").length : 0), [code]);
  const codeBytes = useMemo(() => (code ? new Blob([code]).size : 0), [code]);

  const copyCode = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [code]);

  const downloadCode = useCallback(() => {
    if (!code) return;
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sketch.title || "melody"}.ino`;
    a.click();
    URL.revokeObjectURL(url);
  }, [code, sketch.title]);

  /* ---------------- helpers ---------------- */

  const patchParams = (patch: Partial<AnalysisParams>) => {
    setPresetId(null);
    setParams((p) => {
      const next = { ...p, ...patch };
      if (next.minFreq > next.maxFreq - 200) {
        if (patch.minFreq !== undefined) next.maxFreq = Math.min(4500, next.minFreq + 200);
        else next.minFreq = Math.max(30, next.maxFreq - 200);
      }
      return next;
    });
  };

  const analyzedSec =
    kind === "audio" && source
      ? params.limitSec > 0
        ? Math.min(params.limitSec, source.duration)
        : source.duration
      : 0;

  const fileInfo: SourceFileInfo | null = midiFile
    ? {
        name: midiFile.name,
        kind: "midi",
        subtitle: `${formatClock(midiFile.durationMs)}${fileSize ? ` · ${fmtSize(fileSize)}` : ""} · ${
          midiFile.trackCount
        } дор. · ${midiFile.notes.length} нот`,
      }
    : source
      ? {
          name: source.name,
          kind: "audio",
          subtitle: `${formatClock(source.duration * 1000)}${fileSize ? ` · ${fmtSize(fileSize)}` : ""} · ${
            source.sampleRate
          } Гц`,
        }
      : null;

  const rollLo =
    kind === "midi" && res && res.freqMin > 0 ? res.freqMin * 0.94 : params.minFreq * 0.9;
  const rollHi =
    kind === "midi" && res && res.freqMax > 0
      ? res.freqMax * 1.06
      : Math.max(params.maxFreq * 1.1, (res?.freqMax ?? 0) * 1.15);

  /* ================================ UI ================================ */

  return (
    <div className="grain relative min-h-screen">
      <Background />

      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-50 border-b border-line/70 bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-lime/40 bg-lime/10 text-lime">
            <AudioWaveform size={18} strokeWidth={2} />
          </span>
          <span className="font-mono text-[15px] font-bold tracking-tight text-fog">
            music<span className="text-lime">2</span>arduino
          </span>
          <span className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-dim sm:inline">v1.1</span>
          <nav className="ml-auto flex items-center gap-1 font-mono text-[12px]">
            <a href="#studio" className="rounded-lg px-3 py-1.5 text-dim transition hover:bg-neon/10 hover:text-neon">
              студия
            </a>
            <a href="#how" className="rounded-lg px-3 py-1.5 text-dim transition hover:bg-neon/10 hover:text-neon">
              как это работает
            </a>
            <a
              href="#studio"
              className="clip-tag ml-2 hidden items-center gap-1.5 bg-lime px-3.5 py-1.5 font-semibold text-ink transition hover:bg-neon sm:flex"
            >
              <Zap size={13} strokeWidth={2.4} />
              конверт
            </a>
          </nav>
        </div>
      </header>

      {/* ---------------- hero ---------------- */}
      <section className="bg-grid relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:pb-24 lg:pt-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-neon/30 bg-neon/[0.06] px-3.5 py-1.5 font-mono text-[11px] text-neon">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neon" />
              mp3 / midi → tone() → пассивный зуммер
            </p>
            <h1 className="font-display text-[clamp(34px,6.5vw,74px)] font-extrabold leading-[1.02] tracking-tight">
              МУЗЫКА
              <br />
              <span className="bg-gradient-to-r from-neon via-lime to-neon bg-clip-text text-transparent text-glow-neon">
                В&nbsp;БИПЫ
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-dim">
              Загрузи MP3 — движок вытащит мелодию автокорреляционным анализом питча — или <span className="font-mono text-[13px] text-fog">.mid</span>:
              ноты будут считаны напрямую с дорожек по карте темпа. На выходе — готовый{" "}
              <span className="font-mono text-[13px] text-fog">.ino</span>-скетч.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#studio"
                className="clip-tag group flex items-center gap-2 bg-lime px-6 py-3.5 font-mono text-[13px] font-bold text-ink transition-all hover:bg-neon"
              >
                <Zap size={16} strokeWidth={2.4} className="transition-transform group-hover:rotate-12" />
                загрузить файл
              </a>
              <button
                onClick={handleDemo}
                className="clip-tag flex items-center gap-2 border border-line bg-panel px-6 py-3.5 font-mono text-[13px] text-fog transition hover:border-lime/50 hover:text-lime"
              >
                <Play size={15} />
                демо-мелодия
              </button>
            </div>
            <div className="mt-9 flex flex-wrap gap-2 font-mono text-[10.5px] text-dim">
              {["анализ в браузере, без серверов", "MIDI-парсер SMF 0/1", "tone() / PROGMEM", "предпрослушка бипером"].map((t) => (
                <span key={t} className="rounded-full border border-line px-3 py-1">
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* декоративная карточка со скетчем */}
          <div className="relative hidden lg:block">
            <div className="anim-floaty relative mx-auto max-w-sm rotate-2 rounded-2xl border border-line bg-panel/90 shadow-[0_30px_80px_-20px_rgba(85,240,255,0.15)]" style={{ "--rot": "2deg" } as React.CSSProperties}>
              <div className="flex items-center gap-2 border-b border-line/70 px-4 py-3">
                <span className="flex gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-full bg-rose/70" />
                  <i className="h-2.5 w-2.5 rounded-full bg-amber/70" />
                  <i className="h-2.5 w-2.5 rounded-full bg-lime/70" />
                </span>
                <span className="ml-1 font-mono text-[10.5px] text-dim">korobeiniki.ino</span>
                <Cpu size={13} className="ml-auto text-lime" />
              </div>
              <pre className="px-5 py-4 font-mono text-[12px] leading-[1.9]">
                <span className="tok-pre">#define</span> <span className="text-fog">BUZZER_PIN</span>{" "}
                <span className="tok-num">8</span>
                {"\n"}
                <span className="tok-kw">void</span> <span className="tok-fn">loop</span>
                <span className="text-fog">() {"{"}</span>
                {"\n  "}
                <span className="tok-fn">tone</span>
                <span className="text-fog">(BUZZER_PIN, </span>
                <span className="tok-num">659</span>
                <span className="text-fog">, </span>
                <span className="tok-num">342</span>
                <span className="text-fog">);</span> <span className="tok-com">// E5</span>
                {"\n  "}
                <span className="tok-fn">delay</span>
                <span className="text-fog">(</span>
                <span className="tok-num">380</span>
                <span className="text-fog">);</span>
                {"\n  "}
                <span className="tok-fn">tone</span>
                <span className="text-fog">(BUZZER_PIN, </span>
                <span className="tok-num">494</span>
                <span className="text-fog">, </span>
                <span className="tok-num">171</span>
                <span className="text-fog">);</span> <span className="tok-com">// B4</span>
                {"\n  "}
                <span className="tok-fn">delay</span>
                <span className="text-fog">(</span>
                <span className="tok-num">190</span>
                <span className="text-fog">);</span>
                {"\n"}
                <span className="text-fog">{"}"}</span>
              </pre>
              <div className="flex items-center gap-2 border-t border-line/70 px-4 py-2.5 font-mono text-[10px] text-dim">
                <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                компилируется · 1242 байт · ATmega328P
              </div>
            </div>
            <div
              className="anim-floaty absolute -bottom-8 -left-4 rounded-xl border border-lime/40 bg-ink/90 px-4 py-3 backdrop-blur"
              style={{ animationDelay: "-3s" }}
            >
              <p className="font-mono text-[10px] text-dim">сейчас играет</p>
              <p className="mt-0.5 flex items-center gap-2 font-mono text-[12px] text-lime">
                <Activity size={13} className="animate-pulse" />
                square wave · 659 Гц
              </p>
            </div>
          </div>
        </div>

        {/* marquee */}
        <div className="border-y border-line/70 bg-panel/60 py-3 backdrop-blur-sm">
          <div className="flex overflow-hidden">
            <div className="anim-marquee flex flex-none items-center gap-8 pr-8">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={i} className="flex items-center gap-8 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.25em] text-dim">
                  {m}
                  <Asterisk size={13} className="text-lime/70" />
                </span>
              ))}
            </div>
            <div className="anim-marquee flex flex-none items-center gap-8 pr-8" aria-hidden>
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={i} className="flex items-center gap-8 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.25em] text-dim">
                  {m}
                  <Asterisk size={13} className="text-lime/70" />
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- studio ---------------- */}
      <section id="studio" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-14 sm:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-neon">{"// студия конвертации"}</p>
        <h2 className="mt-2 font-display text-[clamp(24px,3.4vw,40px)] font-bold tracking-tight">КОНВЕРТЕР</h2>

        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
          {/* -------- левая колонка: настройки -------- */}
          <div className="flex flex-col gap-5">
            <PanelCard icon={Music2} step="шаг 01" title="источник">
              <Dropzone fileInfo={fileInfo} busy={busy} onFile={handleFile} onDemo={handleDemo} onDemoMidi={handleDemoMidi} />
              <div className="mt-4">
                <label className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] text-fog">объём анализа</span>
                </label>
                <span className="relative block">
                  <select
                    value={params.limitSec}
                    onChange={(e) => patchParams({ limitSec: Number(e.target.value) })}
                    className="w-full appearance-none rounded-lg border border-line bg-panel2 px-3 py-2 pr-8 font-mono text-[12px] text-fog outline-none transition focus:border-neon/60"
                  >
                    {LIMIT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={13}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim"
                  />
                </span>
              </div>
            </PanelCard>

            <PanelCard
              icon={kind === "midi" ? ListMusic : SlidersHorizontal}
              step="шаг 02"
              title={kind === "midi" ? "midi-разбор" : "анализ питча"}
            >
              {kind === "midi" && midiFile && (
                <div className="mb-4 flex flex-col gap-4">
                  <div>
                    <label className="mb-1.5 block font-mono text-[12px] text-fog">источник мелодии</label>
                    <span className="relative block">
                      <select
                        value={midiOpts.track}
                        onChange={(e) => setMidiOpts((mo) => ({ ...mo, track: Number(e.target.value) }))}
                        className="w-full appearance-none rounded-lg border border-line bg-panel2 px-3 py-2 pr-8 font-mono text-[11.5px] text-fog outline-none transition focus:border-neon/60"
                      >
                        <option value={-1}>авто: самая насыщенная дорожка</option>
                        {midiFile.tracks
                          .filter((t) => t.noteCount > 0)
                          .map((t) => (
                            <option key={t.index} value={t.index}>
                              #{t.index + 1} {t.name || "дорожка"} · {t.noteCount} нот · {midiToName(t.minMidi)}–
                              {midiToName(t.maxMidi)}
                            </option>
                          ))}
                      </select>
                      <ChevronDown
                        size={13}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim"
                      />
                    </span>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[12px] text-fog">
                      полифония <span className="ml-1 text-[10.5px] text-dim">аккорд → одна нота</span>
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-panel2 p-1.5">
                      {(
                        [
                          { id: "top", label: "верхний голос" },
                          { id: "bottom", label: "нижний голос" },
                        ] as const
                      ).map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setMidiOpts((mo) => ({ ...mo, poly: s.id }))}
                          className={`rounded-lg px-2 py-2 font-mono text-[10.5px] transition ${
                            midiOpts.poly === s.id ? "bg-lime/15 text-lime" : "text-dim hover:text-fog"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="rounded-lg border border-line/70 bg-panel2/50 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-dim">
                    тики переведены в миллисекунды по карте темпа{midiFile.tempoCount > 0 ? ` (~${midiFile.startBpm} BPM)` : ""}.
                    чувствительность и шаг анализа для MIDI не нужны.
                  </p>
                </div>
              )}

              {kind !== "midi" && (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-1.5">
                    {PRESETS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPresetId(p.id);
                          setParams((prev) => ({ ...prev, ...p.patch }));
                        }}
                        className={`rounded-lg border px-2.5 py-2 font-mono text-[10.5px] transition ${
                          presetId === p.id
                            ? "border-lime/60 bg-lime/10 text-lime"
                            : "border-line bg-panel2 text-dim hover:border-neon/40 hover:text-neon"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="mb-4 flex flex-col gap-4">
                    <SliderRow
                      label="разрешение по времени"
                      hint="шаг анализа"
                      min={30}
                      max={150}
                      step={5}
                      value={params.frameMs}
                      format={(v) => `${v} мс`}
                      onChange={(v) => patchParams({ frameMs: v })}
                    />
                    <SliderRow
                      label="чувствительность"
                      hint="порог громкости"
                      min={0}
                      max={100}
                      step={1}
                      value={params.sensitivity}
                      format={(v) => `${v}%`}
                      onChange={(v) => patchParams({ sensitivity: v })}
                    />
                  </div>
                </>
              )}

              <div className="flex flex-col gap-4">
                <SliderRow
                  label="мин. частота"
                  hint="нижняя граница"
                  min={30}
                  max={500}
                  step={10}
                  value={params.minFreq}
                  format={(v) => `${v} Гц`}
                  onChange={(v) => patchParams({ minFreq: v })}
                />
                <SliderRow
                  label="макс. частота"
                  hint="верхняя граница"
                  min={800}
                  max={4500}
                  step={50}
                  value={params.maxFreq}
                  format={(v) => `${v} Гц`}
                  onChange={(v) => patchParams({ maxFreq: v })}
                />
                <SliderRow
                  label="мин. длина ноты"
                  hint="анти-дребезг"
                  min={40}
                  max={300}
                  step={10}
                  value={params.minNoteMs}
                  format={(v) => `${v} мс`}
                  onChange={(v) => patchParams({ minNoteMs: v })}
                />
              </div>
            </PanelCard>

            <PanelCard icon={Wand2} step="шаг 03" title="обработка">
              <div className="flex flex-col gap-4">
                <SliderRow
                  label="скорость воспроизведения"
                  hint="делит длительности"
                  min={0.25}
                  max={3}
                  step={0.05}
                  value={params.speed}
                  format={(v) => `${v.toFixed(2)}×`}
                  onChange={(v) => patchParams({ speed: v })}
                />
                <SliderRow
                  label="транспозиция"
                  hint="сдвиг тональности"
                  min={-24}
                  max={24}
                  step={1}
                  value={params.transpose}
                  format={(v) => `${v > 0 ? "+" : ""}${v} ст`}
                  onChange={(v) => patchParams({ transpose: v })}
                />
                {kind === "midi" ? (
                  <SwitchRow
                    label="квантование к полутонам"
                    hint="midi-ноты уже строго по полутонам — всегда включено"
                    checked={true}
                    disabled
                    onChange={() => undefined}
                  />
                ) : (
                  <SwitchRow
                    label="квантование к полутонам"
                    hint="привязка частот к нотам — ровный «чиптюнный» звук"
                    checked={params.quantize}
                    onChange={(v) => patchParams({ quantize: v })}
                  />
                )}
              </div>
            </PanelCard>

            <PanelCard icon={Cpu} step="шаг 04" title="скетч">
              <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-panel2 p-1.5">
                {(
                  [
                    { id: "simple", label: "tone() построчно" },
                    { id: "progmem", label: "PROGMEM-массивы" },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSketch((sk) => ({ ...sk, style: s.id }))}
                    className={`rounded-lg px-2 py-2 font-mono text-[10.5px] transition ${
                      sketch.style === s.id ? "bg-neon/15 text-neon" : "text-dim hover:text-fog"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block font-mono text-[12px] text-fog">пин зуммера</span>
                  <input
                    type="number"
                    min={2}
                    max={13}
                    value={sketch.pin}
                    onChange={(e) =>
                      setSketch((sk) => ({ ...sk, pin: Math.max(2, Math.min(13, Number(e.target.value) || 8)) }))
                    }
                    className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-[12px] text-fog outline-none transition focus:border-neon/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block font-mono text-[12px] text-fog">имя скетча</span>
                  <input
                    type="text"
                    value={sketch.title}
                    onChange={(e) => setSketch((sk) => ({ ...sk, title: sanitizeName(e.target.value) || sk.title }))}
                    className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-[12px] text-fog outline-none transition focus:border-neon/60"
                  />
                </label>
              </div>
            </PanelCard>

            <button
              onClick={() => void runConvert()}
              disabled={!kind || busy}
              className={`clip-tag group flex items-center justify-center gap-2.5 px-6 py-4 font-mono text-[14px] font-bold tracking-wide transition-all ${
                !kind || busy
                  ? "cursor-not-allowed bg-panel2 text-dim"
                  : "anim-pulse-ring bg-lime text-ink hover:bg-neon"
              }`}
            >
              {busy ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  анализ… {progress}%
                </>
              ) : (
                <>
                  <Zap size={17} strokeWidth={2.4} className="transition-transform group-hover:rotate-12" />
                  {kind === "midi" ? "пересобрать .ino" : kind === "audio" ? "конвертировать в .ino" : "сначала загрузи файл"}
                </>
              )}
            </button>
          </div>

          {/* -------- правая колонка: результаты -------- */}
          <div className="flex min-w-0 flex-col gap-5">
            <Terminal lines={logs} />

            {busy && (
              <div className="overflow-hidden rounded-xl border border-neon/30 bg-panel">
                <div
                  className="h-1.5 bg-gradient-to-r from-neon to-lime transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
                <p className="px-4 py-2.5 font-mono text-[11px] text-neon">идёт детект питча… {progress}%</p>
              </div>
            )}

            {!res && !busy && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line px-6 py-16 text-center">
                <Music2 size={28} className="text-dim/60" strokeWidth={1.4} />
                <p className="font-mono text-[13px] text-dim">
                  {kind ? "жми кнопку конвертации, чтобы построить мелодию" : "здесь появится твоя мелодия"}
                </p>
                <p className="max-w-sm text-[12px] leading-relaxed text-dim/70">
                  загрузи mp3 или midi (или запусти демо) → получишь ноты, пиано-ролл с предпрослушкой и готовый
                  скетч
                </p>
              </div>
            )}

            {res && res.voicedCount === 0 && !busy && (
              <div className="rounded-2xl border border-amber/40 bg-amber/[0.06] px-5 py-5">
                <p className="flex items-center gap-2 font-mono text-[13px] text-amber">
                  <TriangleAlert size={15} />
                  мелодия не найдена
                </p>
                <ul className="mt-3 flex flex-col gap-1.5 font-mono text-[11.5px] leading-relaxed text-dim">
                  {kind === "midi" ? (
                    <>
                      <li>· выбери другую дорожку в «источнике мелодии»</li>
                      <li>· проверь лимит длительности — MIDI обрезается по времени старта нот</li>
                      <li>· расширь диапазон частот (50–4000 Гц)</li>
                    </>
                  ) : (
                    <>
                      <li>· подними чувствительность до 45–60%</li>
                      <li>· расширь диапазон частот (50–4000 Гц)</li>
                      <li>· для тихих треков выбери лимит «трек целиком»</li>
                    </>
                  )}
                </ul>
              </div>
            )}

            {res && res.voicedCount > 0 && (
              <>
                {/* stats */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { icon: Music2, label: "нот", value: String(res.voicedCount), accent: "text-neon" },
                    { icon: Timer, label: "длительность", value: formatTime(res.totalMs), accent: "text-lime" },
                    {
                      icon: Waves,
                      label: "диапазон",
                      value: `${Math.round(res.freqMin)}–${Math.round(res.freqMax)}`,
                      suffix: "Гц",
                      accent: "text-neon",
                    },
                    {
                      icon: MemoryStick,
                      label: "flash progmem",
                      value:
                        estimateFlash(res) > 1024
                          ? `${(estimateFlash(res) / 1024).toFixed(1)}К`
                          : String(estimateFlash(res)),
                      suffix: "байт",
                      accent: "text-lime",
                    },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-line bg-panel/85 px-4 py-3.5">
                      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                        <s.icon size={12} />
                        {s.label}
                      </p>
                      <p className={`mt-1.5 font-mono text-[19px] font-bold ${s.accent}`}>
                        {s.value}
                        {s.suffix && <span className="ml-1 text-[11px] font-normal text-dim">{s.suffix}</span>}
                      </p>
                    </div>
                  ))}
                </div>

                {/* piano roll + transport */}
                <div className="rounded-2xl border border-line bg-panel/85 p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => (playing ? stopPlayback() : playFrom(playMs ?? 0))}
                      className={`grid h-10 w-10 place-items-center rounded-lg border transition ${
                        playing
                          ? "border-rose/50 bg-rose/10 text-rose"
                          : "border-lime/50 bg-lime/10 text-lime hover:bg-lime/20"
                      }`}
                      title={playing ? "Стоп" : "Слушать как бипер"}
                    >
                      {playing ? <Square size={15} /> : <Play size={16} className="ml-0.5" />}
                    </button>
                    <div className="font-mono text-[13px] text-fog">
                      {formatTime(playMs ?? 0)}
                      <span className="text-dim"> / {formatTime(res.totalMs)}</span>
                    </div>
                    <span className="ml-auto hidden font-mono text-[10.5px] text-dim sm:block">
                      предпрослушка · square wave · клик по роллу = перемотка
                    </span>
                  </div>
                  <PianoRoll
                    notes={res.notes}
                    totalMs={res.totalMs}
                    loFreq={rollLo}
                    hiFreq={rollHi}
                    playMs={playMs}
                    playing={playing}
                    onSeek={handleSeek}
                  />
                </div>

                {/* исходный сигнал — только для аудио */}
                {source && !midiFile && (
                  <div className="rounded-2xl border border-line bg-panel/85 p-4">
                    <p className="mb-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
                      исходный сигнал
                      {analyzedSec < source.duration && (
                        <span className="text-amber/90">анализируется первые {Math.round(analyzedSec)} с</span>
                      )}
                    </p>
                    <WaveCanvas peaks={source.peaks} duration={source.duration} analyzedSec={analyzedSec} />
                  </div>
                )}

                {/* код */}
                <div className="overflow-hidden rounded-2xl border border-line bg-[#080c11]">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3">
                    <FileCode2 size={15} className="text-neon" />
                    <span className="font-mono text-[12.5px] text-fog">{sketch.title || "melody"}.ino</span>
                    <span className="font-mono text-[10.5px] text-dim">
                      {codeLines} строк · {(codeBytes / 1024).toFixed(1)} КБ
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        onClick={copyCode}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] transition ${
                          copied
                            ? "border-lime/60 bg-lime/10 text-lime"
                            : "border-line text-dim hover:border-neon/50 hover:text-neon"
                        }`}
                      >
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                        {copied ? "скопировано" : "копировать"}
                      </button>
                      <button
                        onClick={downloadCode}
                        className="clip-tag flex items-center gap-1.5 bg-lime px-3.5 py-1.5 font-mono text-[11px] font-bold text-ink transition hover:bg-neon"
                      >
                        <Download size={13} strokeWidth={2.4} />
                        .ino
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[520px] overflow-auto px-5 py-4">
                    <CodeBlock code={code} />
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-neon/25 bg-neon/[0.05] px-4 py-3.5">
                  <TriangleAlert size={15} className="mt-0.5 flex-none text-neon" />
                  <p className="font-mono text-[11.5px] leading-relaxed text-dim">
                    <span className="text-neon">важно:</span> нужен <span className="text-fog">пассивный</span> зуммер
                    (пьезоизлучатель). Подключение: (+) → D{sketch.pin}, (−) → GND. Резистор 100 Ω последовательно —
                    по желанию, для тишины и щадящего режима пина.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section id="how" className="border-t border-line/70 bg-panel/40">
        <div className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-lime">{"// под капотом"}</p>
          <h2 className="mt-2 font-display text-[clamp(24px,3.4vw,40px)] font-bold tracking-tight">
            КАК ЭТО РАБОТАЕТ
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                n: "01",
                icon: Music2,
                title: "Декодирование",
                text: "MP3 раскодируется через Web Audio API и сводится в моно. MIDI разбирается бинарным SMF-парсером: дорожки, note on/off и карта темпов — тики переводятся в миллисекунды.",
                tags: ["decodeAudioData", "SMF 0/1", "tempo map"],
              },
              {
                n: "02",
                icon: Activity,
                title: "Выделение мелодии",
                text: "Аудио-кадры проходят автокорреляцию с уточнением частоты. Из MIDI аккордов выбирается верхний или нижний голос — бипер монофоничен, ему нужна одна линия.",
                tags: ["autocorrelation", "top voice", "rms gate"],
              },
              {
                n: "03",
                icon: FileCode2,
                title: "Генерация скетча",
                text: "Ноты склеиваются, фильтруются по длительности, масштабируются по скорости — и упаковываются в tone()-строки или PROGMEM-массивы.",
                tags: ["tone(pin, f, dur)", "pgm_read_word", "uint16_t"],
              },
            ].map((c) => (
              <article
                key={c.n}
                className="group relative overflow-hidden rounded-2xl border border-line bg-panel/85 p-6 transition hover:border-neon/40"
              >
                <span className="pointer-events-none absolute -right-3 -top-6 font-display text-[92px] font-extrabold leading-none text-line/60 transition group-hover:text-neon/10">
                  {c.n}
                </span>
                <span className="relative grid h-11 w-11 place-items-center rounded-xl border border-neon/25 bg-neon/[0.07] text-neon">
                  <c.icon size={20} strokeWidth={1.7} />
                </span>
                <h3 className="relative mt-5 font-display text-[16px] font-semibold tracking-wide">{c.title}</h3>
                <p className="relative mt-2.5 text-[13px] leading-relaxed text-dim">{c.text}</p>
                <div className="relative mt-4 flex flex-wrap gap-1.5">
                  {c.tags.map((t) => (
                    <span key={t} className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-dim">
                      {t}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- footer ---------------- */}
      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-7 font-mono text-[11px] text-dim sm:flex-row sm:px-6">
          <span className="flex items-center gap-2">
            <AudioWaveform size={13} className="text-lime" />
            music2arduino — конвертер мелодий для пассивного зуммера
          </span>
          <span>
            <span className="text-neon">tone</span>(8, 440, 500); <span className="text-dim/60">// ля первой октавы</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
