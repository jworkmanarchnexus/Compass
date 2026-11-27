/* Principal Accountability export: a PDF (a window with the real page on the right, as the Marketing Report's export does) and a
   CSV that Excel opens. Both are made from AcctRules.sheet / toCsv (logic/accountability.js), so they say what the page says.
   The preview and the PDF are painted by the same code through a 2D context (canvas for the preview, jsPDF's context2d for the
   file), so text stays vector and the fonts are embedded. Paper sizes, margin and logo size are the Marketing Report's (BdExportPlan). */
import { LOGO, PDF_FONTS } from '/shared/export/assets.js';
import { fontsReady, loadLogo, FONTS_CANVAS, FONTS_PDF } from '/modules/bd/ui/export-draw.js';

const A = window.AcctRules;
const X = window.BdExportPlan;
const DEFAULTS = { paper: 'letter', orientation: 'landscape', logo: true, printed: true };
const PAL = { ink: '#1E2428', text2: '#50585E', muted: '#6E777D', title: '#1F4E78', headBg: '#1F4E78', headInk: '#FFFFFF', groupBg: '#D9E2EC', groupInk: '#1F4E78', rule: '#BFC6CC', totalBg: '#F2F2F2', neg: '#B42318', goal: '#007A3D' };
const fnt = (F, kind, size, bold) => (bold ? 'bold ' : '') + size + 'px ' + F[kind];
const isNeg = t => /^\(|^-\d/.test(t);
const MONTHS = A.MONTHS;
const longDay = ymd => { const [y, m, d] = String(ymd).split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

/* ---------- CSV ---------- */
export function downloadCsv(ctx, d) {
  const csv = '﻿' + A.toCsv(d); // the mark tells Excel the file is UTF-8
  save(ctx, new Blob([csv], { type: 'text/csv;charset=utf-8' }), `Principal-accountability-${d.run.period}-v${d.run.version}.csv`);
}
function save(ctx, blob, name) {
  const url = URL.createObjectURL(blob);
  const a = ctx.h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- painting one page ---------- */
function fitText(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s.length > 1 ? s + '…' : '';
}
function wrapWords(c, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = fitText(c, lines[maxLines - 1] + '…', maxW); }
  return lines;
}

/* design units: the table is laid out at a fixed width and scaled to the page, smaller if it would be too tall */
const BASE_W = 1000, ROW = 17, HEAD = 48, GROUP = 16, FIRM_ROW = 14;
const widths = cols => cols.map(c => (c.id === 'label' ? 2.1 : c.group === 'projects' ? 0.85 : c.id === 'response' || c.id === 'utilization' || c.id === 'profitPct' ? 0.9 : 1.15));

function paintBody(c, F, s, y0) {
  const ws = widths(s.columns), tot = ws.reduce((a, b) => a + b, 0);
  const xs = [0]; ws.forEach(w => xs.push(xs[xs.length - 1] + w / tot * BASE_W));
  let y = y0;
  // group headings
  let i = 0;
  while (i < s.columns.length) {
    let j = i; while (j + 1 < s.columns.length && s.columns[j + 1].group === s.columns[i].group) j++;
    if (s.columns[i].group) {
      c.fillStyle = PAL.groupBg; c.fillRect(xs[i] + 1, y, xs[j + 1] - xs[i] - 2, GROUP);
      c.fillStyle = PAL.groupInk; c.font = fnt(F, 'ui', 9, true); c.textAlign = 'center';
      c.fillText(fitText(c, s.groups[s.columns[i].group], xs[j + 1] - xs[i] - 6), (xs[i] + xs[j + 1]) / 2, y + 11.5);
    }
    i = j + 1;
  }
  y += GROUP + 2;
  // column headings, wrapped
  c.fillStyle = PAL.headBg; c.fillRect(0, y, BASE_W, HEAD);
  c.fillStyle = PAL.headInk; c.font = fnt(F, 'ui', 8.2, true); c.textAlign = 'center';
  s.columns.forEach((col, k) => {
    const lines = wrapWords(c, col.head, xs[k + 1] - xs[k] - 6, 4);
    const top = y + (HEAD - lines.length * 9.5) / 2 + 7.5;
    lines.forEach((t, n) => c.fillText(t, (xs[k] + xs[k + 1]) / 2, top + n * 9.5));
  });
  y += HEAD;
  const row = (cells, total) => {
    if (total) { c.fillStyle = PAL.totalBg; c.fillRect(0, y, BASE_W, ROW); c.fillStyle = PAL.ink; c.fillRect(0, y, BASE_W, 0.9); }
    cells.forEach((t, k) => {
      const col = s.columns[k];
      c.font = fnt(F, 'ui', 9, total || k === 0 || col.id === 'goal');
      c.fillStyle = isNeg(t) ? PAL.neg : col.id === 'goal' ? PAL.goal : PAL.ink;
      if (k === 0) { c.textAlign = 'left'; c.fillText(fitText(c, t, xs[1] - 8), 4, y + ROW - 5); }
      else if (col.id === 'response' || col.group === 'projects') { c.textAlign = 'center'; c.fillText(t, (xs[k] + xs[k + 1]) / 2, y + ROW - 5); }
      else { c.textAlign = 'right'; c.fillText(fitText(c, t, xs[k + 1] - xs[k] - 6), xs[k + 1] - 4, y + ROW - 5); }
    });
    y += ROW;
    if (!total) { c.fillStyle = PAL.rule; c.fillRect(0, y - 0.5, BASE_W, 0.5); }
  };
  s.body.forEach(r => row(r, false));
  row(s.total, true);
  y += 10;
  if (s.pace) { c.textAlign = 'left'; c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 9.5, true); c.fillText(`${s.pace.label}: ${s.pace.value}`, 4, y + 6); y += 18; }
  // the firm block: two columns of label and value
  y += 6;
  c.font = fnt(F, 'cond', 11, true); c.fillStyle = PAL.title; c.textAlign = 'left'; c.fillText('The firm, year to date', 4, y + 6); y += 14;
  const half = Math.ceil(s.firm.length / 2);
  s.firm.forEach(([k, v], n) => {
    const col = n < half ? 0 : 1, yy = y + (n % half) * FIRM_ROW + 8, x = 4 + col * 360;
    c.font = fnt(F, 'ui', 9); c.fillStyle = PAL.text2; c.textAlign = 'left'; c.fillText(k, x, yy);
    c.font = fnt(F, 'ui', 9, true); c.fillStyle = isNeg(v) ? PAL.neg : PAL.ink; c.textAlign = 'right'; c.fillText(v || '-', x + 320, yy);
  });
  return y + half * FIRM_ROW + 6 - y0;
}
const bodyHeight = s => GROUP + 2 + HEAD + (s.body.length + 1) * ROW + 10 + (s.pace ? 18 : 0) + 6 + 14 + Math.ceil(s.firm.length / 2) * FIRM_ROW + 6;

function job(d, O, today) {
  const P = X.paperSize(O.paper, O.orientation), M = X.MARGIN;
  const s = A.sheet(d);
  const W = P.w - 2 * M, H = P.h - 2 * M;
  const logoW = 54, logoH = Math.ceil(logoW * X.LOGO_RATIO);
  const head = Math.max(46, O.logo ? logoH + 10 : 0), foot = 14;
  const fitW = W / BASE_W, fitH = (H - head - foot) / bodyHeight(s);
  const z = Math.min(fitW, fitH);
  return {
    P, small: z * 9 < 6, shrunk: fitH < fitW,
    paint(c, F, logoAt) {
      c.save(); c.translate(M, M);
      const rx = W - (O.logo ? logoW + 12 : 0);
      c.textAlign = 'left'; c.fillStyle = PAL.title; c.font = fnt(F, 'cond', 22, true);
      c.fillText(fitText(c, s.title, rx), 0, 20);
      c.fillStyle = PAL.text2; c.font = fnt(F, 'cond', 11);
      c.fillText(fitText(c, `As of ${longDay(d.meta.cutoff)}  ·  Version ${d.run.version}  ·  ${{ draft: 'Draft', published: 'Published', archived: 'Archived' }[d.run.status]}`.toUpperCase(), rx), 0, 37);
      if (O.logo) logoAt(M + W - logoW, M, logoW, logoH);
      c.save(); c.translate(0, head); c.scale(z, z);
      paintBody(c, F, s, 0);
      c.restore();
      c.font = fnt(F, 'ui', 8); c.fillStyle = PAL.muted; c.textAlign = 'left';
      const left = []; if (O.printed) left.push('Printed ' + longDay(today)); if (d.run.status === 'draft') left.push('DRAFT: not published');
      c.fillText(left.join('  ·  '), 0, H);
      c.textAlign = 'right'; c.fillText('Arch Nexus Compass', W, H);
      c.restore();
    },
  };
}

function canvasOf(j, pxW, logoImg) {
  const z = pxW / j.P.w;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(j.P.w * z); cv.height = Math.ceil(j.P.h * z);
  const c = cv.getContext('2d');
  c.scale(z, z); c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, j.P.w, j.P.h);
  j.paint(c, FONTS_CANVAS, (x, y, w, h0) => { if (!logoImg) return; c.save(); c.setTransform(z, 0, 0, z, 0, 0); c.drawImage(logoImg, x, y, w, h0); c.restore(); });
  return cv;
}

let libP = null;
function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
  if (!libP) libP = new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = '/shared/vendor/jspdf.umd.min.js';
    el.onload = () => res(window.jspdf); el.onerror = () => { libP = null; rej(new Error('The PDF library did not load.')); };
    document.head.append(el);
  });
  return libP;
}
async function buildPdf(d, O, today) {
  await fontsReady();
  const logoImg = O.logo ? await loadLogo() : null;
  const lib = await loadJsPdf();
  const j = job(d, O, today);
  const doc = new lib.jsPDF({ orientation: j.P.w > j.P.h ? 'landscape' : 'portrait', unit: 'pt', format: [Math.min(j.P.w, j.P.h), Math.max(j.P.w, j.P.h)], compress: true });
  if (doc.setProperties) doc.setProperties({ title: 'Principal Accountability ' + d.run.label, creator: 'Arch Nexus Compass' });
  if (doc.context2d && doc.addFileToVFS && doc.addFont) {
    for (const f of PDF_FONTS) { doc.addFileToVFS(f.file, f.data); doc.addFont(f.file, f.family, f.style); }
    j.paint(doc.context2d, FONTS_PDF, (x, y, w, h0) => doc.addImage(LOGO.src, 'PNG', x, y, w, h0, 'arch-nexus-logo', 'SLOW'));
  } else doc.addImage(canvasOf(j, j.P.w * 3, logoImg).toDataURL('image/png'), 'PNG', 0, 0, j.P.w, j.P.h);
  return doc.output('arraybuffer');
}

/* ---------- the window ---------- */
function loadPrefs(pref) { try { return { ...DEFAULTS, ...JSON.parse(pref('acct.xo1') || '{}') }; } catch (e) { return { ...DEFAULTS }; } }

export function openExport(ctx, d) {
  const { h } = ctx;
  const pref = ctx.T.pref;
  const O = loadPrefs(pref);
  const today = (() => { const t = new Date(), p = n => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; })();
  const prev = h('div', { class: 'xw-prev', 'aria-live': 'polite' });
  const sum = h('span', { class: 'xw-sum' });
  const msg = h('span', { class: 'xw-sum', role: 'alert' });
  const dl = h('button', { class: 'btn primary', type: 'button', text: 'Download PDF' });
  let gen = 0, timer = null;

  async function draw() {
    const mine = ++gen;
    await fontsReady();
    const logoImg = O.logo ? await loadLogo() : null;
    if (mine !== gen) return;
    const j = job(d, O, today);
    prev.textContent = '';
    const cv = canvasOf(j, Math.min(1400, 980 * Math.max(1, window.devicePixelRatio || 1)), logoImg);
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'The exported page');
    prev.append(h('div', { class: 'sheet acct-sheet' }, cv));
    sum.textContent = `1 page · ${X.PAPER[O.paper].label}, ${O.orientation}` + (j.shrunk ? ' · shrunk to fit' : '') + (j.small ? ' · small print: try a bigger paper or landscape' : '');
  }
  const redraw = () => { pref('acct.xo1', JSON.stringify(O)); clearTimeout(timer); timer = setTimeout(draw, 60); };
  const seg = (key, items) => h('div', { class: 'seg', role: 'group' }, ...items.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(O[key] === v), text: t, onclick: e => { O[key] = v; [...e.currentTarget.parentNode.children].forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); redraw(); } })));
  const check = (key, text) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: O[key], onchange: e => { O[key] = e.target.checked; redraw(); } }), h('span', { text }));
  const opts = h('div', { class: 'xw-opts' }, h('div', { class: 'xo-form' },
    h('fieldset', {}, h('legend', { text: 'Page' }),
      h('p', { class: 'xo-note', text: 'One page: the PIC table, the totals and the firm figures. It shrinks to fit the paper.' }),
      h('div', { class: 'xo-field' }, h('label', { text: 'Paper' }), h('select', { class: 'txt', 'aria-label': 'Paper', onchange: e => { O.paper = e.target.value; redraw(); } }, ...Object.entries(X.PAPER).map(([k, p]) => h('option', { value: k, text: p.label, selected: O.paper === k })))),
      h('div', { class: 'xo-field' }, h('label', { text: 'Orientation' }), seg('orientation', [['landscape', 'Landscape'], ['portrait', 'Portrait']]))),
    h('fieldset', {}, h('legend', { text: 'Heading and footer' }), check('logo', 'Arch Nexus logo, top right'), check('printed', 'Print date in the footer'))));

  const close = () => { gen++; root.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  const onKey = e => { if (e.key === 'Escape') close(); };
  dl.addEventListener('click', async () => {
    dl.disabled = true; msg.textContent = 'Building the PDF…';
    try { save(ctx, new Blob([await buildPdf(d, O, today)], { type: 'application/pdf' }), `Principal-accountability-${d.run.period}-v${d.run.version}.pdf`); msg.textContent = 'Downloaded.'; }
    catch (e) { msg.textContent = 'The PDF could not be built: ' + e.message; }
    dl.disabled = false;
  });
  const root = h('div', { class: 'xw', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export Principal Accountability as a PDF' },
    h('div', { class: 'xw-top' }, h('h2', { text: 'Export PDF' }), h('span', { class: 'xw-sum', text: d.run.label }), h('span', { class: 'grow' }), h('button', { class: 'btn quiet', type: 'button', text: 'Close', onclick: close })),
    h('div', { class: 'xw-main' }, opts, prev),
    h('div', { class: 'xw-foot' }, sum, h('span', { class: 'grow' }), msg, dl));
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  draw();
}
