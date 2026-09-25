import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { AnalysisParams } from "../lib/pitch";

/* ---------------- PanelCard ---------------- */

interface PanelCardProps {
  icon: LucideIcon;
  step: string;
  title: string;
  children: ReactNode;
  right?: ReactNode;
}

export function PanelCard({ icon: Icon, step, title, children, right }: PanelCardProps) {
  return (
    <section className="rounded-2xl border border-line bg-panel/85 backdrop-blur-sm">
      <header className="flex items-center gap-3 border-b border-line/70 px-5 py-3.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-neon/25 bg-neon/[0.07] text-neon">
          <Icon size={15} strokeWidth={1.8} />
        </span>
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-dim">{step}</p>
          <h3 className="font-display text-[13px] font-semibold tracking-wide text-fog">{title}</h3>
        </div>
        {right}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/* ---------------- SliderRow ---------------- */

interface SliderRowProps {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

export function SliderRow({ label, hint, min, max, step, value, disabled, format, onChange }: SliderRowProps) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className={`block ${disabled ? "opacity-40" : ""}`}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[12px] text-fog">
          {label}
          {hint && <span className="ml-2 text-[10.5px] text-dim">{hint}</span>}
        </span>
        <span className="rounded border border-neon/25 bg-neon/[0.08] px-1.5 py-0.5 font-mono text-[11px] font-medium text-neon">
          {format(value)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/* ---------------- SwitchRow ---------------- */

interface SwitchRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}

export function SwitchRow({ label, hint, checked, disabled, onChange }: SwitchRowProps) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-3 text-left ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span>
        <span className="block font-mono text-[12px] text-fog">{label}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] leading-snug text-dim">{hint}</span>}
      </span>
      <span className="switch" data-on={checked} />
    </button>
  );
}

/* ---------------- Presets ---------------- */

export interface Preset {
  id: string;
  label: string;
  patch: Partial<AnalysisParams>;
}

export const PRESETS: Preset[] = [
  {
    id: "full",
    label: "полный спектр",
    patch: { minFreq: 50, maxFreq: 2200, frameMs: 60, sensitivity: 30, quantize: true },
  },
  {
    id: "vocal",
    label: "вокал / мелодия",
    patch: { minFreq: 90, maxFreq: 1200, frameMs: 55, sensitivity: 24, quantize: true, transpose: 0 },
  },
  {
    id: "bass",
    label: "бас-линия",
    patch: { minFreq: 40, maxFreq: 280, frameMs: 75, sensitivity: 32, quantize: true, minNoteMs: 110 },
  },
  {
    id: "chip",
    label: "8-бит чиптюн",
    patch: { minFreq: 130, maxFreq: 2100, frameMs: 85, sensitivity: 22, quantize: true, minNoteMs: 100 },
  },
];

export const LIMIT_OPTIONS = [
  { value: 30, label: "первые 30 с" },
  { value: 60, label: "первые 60 с" },
  { value: 120, label: "первые 2 мин" },
  { value: 0, label: "трек целиком" },
];
