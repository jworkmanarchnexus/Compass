#!/usr/bin/env node
'use strict';
/* Node port of build_css.py, so only Node is needed.
   Reads design-system/project/{tokens.json, fonts/, components/bundle.css, components/bundle.js, assets/Brand/}
   and writes shared/design-system/ : toolbox.css, bundle.js, fonts/, arch-nexus-logo.png.

     node design-system/tools/build_css.js            write shared/design-system/
     node design-system/tools/build_css.js --check    exit 1 if shared/design-system/ is out of date

   Same output as the Python script (fonts are url() references instead of inlined, since the server serves them).
   Do not edit the generated files by hand: change design-system/project/ and run this. */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'design-system', 'project');
const OUT = path.join(REPO, 'shared', 'design-system');

function build() {
  const T = JSON.parse(fs.readFileSync(path.join(SRC, 'tokens.json'), 'utf8'));
  const themes = T.color.themes.map(t => t.id);
  const first = themes[0];
  const pick = (v, th) => (typeof v === 'string' ? v : (th in v ? v[th] : v[first]));
  const cssval = v => { const m = /^\{(.+)\}$/.exec(v); return m ? `var(--${m[1]})` : v; };
  const decl = (items, th, onlyOverrides) => {
    const out = [];
    for (const t of items) {
      const v = t.value;
      if (onlyOverrides && (typeof v === 'string' || !(th in v))) continue;
      out.push(`--${t.name}: ${cssval(pick(v, th))};`);
    }
    return out;
  };
  const colors = T.color.tokens, shadows = T.shadow.tokens;
  const L = [];

  for (const f of T.type.fonts) {
    L.push(`@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: ${f.style}; font-display: swap; src: url('fonts/${f.file}') format('woff2'); }`);
  }
  let body = Object.entries(T.type.families).map(([k, v]) => `--font-${k}: ${v};`);
  for (const fam of ['fontsize', 'spacing', 'radius', 'size']) body = body.concat(T[fam].tokens.map(t => `--${t.name}: ${t.value};`));
  body = body.concat(decl(colors, first), decl(shadows, first), ['color-scheme: light;']);
  L.push(':root {\n  ' + body.join('\n  ') + '\n}');
  L.push('body.dense { --row-h: 27px; }');

  for (const th of themes.slice(1)) {
    const ov = decl(colors, th, true).concat(decl(shadows, th, true), [`color-scheme: ${th};`]);
    const ind = n => ov.join('\n' + ' '.repeat(n));
    if (th === 'dark') L.push('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    ' + ind(4) + '\n  }\n}');
    L.push(`:root[data-theme="${th}"] {\n  ` + ind(2) + '\n}');
  }
  L.push(fs.readFileSync(path.join(SRC, 'components', 'bundle.css'), 'utf8'));

  const files = new Map();
  files.set('toolbox.css', Buffer.from(L.join('\n') + '\n'));
  files.set('bundle.js', fs.readFileSync(path.join(SRC, 'components', 'bundle.js')));
  files.set('arch-nexus-logo.png', fs.readFileSync(path.join(SRC, 'assets', 'Brand', 'arch-nexus-logo.png')));
  for (const f of fs.readdirSync(path.join(SRC, 'fonts'))) files.set(`fonts/${f}`, fs.readFileSync(path.join(SRC, 'fonts', f)));
  return files;
}

function main() {
  const files = build();
  if (process.argv.includes('--check')) {
    const stale = [...files].filter(([name, buf]) => {
      const p = path.join(OUT, name);
      return !fs.existsSync(p) || !fs.readFileSync(p).equals(buf);
    }).map(([name]) => name);
    if (stale.length) { console.error('shared/design-system is out of date: ' + stale.join(', ') + '\nRun: node design-system/tools/build_css.js'); process.exit(1); }
    console.log('shared/design-system is up to date.');
    return;
  }
  for (const [name, buf] of files) {
    const p = path.join(OUT, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
  }
  console.log(`wrote ${files.size} files to shared/design-system/`);
}

if (require.main === module) main();
module.exports = { build };
