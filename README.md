# Finance OS

A mobile-first personal finance app that runs as a Claude Artifact.

- `finance-os.html` — the built page that gets published (do not edit by hand).
- `src/core.js` — all money calculations (Safe to Spend, card liability, budgets, net worth, goals, coaching). Pure functions.
- `src/ui.js`, `src/screens.js`, `src/app.js` — React (via htm, no build step) UI, storage and AI adviser.
- `src/page.html` — styles and page shell.
- `test/core.test.js` — `node test/core.test.js`

Build: `./build.sh` → `finance-os.html`.

Storage: the artifact `db` capability, in the viewer's private `data/users/<id>/` subtree
(`profile` doc + one `tx-YYYY-MM` doc per month). Falls back to browser-only storage with a visible warning
when `db` is unavailable. JSON/CSV export and JSON restore live in Settings.
