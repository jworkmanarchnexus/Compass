/* ===== BD report export drawing: one set of drawing code for the preview and the PDF =====
   Same approach as the Scheduler's export: everything is drawn through a 2D-context interface. The preview draws on a canvas;
   the PDF draws on jsPDF's context2d, so text and lines stay vector and the fonts are embedded. The preview paints the exact
   page the PDF will contain, so what you see is what downloads.
   Only these context calls are used, because jsPDF supports them: save/restore, translate, scale, beginPath/moveTo/lineTo/
   closePath/rect, fill/stroke, fillRect, strokeRect, fillText, measureText, setLineDash, and solid colors (no alpha).
   Where things go (page cut, section heights) is decided by logic/export-plan.js; this file only paints. */
import { LOGO, PDF_FONTS } from '/shared/export/assets.js';

const X = window.BdExportPlan;

/* ---------- the palette ----------
   The firm's Excel report look: navy headings, green and blue figures, tinted status cells. (There is one look; the report is not
   restyled per person.) */
export const LOOKS = {
  report: {
    name: 'Report',
    pal: { ink: '#1E2428', text2: '#50585E', muted: '#6E777D', title: '#1F4E78', headBg: '#1F4E78', headInk: '#FFFFFF', rule: '#BFC6CC', box: '#1E2428',
      goalInk: '#00B050', paceInk: '#0070C0', ytd: '#92D050', forecast: '#D7E4BD', mwip: '#A6A6A6', pace: '#558ED5', rest: '#BDD7EE', goalMark: '#1F4E78', grid: '#E1E5E8',
      on_track: ['#C6E0B4', '#2F4F1D'], on_pace: ['#FFE699', '#6B5200'], behind: ['#F8CBAD', '#7A3410'], firmBg: '#F2F2F2' },
  },
};

export const FONTS_CANVAS = { ui: 'Lato, Arial, sans-serif', cond: '"Roboto Condensed", "Arial Narrow", Arial, sans-serif' };
export const FONTS_PDF = { ui: 'Lato', cond: 'RobotoCondensed' };
const fnt = (F, kind, size, bold) => (bold ? 'bold ' : '') + size + 'px ' + F[kind];
const STATUS_TEXT = { on_track: 'On Track', on_pace: 'On Pace', behind: 'Behind Pace' };

/* white text where it reads, the dark gray otherwise */
const hexRGB = hx => { const n = parseInt(hx.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = hx => { const [r, g, b] = hexRGB(hx).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const inkOn = hx => (1.05 / (lum(hx) + 0.05) >= 4.5 ? '#FFFFFF' : '#1E2428');

let fontsP = null;
export function fontsReady() {
  if (!fontsP) {
    const fs = document.fonts;
    fontsP = fs && fs.load ? Promise.all(['12px Lato', 'bold 12px Lato', '12px "Roboto Condensed"', 'bold 12px "Roboto Condensed"'].map(f => fs.load(f).catch(() => null))).catch(() => null) : Promise.resolve();
  }
  return fontsP;
}
let logoImg = null;
export function loadLogo() {
  if (logoImg) return Promise.resolve(logoImg);
  return new Promise(res => {
    const im = new Image();
    im.onload = () => { logoImg = im; res(im); };
    im.onerror = () => res(null);
    im.src = LOGO.src;
    setTimeout(() => res(logoImg), 4000);
  });
}

function fitText(c, text, maxW) {
  if (maxW <= 0) return '';
  if (c.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s.length > 1 ? s + '…' : '';
}
/* wrap a paragraph to a width (used for the description under the title) */
function wrap(c, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = fitText(c, lines[maxLines - 1] + '…', maxW); }
  return lines;
}
const dashed = (c, on) => { if (c.setLineDash) c.setLineDash(on ? [2, 3] : []); };

/* ---------- table ---------- */
const COLS = [0.15, 0.075, 0.075, 0.075, 0.075, 0.075, 0.085, 0.085, 0.095, 0.105, 0.105];
const HEADS = [['PIC'], ['Revenue', 'goal'], ['YTD goal', '(pace)'], ['YTD', 'revenue'], ['Revenue', 'forecast'], ['MWIP', 'backlog'], ['Total', 'projected'], ['% of pace', 'billed'], ['% of goal', 'YTD +', 'forecast'], ['% of goal', 'YTD + forecast', '+ MWIP'], ['Status']];

function paintTable(c, F, pal, w, y0, sec, d) {
  const T = X.T;
  const rows = sec.id === 'picTable' ? d.pic : d.sector;
  const f = d.firm;
  const tot = COLS.reduce((a, b) => a + b, 0);
  const xs = [0]; COLS.forEach(k => xs.push(xs[xs.length - 1] + k / tot * w));
  const legend = X.legendLines(d.meta, f);
  const bodyH = T.sum + T.head + (rows.length + 1) * T.row;
  c.save(); c.translate(0, y0);
  c.textAlign = 'center';
  // summary line
  c.fillStyle = pal.ink; c.font = fnt(F, 'ui', 12, true);
  c.fillText(fitText(c, `Total firm: total projected ${X.fmtK(f.total)}  |  Annual goal: ${X.fmtK(f.goal)} (${X.pct(f.total, f.goal)} of goal)`, w - 12), w / 2, T.sum - 8);
  // heading row
  c.fillStyle = pal.headBg; c.fillRect(0, T.sum, w, T.head);
  c.fillStyle = pal.headInk; c.font = fnt(F, 'ui', 9, true);
  HEADS.forEach((lines, i) => {
    const hd = i === 0 ? [sec.id === 'picTable' ? 'PIC' : 'Market sector'] : lines;
    const cx = (xs[i] + xs[i + 1]) / 2, top = T.sum + (T.head - hd.length * 11) / 2 + 9;
    hd.forEach((t, k) => c.fillText(t, cx, top + k * 11));
  });
  // rows
  const all = [{ r: f, firm: true }, ...rows.map(r => ({ r, firm: false }))];
  all.forEach(({ r, firm }, k) => {
    const y = T.sum + T.head + k * T.row;
    if (firm) { c.fillStyle = pal.firmBg; c.fillRect(0, y, w, T.row); }
    const base = y + T.row - 5;
    c.font = fnt(F, 'ui', 9.5, firm);
    c.fillStyle = pal.ink; c.textAlign = 'left';
    c.fillText(fitText(c, r.label, xs[1] - xs[0] - 10), 6, base);
    c.textAlign = 'right';
    const vals = [r.goal, r.ytdGoal, r.ytd, r.forecast, r.mwip, r.total];
    vals.forEach((v, i) => {
      const col = i + 1;
      const ink = i === 0 ? pal.goalInk : i === 1 ? pal.paceInk : pal.ink;
      c.fillStyle = ink; c.font = fnt(F, 'ui', 9.5, firm || i === 0 || i === 1 || i === 5);
      c.fillText(X.fmtK(v), xs[col + 1] - 8, base);
    });
    const pcts = [[X.pct(r.ytd, r.ytdGoal), pal.paceInk, false], [X.pct(r.ytd + r.forecast, r.goal), pal.goalInk, false], [X.pct(r.total, r.goal), pal.goalInk, true]];
    pcts.forEach(([t, ink, b], i) => { c.fillStyle = ink; c.font = fnt(F, 'ui', 9.5, firm || b); c.fillText(t, xs[8 + i] - 8, base); });
    // status cell: tinted, the word written out
    const st = r.status && pal[r.status];
    if (st) {
      c.fillStyle = st[0]; c.fillRect(xs[10], y, xs[11] - xs[10], T.row);
      c.fillStyle = st[1]; c.font = fnt(F, 'ui', 9, true); c.textAlign = 'center';
      c.fillText(STATUS_TEXT[r.status], (xs[10] + xs[11]) / 2, base);
    }
    c.fillStyle = firm ? pal.box : pal.rule; c.fillRect(0, y + T.row - (firm ? 0.9 : 0.5), w, firm ? 0.9 : 0.5);
  });
  // box
  c.strokeStyle = pal.box; c.lineWidth = 1; c.strokeRect(0.5, 0.5, w - 1, bodyH - 0.5);
  c.fillStyle = pal.box; c.fillRect(0, T.sum - 0.5, w, 0.6);
  // legend
  c.fillStyle = pal.text2; c.textAlign = 'center';
  legend.forEach((t, i) => {
    let size = 8.5;
    for (c.font = fnt(F, 'ui', size); size > 5.5 && c.measureText(t).width > w - 8; size -= 0.25) c.font = fnt(F, 'ui', size);
    c.fillText(t, w / 2, bodyH + 10 + i * T.legendLine);
  });
  c.restore();
}

/* ---------- charts ---------- */
function niceStep(range, ticks) {
  const raw = range / ticks, pow = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}
const KEYS = {
  firm: [['ytd', 'YTD revenue'], ['forecast', 'Revenue forecast'], ['mwip', 'MWIP backlog'], ['pace', 'Goal pace'], ['rest', 'Goal remaining']],
  rows: [['ytd', 'YTD revenue'], ['forecast', 'Revenue forecast'], ['mwip', 'MWIP backlog'], ['pace', 'Goal pace'], ['rest', 'Goal remaining']],
  single: [['ytd', 'YTD revenue'], ['forecast', 'Revenue forecast'], ['mwip', 'MWIP backlog'], ['pace', 'Goal pace'], ['rest', 'Goal remaining'], ['markpace', 'Pace line'], ['markgoal', 'Goal line']],
};

function chartRows(sec, d) {
  const f = d.firm;
  const K = X.fmtK;
  if (sec.id === 'firmChart' || sec.id === 'firmChartMarket') {
    const rest = Math.max(0, f.goal - f.ytdGoal);
    const market = sec.id === 'firmChartMarket'; // the market sector page opens with the same totals, labelled for markets
    return {
      title: `${market ? 'All markets' : 'Total firm'}: total projected ${K(f.total)}  |  Annual goal: ${K(f.goal)} (${X.pct(f.total, f.goal)} of goal)`, keys: KEYS.firm, tall: true,
      rows: [{ label: market ? 'Total market' : 'Total firm', segs: [['ytd', f.ytd], ['forecast', f.forecast], ['mwip', f.mwip]], end: K(f.mwip) }, { label: 'Annual goal', segs: [['pace', f.ytdGoal], ['rest', rest]] }],
    };
  }
  // the PIC and market sector charts show the goal the way Dave's reports do (logic/goal-chart.js)
  const scope = sec.id === 'picChart' ? 'pic' : 'sector';
  const lay = window.BdGoalChart.layout(scope === 'pic' ? d.pic : d.sector, scope);
  const goalSegs = r => [['pace', r.ytdGoal], ['rest', Math.max(0, r.goal - r.ytdGoal)]];
  const actual = (r, gap) => ({ label: r.label, gap, segs: [['ytd', r.ytd], ['forecast', r.forecast], ['mwip', r.mwip]], end: K(r.mwip) });
  const single = lay.mode === 'single';
  return {
    title: scope === 'pic' ? 'By PIC' : 'By market sector', keys: single ? KEYS.single : KEYS.rows, tall: false, small: true, tight: !single,
    guides: single ? [['pace', lay.goal.ytdGoal], ['goal', lay.goal.goal]] : [],
    rows: single ? [{ label: 'Goal', segs: goalSegs(lay.goal), muted: true }, ...lay.rows.map((r, i) => actual(r, i === 0))]
      : lay.rows.flatMap(r => [actual(r, true), { label: 'Goal', segs: goalSegs(r), muted: true }]),
  };
}

function paintChart(c, F, pal, w, y0, sec, d) {
  const C = X.C;
  const ch = chartRows(sec, d);
  const rh = ch.tall ? C.firmRow : ch.small ? C.goalRow : C.row, bh = ch.tight ? rh : rh * 0.64; // tight: a bar and its goal bar sit flush
  const ys = []; let yy = 0;
  ch.rows.forEach(r => { if (r.gap) yy += C.gap; ys.push(yy); yy += rh; });
  const L = 130, R = 44, bodyTop = C.sum + C.top, bodyH = yy;
  const total = bodyTop + bodyH + C.axis + C.key;
  const top = Math.max(...ch.rows.map(r => r.segs.reduce((a, s) => a + s[1], 0)), ...(ch.guides || []).map(g => g[1]), 1);
  const step = niceStep(top, 5), axisMax = Math.ceil(top / step) * step;
  const px = v => L + v / axisMax * (w - L - R);
  c.save(); c.translate(0, y0);
  c.textAlign = 'center';
  c.fillStyle = pal.ink; c.font = fnt(F, 'ui', 12, true);
  c.fillText(fitText(c, ch.title, w - 12), w / 2, C.sum - 8);
  // grid and ticks
  c.font = fnt(F, 'ui', 8); c.lineWidth = 0.6;
  for (let v = 0; v <= axisMax + 1; v += step) {
    c.fillStyle = pal.grid; c.fillRect(px(v) - 0.3, bodyTop, 0.6, bodyH);
    c.fillStyle = pal.muted; c.textAlign = 'center'; c.fillText(X.fmtK(v), px(v), bodyTop + bodyH + 11);
  }
  ch.rows.forEach((r, i) => {
    const y = bodyTop + ys[i] + (rh - bh) / 2; // (no offset when tight)
    c.fillStyle = r.muted ? pal.muted : pal.ink; c.font = fnt(F, 'ui', r.muted ? 8.5 : 9.5); c.textAlign = 'right';
    c.fillText(fitText(c, r.label, L - 10), L - 8, y + bh / 2 + 3.4);
    let acc = 0;
    for (const [kind, v] of r.segs) {
      if (v <= 0) continue;
      const x0 = px(acc), x1 = px(acc + v);
      c.fillStyle = pal[kind]; c.fillRect(x0, y, Math.max(1, x1 - x0), bh);
      if (kind !== 'mwip') {
        const t = X.fmtK(v);
        c.font = fnt(F, 'cond', 9, true); c.textAlign = 'center';
        if (x1 - x0 >= c.measureText(t).width + 6) { c.fillStyle = inkOn(pal[kind]); c.fillText(t, (x0 + x1) / 2, y + bh / 2 + 3.2); }
        else if (ch.tight && r.gap) { c.fillStyle = pal.ink; c.font = fnt(F, 'cond', 8, true); c.fillText(t, (x0 + x1) / 2, y - 2); } // too narrow: just above the bar
      }
      acc += v;
    }
    if (r.end) { c.fillStyle = pal.ink; c.font = fnt(F, 'cond', 9, true); c.textAlign = 'left'; c.fillText(r.end, px(acc) + 6, y + bh / 2 + 3.2); }
  });
  // dashed lines down the whole chart: where each should be by now, and the full goal
  for (const [kind, v] of ch.guides || []) {
    c.strokeStyle = kind === 'pace' ? pal.pace : pal.goalMark; c.lineWidth = 1.4;
    dashed(c, true);
    c.beginPath(); c.moveTo(px(v), bodyTop); c.lineTo(px(v), bodyTop + bodyH); c.stroke();
    dashed(c, false);
  }
  c.fillStyle = pal.ink; c.fillRect(L - 0.4, bodyTop, 0.8, bodyH);
  // key: swatches and words, centered as a row
  c.font = fnt(F, 'ui', 8.5);
  const items = ch.keys.map(([k, t]) => ({ k, t, w: 14 + c.measureText(t).width }));
  const gapK = 14, sumW = items.reduce((a, it) => a + it.w, 0) + gapK * (items.length - 1);
  let kx = Math.max(4, (w - sumW) / 2);
  const ky = bodyTop + bodyH + C.axis + 4;
  c.textAlign = 'left';
  for (const it of items) {
    if (it.k === 'markpace') { c.fillStyle = pal.pace; c.fillRect(kx + 4, ky, 2.4, 9); }
    else if (it.k === 'markgoal') { c.strokeStyle = pal.goalMark; c.lineWidth = 1.4; dashed(c, true); c.beginPath(); c.moveTo(kx + 5, ky); c.lineTo(kx + 5, ky + 9); c.stroke(); dashed(c, false); }
    else { c.fillStyle = pal[it.k]; c.fillRect(kx, ky, 9, 9); }
    c.fillStyle = pal.text2; c.fillText(it.t, kx + 13, ky + 7.6);
    kx += it.w + gapK;
  }
  c.strokeStyle = pal.box; c.lineWidth = 1; c.strokeRect(0.5, 0.5, w - 1, total - 0.5);
  c.fillStyle = pal.box; c.fillRect(0, C.sum - 0.5, w, 0.6);
  c.restore();
}

/* ---------- heading and footer (points) ---------- */
const TITLES = ['Marketing Report: By Principal-in-Charge', 'Marketing Report: By Market Sector'];
function paintHeading(c, F, pal, o) {
  const { W, page, hd, d, O, logoAt } = o;
  const full = page === 0 || O.logo === 'all';
  const showLogo = O.logo !== 'none' && full && logoImg;
  const rx = W - (showLogo ? hd.logoW + hd.clear : 0);
  c.textAlign = 'left';
  c.fillStyle = pal.title;
  // the title is the report's name and which breakdown this page is; the type shrinks until it fits beside the logo
  let size = full ? 25 : 20;
  for (c.font = fnt(F, 'cond', size, true); size > 12 && c.measureText(TITLES[page] || TITLES[0]).width > rx - 6; size -= 0.5) c.font = fnt(F, 'cond', size, true);
  c.fillText(TITLES[page] || TITLES[0], 0, full ? 24 : 20);
  c.fillStyle = pal.text2; c.font = fnt(F, 'cond', full ? 12.5 : 10.5);
  const sub = `As of ${longDay(d.meta.cutoff)}  ·  Version ${d.run.version}  ·  ${{ draft: 'Draft', published: 'Published', archived: 'Archived' }[d.run.status]}`;
  c.fillText(fitText(c, sub.toUpperCase(), rx - 6), 0, full ? 43 : 35);
  if (full) {
    c.font = fnt(F, 'ui', 9.4);
    c.fillText(fitText(c, 'All figures presented in this report are in net architectural revenue.', rx - 6), 0, 58);
    if (O.desc && O.desc.trim()) {
      c.fillStyle = pal.ink; c.font = fnt(F, 'ui', 10.5);
      wrap(c, O.desc.trim(), rx - 6, 4).forEach((t, i) => c.fillText(t, 0, 75 + i * 13));
    }
  }
  if (showLogo) logoAt(W - hd.logoW, 0, hd.logoW, hd.logoH);
}
function paintFooter(c, F, pal, o) {
  const { W, H, page, count, d, O } = o;
  c.font = fnt(F, 'ui', 8.5); c.fillStyle = pal.muted;
  c.textAlign = 'left';
  const left = [];
  if (O.printed) left.push('Printed ' + longDay(o.today));
  if (d.run.status === 'draft') left.push('DRAFT: not published');
  c.fillText(left.join('  ·  '), 0, H);
  c.textAlign = 'right';
  c.fillText(`Page ${page + 1} of ${count}`, W, H);
  c.textAlign = 'left';
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodName = p => { const s = String(p); return MONTHS[Number(s.slice(4, 6)) - 1] + ' ' + s.slice(0, 4); };
const longDay = ymd => { const [y, m, dd] = String(ymd).split('-').map(Number); return MONTHS[m - 1] + ' ' + dd + ', ' + y; };

/* ---------- a job: page geometry and a paint function ---------- */
export function buildJob(d, O, today) {
  const P = X.paperSize(O.paper, O.orientation);
  const descLines = O.desc && O.desc.trim() ? Math.min(4, Math.max(1, Math.ceil(O.desc.trim().length / 70))) : 0;
  const hd = X.headingHeights({ logo: O.logo, descLines });
  const secs = X.sectionsFor(d);
  const pl = X.plan({ sections: secs, P, firstHead: hd.full, laterHead: hd.compact });
  const pal = LOOKS.report.pal;
  const M = X.MARGIN;
  return {
    P, count: pl.pages.length, z: pl.z, pages: pl.pages, empty: !secs.length,
    paint(c, F, k, logoAt) {
      const pg = pl.pages[k];
      if (!pg) return;
      const W = P.w - 2 * M, Hh = P.h - 2 * M;
      c.save(); c.translate(M, M);
      const head = k === 0 || O.logo === 'all' ? hd.full : hd.compact;
      paintHeading(c, F, pal, { W, page: k, hd, d, O, logoAt: (x, y, w, h0) => logoAt(M + x, M + y, w, h0), head });
      const s = pg.s * pl.z, w = W / s;
      c.save(); c.translate(0, head + 2); c.scale(s, s);
      for (const it of pg.items) {
        const sec = secs.find(x => x.id === it.id);
        if (/Table$/.test(it.id)) paintTable(c, F, pal, w, it.y, sec, d); else paintChart(c, F, pal, w, it.y, sec, d);
      }
      c.restore();
      paintFooter(c, F, pal, { W, H: Hh, page: k, count: pl.pages.length, d, O, today });
      c.restore();
    },
  };
}

/* a canvas of one page at a pixel width: the preview */
export function pageCanvas(job, k, pxW) {
  const z = pxW / job.P.w;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(job.P.w * z); cv.height = Math.ceil(job.P.h * z);
  const c = cv.getContext('2d');
  c.scale(z, z);
  c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, job.P.w, job.P.h);
  job.paint(c, FONTS_CANVAS, k, (x, y, w, h0) => { if (!logoImg) return; c.save(); c.setTransform(z, 0, 0, z, 0, 0); c.drawImage(logoImg, x, y, w, h0); c.restore(); });
  return cv;
}

let libP = null;
function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
  if (!libP) libP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/shared/vendor/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf); s.onerror = () => { libP = null; rej(new Error('The PDF library did not load.')); };
    document.head.append(s);
  });
  return libP;
}

/* vector PDF: the same painting on jsPDF's context2d, with Lato and Roboto Condensed embedded. */
export async function buildPdf(d, O, today) {
  await fontsReady();
  if (O.logo !== 'none') await loadLogo();
  const lib = await loadJsPdf();
  const job = buildJob(d, O, today);
  const doc = new lib.jsPDF({ orientation: job.P.w > job.P.h ? 'landscape' : 'portrait', unit: 'pt', format: [Math.min(job.P.w, job.P.h), Math.max(job.P.w, job.P.h)], compress: true });
  if (doc.setProperties) doc.setProperties({ title: 'Marketing Report ' + periodName(d.run.period), creator: 'Arch Nexus Compass' });
  const vector = !!(doc.context2d && doc.addFileToVFS && doc.addFont);
  if (vector) for (const f of PDF_FONTS) { doc.addFileToVFS(f.file, f.data); doc.addFont(f.file, f.family, f.style); }
  for (let k = 0; k < job.count; k++) {
    if (k > 0) doc.addPage();
    if (vector) job.paint(doc.context2d, FONTS_PDF, k, (x, y, w, h0) => doc.addImage(LOGO.src, 'PNG', x, y, w, h0, 'arch-nexus-logo', 'SLOW'));
    else doc.addImage(pageCanvas(job, k, job.P.w * 3).toDataURL('image/png'), 'PNG', 0, 0, job.P.w, job.P.h);
  }
  return { bytes: doc.output('arraybuffer'), pages: job.count };
}
