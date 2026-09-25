import { memo, useMemo } from "react";

const RX =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(#\s*[a-zA-Z_]+(?:\s*<[^>]*>)?)|("(?:[^"\\\n]|\\.)*")|\b(void|int|long|const|unsigned|float|char|bool|for|while|if|else|return|static|sizeof|true|false|uint8_t|uint16_t|uint32_t|int16_t|PROGMEM|include|define)\b|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()/g;

const CLASSES = ["tok-com", "tok-pre", "tok-str", "tok-kw", "tok-num", "tok-fn"];

export const CodeBlock = memo(function CodeBlock({ code }: { code: string }) {
  const nodes = useMemo(() => {
    const out: React.ReactNode[] = [];
    let last = 0;
    let key = 0;
    RX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RX.exec(code)) !== null) {
      if (m.index > last) out.push(<span key={key++}>{code.slice(last, m.index)}</span>);
      let cls = "";
      for (let g = 1; g <= 6; g++) {
        if (m[g] !== undefined) {
          cls = CLASSES[g - 1];
          break;
        }
      }
      out.push(
        <span key={key++} className={cls}>
          {m[0]}
        </span>,
      );
      last = m.index + m[0].length;
    }
    if (last < code.length) out.push(<span key={key++}>{code.slice(last)}</span>);
    return out;
  }, [code]);

  return (
    <pre className="font-mono text-[12.5px] leading-[1.65] text-fog whitespace-pre">
      {nodes}
    </pre>
  );
});
