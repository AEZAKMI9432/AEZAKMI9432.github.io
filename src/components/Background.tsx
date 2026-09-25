import { useEffect, useRef } from "react";

/** Анимированный фон: слоистые бегущие волны + мерцающие «ноты»-точки. */
export function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      cvs.width = w * dpr;
      cvs.height = h * dpr;
      cvs.style.width = `${w}px`;
      cvs.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    interface Dot {
      x: number;
      y: number;
      ph: number;
      sp: number;
      c: string;
    }
    const dots: Dot[] = Array.from({ length: 46 }, () => ({
      x: Math.random(),
      y: Math.random(),
      ph: Math.random() * Math.PI * 2,
      sp: 0.4 + Math.random() * 0.9,
      c: Math.random() > 0.5 ? "85,240,255" : "200,255,79",
    }));

    const waves = [
      { amp: 46, freq: 0.006, speed: 0.00042, y: 0.62, col: "85,240,255", alpha: 0.1 },
      { amp: 30, freq: 0.011, speed: 0.0006, y: 0.68, col: "200,255,79", alpha: 0.07 },
      { amp: 64, freq: 0.004, speed: 0.0003, y: 0.58, col: "85,240,255", alpha: 0.05 },
    ];

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      for (const wv of waves) {
        ctx.beginPath();
        const baseY = h * wv.y;
        for (let x = 0; x <= w; x += 4) {
          const y =
            baseY +
            Math.sin(x * wv.freq + t * wv.speed * 1000 * 0.06) * wv.amp +
            Math.sin(x * wv.freq * 2.7 + t * wv.speed * 1000 * 0.11) * wv.amp * 0.35;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${wv.col},${wv.alpha})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      for (const d of dots) {
        const tw = 0.5 + 0.5 * Math.sin(d.ph + t * 0.001 * d.sp);
        const x = d.x * w;
        const y = d.y * h * 0.9;
        ctx.fillStyle = `rgba(${d.c},${0.05 + tw * 0.16})`;
        ctx.fillRect(x, y, 2, 2);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 -z-10" aria-hidden />;
}
