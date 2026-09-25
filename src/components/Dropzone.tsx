import { useRef, useState } from "react";
import { FileAudio, FileMusic, FileUp, RefreshCw, Sparkles } from "lucide-react";

export interface SourceFileInfo {
  name: string;
  subtitle: string;
  kind: "audio" | "midi";
}

interface Props {
  fileInfo: SourceFileInfo | null;
  busy: boolean;
  onFile: (f: File) => void;
  onDemo: () => void;
  onDemoMidi: () => void;
}

export function Dropzone({ fileInfo, busy, onFile, onDemo, onDemoMidi }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const pick = () => inputRef.current?.click();

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.mid,.midi"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      {!fileInfo ? (
        <button
          onClick={pick}
          disabled={busy}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className={`group flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-all duration-300 ${
            drag
              ? "border-lime bg-lime/5 scale-[1.01]"
              : "border-line hover:border-neon/60 hover:bg-neon/[0.03]"
          }`}
        >
          <span
            className={`grid h-14 w-14 place-items-center rounded-xl border transition-all duration-300 ${
              drag ? "border-lime text-lime" : "border-line text-dim group-hover:border-neon/50 group-hover:text-neon"
            }`}
          >
            <FileUp size={24} strokeWidth={1.6} />
          </span>
          <span className="font-mono text-[13px] leading-relaxed text-fog">
            {drag ? "// отпускай, сконвертируем" : "// перетащи файл сюда"}
            <br />
            <span className="text-dim">или кликни для выбора · mp3 / wav / midi / ogg</span>
          </span>
        </button>
      ) : (
        <div className="rounded-xl border border-line bg-panel2/60 p-4">
          <div className="flex items-start gap-3">
            <span
              className={`grid h-11 w-11 flex-none place-items-center rounded-lg border ${
                fileInfo.kind === "midi"
                  ? "border-lime/30 bg-lime/10 text-lime"
                  : "border-neon/30 bg-neon/10 text-neon"
              }`}
            >
              {fileInfo.kind === "midi" ? <FileMusic size={20} strokeWidth={1.7} /> : <FileAudio size={20} strokeWidth={1.7} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-fog">{fileInfo.name}</p>
              <p className="mt-1 font-mono text-[11px] text-dim">{fileInfo.subtitle}</p>
            </div>
            <button
              onClick={pick}
              disabled={busy}
              title="Заменить файл"
              className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-line text-dim transition hover:border-neon/50 hover:text-neon"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={onDemo}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl border border-lime/30 bg-lime/[0.06] px-3 py-2.5 font-mono text-[11px] text-lime transition hover:bg-lime/[0.12]"
        >
          <Sparkles size={13} />
          демо wav
        </button>
        <button
          onClick={onDemoMidi}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl border border-neon/30 bg-neon/[0.06] px-3 py-2.5 font-mono text-[11px] text-neon transition hover:bg-neon/[0.12]"
        >
          <FileMusic size={13} />
          демо midi
        </button>
      </div>
    </div>
  );
}
