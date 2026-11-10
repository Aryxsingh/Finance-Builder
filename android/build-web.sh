#!/bin/sh
# Make android/app/src/main/assets/index.html from finance-os.html, with React,
# ReactDOM and htm inlined from LIB_DIR so the app works offline.
#   LIB_DIR must hold react.production.min.js, react-dom.production.min.js, htm.umd.js
set -e
cd "$(dirname "$0")/.."
LIB_DIR=${1:?usage: android/build-web.sh LIB_DIR}
mkdir -p android/app/src/main/assets
python3 - "$LIB_DIR" <<'PY'
import re, sys, os
lib = sys.argv[1]
page = open('finance-os.html').read()
def inline(pattern, fname):
    global page
    code = open(os.path.join(lib, fname)).read().replace('</script', '<\\/script')
    new, n = re.subn(r'<script src="[^"]*' + pattern + r'[^"]*"></script>', lambda m: '<script>' + code + '</script>', page)
    assert n == 1, fname
    page = new
inline(r'/react\.production\.min\.js', 'react.production.min.js')
inline(r'react-dom\.production\.min\.js', 'react-dom.production.min.js')
inline(r'htm\.umd\.js', 'htm.umd.js')
head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
        'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
        '</head><body>')
open('android/app/src/main/assets/index.html', 'w').write(head + page + '</body></html>')
print('built android/app/src/main/assets/index.html')
PY
