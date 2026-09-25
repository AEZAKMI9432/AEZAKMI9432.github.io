import { useEffect, useRef } from "react";
import { TerminalSquare } from "lucide-react";
import type { LogKind } from "../lib/pitch";

export interface LogLine {
  id: number;
  t: string;
  msg: string;
  kind: LogKind;
}

const KIND_STYLE: Record<LogKind, { sign: string; cls: string }> = {
  info: { sign: ">", cls: "text-dim" },
  ok: { sign: "+", cls: "text-lime" },
  warn: { sign: "!", cls: "text-amber" },
  err: { sign: "×", cls: "text-rose" },
};

export function Terminal({ lines }: { lines: LogLine[] }) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-[#070b10]">
      <header className="flex items-center gap-2 border-b border-line/70 px-4 py-2.5">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-rose/70" />
          <i className="h-2.5 w-2.5 rounded-full bg-amber/70" />
          <i className="h-2.5 w-2.5 rounded-full bg-lime/70" />
        </span>
        <span className="ml-1 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">
          <TerminalSquare size={12} />
          m2a://анализ-лог
        </span>
      </header>
      <div ref={bodyRef} className="h-[148px] overflow-y-auto px-4 py-3">
        {lines.length === 0 ? (
          <p className="font-mono text-[11.5px] text-dim/70">
            $ ожидание файла
            <span className="anim-blink text-neon">▌</span>
          </p>
        ) : (
          lines.map((l) => {
            const s = KIND_STYLE[l.kind];
            return (
              <p key={l.id} className="flex gap-2 py-px font-mono text-[11.5px] leading-relaxed">
                <span className="flex-none text-dim/50">[{l.t}]</span>
                <span className={`flex-none font-bold ${s.cls}`}>{s.sign}</span>
                <span className={s.cls}>{l.msg}</span>
              </p>
            );
          })
        )}
      </div>
    </section>
  );
}
