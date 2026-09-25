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
