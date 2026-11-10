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

## Android app

`android/` wraps the same page in a WebView (`MainActivity.java`) with React and htm bundled offline.
In the app there is no Claude runtime, so data is kept on the phone (WebView storage), exports are
written to `Downloads/FinanceOS` through a small JS bridge, and the adviser calls the Claude API with
an API key entered in Settings.

`.github/workflows/android.yml` builds the APK on every push that touches the app and attaches it to the
`android-latest` GitHub release. For updates that install over the previous build, add a signing key as
repository secrets `ANDROID_KEYSTORE_BASE64` (the keystore file, base64) and `ANDROID_KEYSTORE_PASSWORD`
(store and key password, alias `financeos`).
