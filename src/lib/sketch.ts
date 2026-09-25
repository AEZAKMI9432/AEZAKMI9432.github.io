import { freqToName, formatTime } from "./music";
import type { AnalysisParams, AnalysisResult } from "./pitch";

export interface SketchOpts {
  title: string;
  pin: number;
  style: "simple" | "progmem";
}

/** прибл. занятость flash для PROGMEM-варианта, байт */
export function estimateFlash(res: AnalysisResult): number {
  return res.notes.length * 4 + 160;
}

export function generateSketch(res: AnalysisResult, p: AnalysisParams, o: SketchOpts): string {
  const L: string[] = [];
  const title = o.title || "my_melody";
  const sec = (res.totalMs / 1000).toFixed(1);

  L.push("/* ===========================================================");
  L.push(` *  ${title}`);
  L.push(" *  сконвертировано в music2arduino");
  L.push(" * -----------------------------------------------------------");
  L.push(` *  Нот: ${res.voicedCount} · Пауз: ${res.restCount} · Длительность: ~${sec} с`);
  L.push(` *  Скорость: ${p.speed}x · Квантование: ${p.quantize ? "вкл" : "выкл"} · Пин: D${o.pin}`);
  if (p.transpose !== 0) L.push(` *  Транспозиция: ${p.transpose > 0 ? "+" : ""}${p.transpose} полутонов`);
  L.push(" * -----------------------------------------------------------");
  L.push(" *  ВАЖНО: нужен ПАССИВНЫЙ зуммер (пьезо). Активный умеет");
  L.push(" *  только один тон и мелодию не сыграет.");
  L.push(` *  Подключение:  (+) зуммера -> D${o.pin},  (-) -> GND`);
  L.push(" * =========================================================== */");
  L.push("");

  if (res.notes.length === 0) {
    L.push("// Ноты не найдены. Попробуй изменить настройки анализа.");
    L.push("#define BUZZER_PIN 8");
    L.push("");
    L.push("void setup() {}");
    L.push("void loop() {}");
    return L.join("\n");
  }

  if (o.style === "simple") {
    L.push(`#define BUZZER_PIN ${o.pin}`);
    L.push("");
    L.push("void setup() {");
    L.push("  pinMode(BUZZER_PIN, OUTPUT);");
    L.push("}");
    L.push("");
    L.push("void loop() {");
    let acc = 0;
    let marker = 4000;
    res.notes.forEach((n, i) => {
      if (acc >= marker) {
        L.push("");
        L.push(`  // ·· ${formatTime(acc)} ··`);
        marker += 4000;
      }
      if (n.freq > 0) {
        const play = Math.max(10, Math.round(n.durationMs * 0.9));
        L.push(`  tone(BUZZER_PIN, ${n.freq}, ${play});  // ${freqToName(n.freq)}`);
        L.push(`  delay(${n.durationMs});`);
      } else {
        L.push(`  delay(${n.durationMs});              // пауза`);
      }
      acc += n.durationMs;
      if (i === res.notes.length - 1) {
        L.push("");
        L.push("  delay(2000);  // пауза перед повтором");
      }
    });
    L.push("}");
    L.push("");
    L.push("// Совет: скетч занимает много flash из-за строк delay/tone.");
    L.push("// Для длинных мелодий выбери стиль «PROGMEM-массивы».");
  } else {
    L.push("#include <avr/pgmspace.h>");
    L.push("");
    L.push(`#define BUZZER_PIN ${o.pin}`);
    L.push("");
    L.push("// частоты, Гц (0 = пауза)");
    L.push("const uint16_t melody[] PROGMEM = {");
    pushWrapped(L, res.notes.map((n) => String(n.freq)), 12);
    L.push("};");
    L.push("");
    L.push("// длительности, мс (скорость уже учтена)");
    L.push("const uint16_t noteDur[] PROGMEM = {");
    pushWrapped(L, res.notes.map((n) => String(n.durationMs)), 12);
    L.push("};");
    L.push("");
    L.push(`const uint16_t NOTE_COUNT = ${res.notes.length};`);
    L.push("");
    L.push("void setup() {");
    L.push("  pinMode(BUZZER_PIN, OUTPUT);");
    L.push("}");
    L.push("");
    L.push("void loop() {");
    L.push("  for (uint16_t i = 0; i < NOTE_COUNT; i++) {");
    L.push("    uint16_t freq = pgm_read_word(&melody[i]);");
    L.push("    uint16_t dur  = pgm_read_word(&noteDur[i]);");
    L.push("    if (freq > 0) {");
    L.push("      tone(BUZZER_PIN, freq, dur * 0.9);  // 10% — щель между нотами");
    L.push("    }");
    L.push("    delay(dur);");
    L.push("  }");
    L.push("  delay(2000);  // пауза перед повтором");
    L.push("}");
    L.push("");
    L.push(`// Flash: ~${estimateFlash(res)} байт из 30720 (ATmega328) — данных мелодии`);
  }

  return L.join("\n");
}

function pushWrapped(L: string[], items: string[], perLine: number): void {
  for (let i = 0; i < items.length; i += perLine) {
    const chunk = items.slice(i, i + perLine).join(", ");
    const comma = i + perLine < items.length ? "," : "";
    L.push(`  ${chunk}${comma}`);
  }
}
