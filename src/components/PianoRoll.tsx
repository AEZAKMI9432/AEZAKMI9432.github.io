import { useEffect, useMemo, useRef } from "react";
import { NoteEvent, freqToMidi, midiToFreq, midiToName } from "../lib/music";

interface Props {
  notes: NoteEvent[];
  totalMs: number;
  loFreq: number;
  hiFreq: number;
  playMs: number | null;
  playing: boolean;
  onSeek: (ms: number) => void;
}

const PX_PER_SEC = 130;
const LABEL_W = 44;
const H = 250;

export function PianoRoll({ notes, totalMs, loFreq, hiFreq, playMs, playing, onSeek }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);

  const contentW = Math.max(600, Math.ceil((totalMs / 1000) * PX_PER_SEC) + 40);

  const yFor = useMemo(() => {
    const lo = Math.log2(loFreq);
    const hi = Math.log2(hiFreq);
    return (f: number) => {
      const t = (Math.log2(Math.max(loFreq, Math.min(hiFreq, f))) - lo) / (hi - lo);
      return H - 14 - t * (H - 34);
    };
  }, [loFreq, hiFreq]);

  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const label = labelRef.current;
    const main = mainRef.current;
    if (!label || !main) return;

    label.width = LABEL_W * dpr;
    label.height = H * dpr;
    label.style.width = `${LABEL_W}px`;
    label.style.height = `${H}px`;
    main.width = contentW * dpr;
    main.height = H * dpr;
    main.style.width = `${contentW}px`;
    main.style.height = `${H}px`;

    const lctx = label.getContext("2d");
    const ctx = main.getContext("2d");
    if (!lctx || !ctx) return;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* ---- фон + сетка ---- */
    ctx.clearRect(0, 0, contentW, H);
    lctx.clearRect(0, 0, LABEL_W, H);
    lctx.fillStyle = "#0b1016";
    lctx.fillRect(0, 0, LABEL_W, H);

    const loMidi = Math.floor(freqToMidi(loFreq));
    const hiMidi = Math.ceil(freqToMidi(hiFreq));
    for (let m = loMidi; m <= hiMidi; m++) {
      if (m % 12 !== 0 && m % 12 !== 7) continue;
      const y = yFor(midiToFreq(m));
      const isC = m % 12 === 0;
      ctx.strokeStyle = isC ? "rgba(85,240,255,0.16)" : "rgba(140,170,190,0.06)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(contentW, y);
      ctx.stroke();
      if (isC) {
        lctx.fillStyle = "rgba(85,240,255,0.75)";
        lctx.font = "9px 'JetBrains Mono', monospace";
        lctx.textBaseline = "middle";
        lctx.fillText(midiToName(m), 4, y);
      }
    }

    const totalSec = totalMs / 1000;
    for (let s = 0; s <= totalSec; s++) {
      const x = s * PX_PER_SEC;
      if (isNaN(x) || x > contentW) break;
      const major = s % 5 === 0;
      ctx.strokeStyle = major ? "rgba(140,170,190,0.14)" : "rgba(140,170,190,0.05)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(135,160,172,0.7)";
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.textBaseline = "top";
        ctx.fillText(`0:${String(s).padStart(2, "0")}`, x + 4, 2);
      }
    }

    /* ---- ноты ---- */
    let acc = 0;
    const lo = { r: 85, g: 240, b: 255 };
    const hi = { r: 200, g: 255, b: 79 };
    for (const n of notes) {
      const x = (acc / 1000) * PX_PER_SEC;
      const w = Math.max(2, (n.durationMs / 1000) * PX_PER_SEC - 1.5);
      acc += n.durationMs;
      if (n.freq <= 0) continue;
      const y = yFor(n.freq);
      const t = 1 - (y - 20) / (H - 34);
      const r = Math.round(lo.r + (hi.r - lo.r) * t);
      const g = Math.round(lo.g + (hi.g - lo.g) * t);
      const b = Math.round(lo.b + (hi.b - lo.b) * t);
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.shadowColor = `rgba(${r},${g},${b},0.55)`;
      ctx.shadowBlur = 6;
      const hgt = 9;
      const ry = y - hgt / 2;
      const rad = Math.min(4, w / 2, hgt / 2);
      ctx.beginPath();
      ctx.moveTo(x + rad, ry);
      ctx.lineTo(x + w - rad, ry);
      ctx.arcTo(x + w, ry, x + w, ry + rad, rad);
      ctx.lineTo(x + w, ry + hgt - rad);
      ctx.arcTo(x + w, ry + hgt, x + w - rad, ry + hgt, rad);
      ctx.lineTo(x + rad, ry + hgt);
      ctx.arcTo(x, ry + hgt, x, ry + hgt - rad, rad);
      ctx.lineTo(x, ry + rad);
      ctx.arcTo(x, ry, x + rad, ry, rad);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    /* ---- курсор ---- */
    if (playMs !== null) {
      const cx = (playMs / 1000) * PX_PER_SEC;
      ctx.strokeStyle = "rgba(200,255,79,0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, H);
      ctx.stroke();
      ctx.fillStyle = "rgba(200,255,79,1)";
      ctx.beginPath();
      ctx.moveTo(cx - 5, 0);
      ctx.lineTo(cx + 5, 0);
      ctx.lineTo(cx, 7);
      ctx.closePath();
      ctx.fill();
    }
  }, [notes, totalMs, contentW, yFor, loFreq, hiFreq, playMs]);

  /* автопрокрутка за курсором */
  useEffect(() => {
    if (!playing || playMs === null) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cx = (playMs / 1000) * PX_PER_SEC + LABEL_W;
    const left = wrap.scrollLeft;
    const viewW = wrap.clientWidth;
    if (cx < left + LABEL_W + 10 || cx > left + viewW - 40) {
      wrap.scrollLeft = Math.max(0, cx - viewW * 0.3);
    }
  }, [playMs, playing]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ms = Math.max(0, Math.min(totalMs, (x / PX_PER_SEC) * 1000));
    onSeek(ms);
  };

  return (
    <div ref={wrapRef} className="overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-panel2/60">
      <div className="relative" style={{ width: LABEL_W + contentW, height: H }}>
        <canvas ref={labelRef} className="sticky left-0 top-0 z-10 inline-block align-top" />
        <canvas
          ref={mainRef}
          onClick={handleClick}
          className="absolute top-0 cursor-crosshair"
          style={{ left: LABEL_W }}
        />
      </div>
    </div>
  );
}
