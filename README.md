# VexBoard

VexBoard is a visual drawing and planning tool: an infinite canvas for text, sticky notes, cards, images, arrows, groups and tags.
It is a free-form board for thinking — idea → project → tasks → done — not a To-Do list.

## Run it

```bash
nvm use          # Node LTS pinned in .nvmrc
npm install
npm run dev      # start the dev server
npm run check    # lint + typecheck + unit tests (fast, no browser)
npm run build    # production build
```

## E2E (Playwright)

Browser smoke tests for the canvas host live in `e2e/` (Chromium only):

```bash
npx playwright install chromium   # one-time browser download
npm run test:e2e                  # starts the dev server itself (port 5173)
npm run check:all                 # npm run check + npm run test:e2e
```

## CI

Every PR and every push to `main` runs `.github/workflows/ci.yml` (`check:all` + `build`) on the Node version pinned in `.nvmrc`; the required status check is named **check**.

## Docs

The single source of truth for architecture, decisions and workflow: [docs/PLAN.md](docs/PLAN.md).
