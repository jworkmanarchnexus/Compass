#!/usr/bin/env python3
"""Drift audit: compare an app's CSS with the design system.

  python3 tools/audit.py app.html [more.html ...]

For each app reports, against project/tokens.json and project/components/bundle.css:
  - system tokens the app does not declare (light, dark)
  - system tokens it declares with a different value
  - tokens it declares that the system lacks (parallel vocabulary)
  - system component classes it never defines
  - hard-coded color literals outside token blocks
Values are compared as written; run after build_css.py output has been pasted in, and expect 0 / 0.
"""
import re, sys, json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / 'project'
T = json.loads((root / 'tokens.json').read_text())
themes = [t['id'] for t in T['color']['themes']]

def norm(v): return re.sub(r'(?<![\d])\.(\d)', r'0.\1', re.sub(r'\s+', '', v.replace('"', "'")).lower().rstrip(';'))
def vars_in(body): return {k: v.strip() for k, v in re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', body)}

def app_vars(css):
    out = {'light': {}, 'dark': {}}
    for m in re.finditer(r'((?::root|body\.dense)[^{}]*)\{([^{}]*)\}', css):
        sel, body = m.group(1), m.group(2)
        if 'body.dense' in sel: continue
        key = 'dark' if ('dark' in sel or 'not(' in sel) else 'light'
        out[key].update(vars_in(body))
    return out

def sys_vars():
    # light + dark overrides, as written by build_css (aliases become var(--x))
    first = themes[0]
    def cv(v):
        m = re.fullmatch(r'\{(.+)\}', v); return f'var(--{m.group(1)})' if m else v
    L, D = {}, {}
    for t in T['color']['tokens'] + T['shadow']['tokens']:
        v = t['value']
        L['--' + t['name']] = cv(v if isinstance(v, str) else v[first])
        if isinstance(v, dict) and 'dark' in v: D['--' + t['name']] = cv(v['dark'])
    for fam in ('fontsize', 'spacing', 'radius', 'size'):
        for t in T[fam]['tokens']: L['--' + t['name']] = t['value']
    return L, D

def classes(css):
    return set(re.findall(r'\.([a-zA-Z][\w-]*)', re.sub(r'/\*.*?\*/', '', css, flags=re.S)))

SL, SD = sys_vars()
core = classes((root / 'components' / 'bundle.css').read_text())
for path in sys.argv[1:]:
    src = open(path, encoding='utf-8', errors='replace').read()
    css = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', src, flags=re.S))
    css = re.sub(r'@font-face\s*\{[^}]*\}', '', css, flags=re.S)
    av = app_vars(css)
    print(f'\n== {path}')
    for mode, S in (('light', SL), ('dark', SD)):
        A = av[mode]
        miss = [k for k in S if k not in A]
        diff = [(k, S[k], A[k]) for k in S if k in A and norm(S[k]) != norm(A[k])]
        print(f'  {mode}: missing {len(miss)}, different {len(diff)}')
        for k, s, a in diff[:12]: print(f'     differs {k}: system {s} | app {a}')
        if miss: print('     missing:', ', '.join(miss[:15]) + (' ...' if len(miss) > 15 else ''))
    extra = [k for k in av['light'] if k not in SL and k not in ('--f-ui', '--f-cond')]
    print(f'  app-only tokens: {len(extra)}' + (' (' + ', '.join(extra[:15]) + (' ...' if len(extra) > 15 else '') + ')' if extra else ''))
    have = classes(css)
    print(f'  system classes defined: {len(core & have)} of {len(core)}')
    body = re.sub(r':root[^{]*\{[^}]*\}', '', re.sub(r'/\*.*?\*/', '', css, flags=re.S))
    lit = re.findall(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)', body)
    print(f'  hard-coded colors outside token blocks: {len(lit)} ({len(set(lit))} distinct)')
