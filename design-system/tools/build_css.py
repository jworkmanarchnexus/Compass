#!/usr/bin/env python3
"""Generate the CSS an app embeds from the design system source files.

  python3 tools/build_css.py [--out toolbox.css] [--inline-fonts] [--no-components]

Reads project/tokens.json, project/fonts/*, project/components/bundle.css and writes ONE stylesheet:
  1. @font-face (base64 with --inline-fonts, else url(project/fonts/..))
  2. :root tokens (light) + the dark theme twice: [data-theme="dark"] and, for 'auto', inside
     @media (prefers-color-scheme: dark) :root:not([data-theme="light"])
  3. the shared component rules (bundle.css)
The design system page compiles only the explicit [data-theme] blocks; this script adds the auto-dark block
the apps rely on. Paste the output over the app's tokens/ui/shell CSS. Do not edit it by hand.
"""
import json, re, sys, base64, pathlib, argparse
root = pathlib.Path(__file__).resolve().parent.parent / 'project'
ap = argparse.ArgumentParser(); ap.add_argument('--out', default='toolbox.css'); ap.add_argument('--inline-fonts', action='store_true'); ap.add_argument('--no-components', action='store_true')
a = ap.parse_args()
T = json.loads((root / 'tokens.json').read_text())
themes = [t['id'] for t in T['color']['themes']]; first = themes[0]
def pick(v, th):
    if isinstance(v, str): return v
    return v.get(th, v[first])
def cssval(v):
    m = re.fullmatch(r'\{(.+)\}', v); return f'var(--{m.group(1)})' if m else v
def decl(items, th, only_overrides=False):
    out = []
    for t in items:
        v = t['value']
        if only_overrides and (isinstance(v, str) or th not in v): continue
        out.append(f"--{t['name']}: {cssval(pick(v, th))};")
    return out
colors, shadows = T['color']['tokens'], T['shadow']['tokens']
L = []
# fonts
for f in T['type']['fonts']:
    p = root / 'fonts' / f['file']
    src = 'url(data:font/woff2;base64,' + base64.b64encode(p.read_bytes()).decode() + ')' if a.inline_fonts else f"url('project/fonts/{f['file']}')"
    L.append(f"@font-face {{ font-family: '{f['family']}'; font-weight: {f['weight']}; font-style: {f['style']}; font-display: swap; src: {src} format('woff2'); }}")
# light
body = [f"--font-{k}: {v};" for k, v in T['type']['families'].items()]
for fam in ('fontsize', 'spacing', 'radius', 'size'):
    body += [f"--{t['name']}: {t['value']};" for t in T[fam]['tokens']]
body += decl(colors, first) + decl(shadows, first) + ['color-scheme: light;']
L.append(':root {\n  ' + '\n  '.join(body) + '\n}')
L.append('body.dense { --row-h: 27px; }')
# dark
for th in themes[1:]:
    ov = decl(colors, th, True) + decl(shadows, th, True) + [f'color-scheme: {th};']
    ind = lambda n: ('\n' + ' ' * n).join(ov)
    if th == 'dark':
        L.append('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    ' + ind(4) + '\n  }\n}')
    L.append(f':root[data-theme="{th}"] {{\n  ' + ind(2) + '\n}')
if not a.no_components:
    L.append((root / 'components' / 'bundle.css').read_text())
pathlib.Path(a.out).write_text('\n'.join(L) + '\n')
print(f'wrote {a.out} ({pathlib.Path(a.out).stat().st_size} bytes)')
