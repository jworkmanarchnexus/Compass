#!/usr/bin/env python3
"""Contrast check for the text/ground pairs the token usage notes name, in every theme.
usage: python3 tools/contrast.py [project/tokens.json]"""
import json,sys,re
p=sys.argv[1] if len(sys.argv)>1 else 'project/tokens.json'
T=json.load(open(p))['color']
themes=[t['id'] for t in T['themes']]
tok={t['name']:t['value'] for t in T['tokens']}
def val(n,th,seen=()):
    v=tok[n]; v=v if isinstance(v,str) else v.get(th,v[themes[0]])
    m=re.fullmatch(r'\{(.+)\}',v)
    return val(m.group(1),th) if m else v
def rgb(h):
    h=h.lstrip('#'); return [int(h[i:i+2],16) for i in (0,2,4)]
def lum(h):
    r=[(x/255) for x in rgb(h)]; r=[x/12.92 if x<=.03928 else ((x+.055)/1.055)**2.4 for x in r]
    return .2126*r[0]+.7152*r[1]+.0722*r[2]
def cr(a,b):
    la,lb=sorted([lum(a),lum(b)],reverse=True); return (la+.05)/(lb+.05)
# (foreground, ground, minimum, role)
PAIRS=[('text','bg',4.5),('text','surface',4.5),('text','surface-2',4.5),('text','surface-3',4.5),
 ('text-strong','bg',4.5),('text-strong','accent-soft',4.5),('text-strong','surface-3',4.5),
 ('text-2','bg',4.5),('text-2','surface',4.5),('text-2','surface-2',4.5),('text-2','surface-3',4.5),
 ('accent-text','bg',4.5),('accent-text','surface',4.5),('accent-text','accent-soft',4.5),('accent-text','surface-3',4.5),
 ('accent-hover','bg',4.5),('primary-fg','primary-bg',4.5),('primary-fg','primary-hover',4.5),
 ('info','info-bg',4.5),('warn','warn-bg',4.5),('warn','bg',4.5),('ok','ok-bg',4.5),('ok','bg',4.5),
 ('crit','crit-bg',4.5),('crit','bg',4.5),
 ('accent','bg',3.0),('line-strong','bg',3.0),('text-3','bg',4.5)]
bad=0
for th in themes:
    for f,g,m in PAIRS:
        r=cr(val(f,th),val(g,th)); ok=r>=m
        if not ok: bad+=1
        print(f"{'ok  ' if ok else 'FAIL'} {th:5} {f:13} on {g:13} {r:5.2f} (min {m})")
print(f"\n{bad} pair(s) below their floor")
