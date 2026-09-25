# music2arduino

Конвертер **MP3 / MIDI → Arduino-скетч** для пассивного зуммера.
Анализ питча (автокорреляция) и парсинг SMF выполняются прямо в браузере — без серверов.

## Стек и версии

- **Node.js 24** (закреплено в `.nvmrc` и `.node-version`)
- React 19 + Vite 7 + Tailwind CSS 4
- Сборка: `vite-plugin-singlefile` — весь сайт инлайнится в один `dist/index.html`,
  поэтому корректно работает на GitHub Pages с любым base-path (`user.github.io/repo/`).

## Локальная разработка

```bash
# выбрать Node 24 (если установлен nvm — подхватит .nvmrc автоматически)
nvm install
nvm use

npm install
npm run dev      # dev-сервер
npm run build    # продакшн-сборка в dist/
npx tsc --noEmit # проверка типов
```

## Деплой на GitHub Pages

В репозитории уже лежит workflow `.github/workflows/deploy.yml` —
он гоняет typecheck + build на каждый push/PR и деплоит `dist/` на Pages.

Разовая настройка в репозитории:

1. **Settings → Pages → Build and deployment → Source:** выбрать **GitHub Actions** (не «Deploy from a branch»).
2. Запушить в ветку `main` — workflow запустится сам, появятся зелёные проверки **Build · Node 24** и **Deploy · GitHub Pages**.
3. Сайт будет доступен по адресу `https://<user>.github.io/<repo>/` (ссылка также выводится в сводке джобы Deploy).

Проверки для pull request: workflow поднимает Node 24, ставит зависимости, прогоняет `tsc --noEmit` и `vite build` — мерж идёт только при зелёном статусе.

## Пустая страница на GitHub Pages — почему и как чинить

**Симптом:** открываешь `https://<user>.github.io/<repo>/` — белый экран,
а в консоли браузера ошибка загрузки `/src/main.tsx`.

**Причина:** Pages обслуживает **исходники из ветки**, а не собранный `dist/`.
Корневой `index.html` — это dev-вход Vite, он импортирует TypeScript-модули,
которые браузер выполнить не может. Сборку из `dist/` публикует только
Actions-конвейер.

**Лечение:**

1. **Settings → Pages → Build and deployment → Source:** обязательно
   **GitHub Actions** (переключить с «Deploy from a branch»).
2. Вкладка **Actions**: убедись, что последний запуск `Build & Deploy`
   зелёный (в нём две джобы: `Build · Node 24` → `Deploy · GitHub Pages`).
   Если ранний запуск упал — перезапусти (Re-run jobs) или запушь любой коммит.
3. Открой сайт с жёстким обновлением кэша: `Ctrl+F5` / `Cmd+Shift+R`.

После включения Actions-источника Pages будет обслуживать именно артефакт
из `dist/` — приложение загрузится сразу.
