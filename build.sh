#!/bin/sh
# Assemble the single-file artifact page: src/page.html with core + UI scripts inlined.
# htm templates are written with HTML-style `class`/`for`; React wants className/htmlFor.
set -e
cd "$(dirname "$0")"
ui=$(cat src/ui.js src/screens.js src/app.js | sed -e 's/ class=/ className=/g' -e 's/ for=/ htmlFor=/g' -e 's/ autocomplete=/ autoComplete=/g' -e 's/ inputmode=/ inputMode=/g')
python3 - "$ui" <<'PY'
import sys
page = open('src/page.html').read()
core = open('src/core.js').read()
ui = sys.argv[1]
out = page.replace('/*CORE*/', core).replace('/*UI*/', ui)
open('finance-os.html', 'w').write(out)
PY
echo "built finance-os.html ($(wc -c < finance-os.html) bytes)"
