RU:

MUSIC2ARDUINO — конвертер музыки в скетч для зуммера

Сайт проекта: https://aezakmi9432.github.io

Загрузите MP3, WAV или MIDI — и получите готовый код для Arduino, который проиграет эту мелодию через пассивный зуммер.

Как это работает:

Для аудио (MP3/WAV) — извлечение основного тона методом автокорреляции
Для MIDI — парсинг Standard MIDI File и перевод нот в частоты
На выходе — скетч с tone(), где последовательность нот и длительностей хранится в PROGMEM, чтобы экономить оперативную память

Кому пригодится: тем, кто делает поделки на Arduino / ATtiny — от будильников и игрушек до пасхалок в учебных проектах.

ENG:

MUSIC2ARDUINO — a music-to-sketch converter for buzzers

Project website: https://aezakmi9432.github.io

Upload an MP3, WAV, or MIDI file — and get ready-to-use Arduino code that plays the melody through a passive buzzer.

How it works:

For audio (MP3/WAV) — fundamental pitch extraction using autocorrelation
For MIDI — parsing the Standard MIDI File and converting notes to frequencies
Output — a sketch using tone(), with the sequence of notes and durations stored in PROGMEM to save RAM    

Who it's for: anyone building Arduino / ATtiny projects — from alarm clocks and toys to Easter eggs in classroom projects.
