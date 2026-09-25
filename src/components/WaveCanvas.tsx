import { useEffect, useRef } from "react";

interface Props {
  peaks: number[];
  duration: number;
  /** сколько секунд реально анализируется (лимит) */
  analyzedSec: number;
}

export function WaveCanvas({ peaks, duration, analyzedSec }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cvs.clientWidth;
    const H = 84;
    cvs.width = W * dpr;
    cvs.height = H * dpr;
    cvs.style.height = `${H}px`;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const n = peaks.length;
    const barW = W / n;
    const mid = H / 2;
    const cutIdx = analyzedSec > 0 && analyzedSec < duration ? Math.floor((analyzedSec / duration) * n) : n;

    for (let i = 0; i < n; i++) {
      const v = Math.max(0.02, Math.min(1, peaks[i]));
      const h = v * (H - 14);
      const x = i * barW;
      const active = i < cutIdx;
      const t = i / n;
      const r = Math.round(85 + (200 - 85) * t);
      const g = Math.round(240 + (255 - 240) * t);
      const b = Math.round(255 + (79 - 255) * t);
      ctx.fillStyle = active ? `rgba(${r},${g},${b},0.85)` : "rgba(80,100,115,0.28)";
      ctx.fillRect(x, mid - h / 2, Math.max(1, barW - 0.6), h);
    }

    if (cutIdx < n) {
      const x = cutIdx * barW;
      ctx.strokeStyle = "rgba(255,180,84,0.8)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // линейка времени
    ctx.fillStyle = "rgba(135,160,172,0.75)";
    ctx.font = "8.5px 'JetBrains Mono', monospace";
    ctx.textBaseline = "bottom";
    const step = duration > 120 ? 30 : duration > 40 ? 10 : 5;
    for (let s = 0; s <= duration; s += step) {
      const x = (s / duration) * W;
      ctx.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, x + 3, H - 1);
    }
  }, [peaks, duration, analyzedSec]);

  return <canvas ref={ref} className="w-full rounded-xl border border-line bg-panel2/60" />;
}

export default WaveCanvas;
