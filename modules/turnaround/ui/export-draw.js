/* ===== Project Turnaround PDF: drawing (one set of code for the preview and the PDF) =====
   Text is measured first, so each block knows its height; logic/export-plan.js then decides the page breaks; this file paints.
   Only context calls jsPDF supports are used (save/restore, translate, fillRect/strokeRect, fillText, measureText, beginPath/moveTo/
   lineTo/stroke, setLineDash) and solid colors. Hex colors are allowed here, as in the Marketing Report's export: this is the printed page. */
import { FONTS_CANVAS, FONTS_PDF, PDF_FONTS, LOGO, fnt, fontsReady, loadLogo, logo, loadJsPdf, fitText, wrap, longDay, measurer } from '/shared/export/pdf-kit.js';
import { fmtCents, fmtK, fmtLoss, fmtWholePct, fmtDay, monthLetter, plural } from '/shared/ui/format.js';
import { kpiItems, planText, STANDING, MID_LABEL } from './overview.js';

const X = window.TurnExportPlan;

const PAL = {
  ink: '#1E2428', text2: '#50585E', muted: '#6E777D', title: '#006B97', rule: '#D5DADF', box: '#C3C9CF', headBg: '#EEF1F4',
  prev: '#C3C9CF', bar: '#66707B', now: '#0099D8', grid: '#E1E5E8',
  crit: '#C4312B', warn: '#A65F00', ok: '#4D7A00', blue: '#006B97', out: '#50585E',
};
const PLAN_TONE = { current: 'ok', update_due: 'warn', overdue: 'crit' };
const COLS = [0.27, 0.11, 0.34, 0.28];
const HEADS = ['PROJECT', 'PROFIT YTD', 'LATEST COMMENT', 'CURRENT GOAL'];
const LH = 11;      // line height in a table row
const PAD = 6;      // row padding
const COLHEAD = 16; // column heading band
const TILE_H = 60, CHART_H = 132;

/* ---------- measuring: turn the data into blocks with heights ---------- */
function rowBlock(c, p, xs, W) {
  const F = FONTS_CANVAS;
  const cw = i => (xs[i + 1] - xs[i]) * W - 2 * PAD - 2; // a little narrower than drawn, so PDF metrics never overflow
  c.font = fnt(F, 'ui', 8.5, true);
  const name = wrap(c, p.name, cw(0));
  c.font = fnt(F, 'ui', 8);
  const meta = wrap(c, `${p.wbs1} · PM ${p.pm.name}`, cw(0));
  const latest = p.latest ? wrap(c, p.latest.text, cw(2)) : ['Nothing logged yet.'];
  const n = p.goal;
  const next = n ? wrap(c, n.text, cw(3)) : ['No goal yet'];
  const c1 = name.length + meta.length + 1;
  const c3 = (p.latest ? 1 : 0) + latest.length;
  const c4 = (n ? 1 : 0) + next.length + (p.earlierMissed ? 1 : 0);
  const lines = Math.max(c1, 2, c3, c4);
  return { kind: 'row', p, name, meta, latest, next, h: lines * LH + 2 * PAD + 2 };
}

function picHead(pic, showStanding) {
  const r = pic.record;
  const bits = [`Done for this round ${pic.plansCurrent.current} of ${pic.plansCurrent.total}`];
  if (r) bits.push(`On time ${r.pctOnTime === null ? '-' : fmtWholePct(r.pctOnTime)}`, `Kept ${r.kept.kept} of ${r.kept.resolved}`);
  const st = r && showStanding && STANDING[r.standing];
  return { kind: 'pic', pic, right: bits.join('   ·   '), standing: st ? st : null, h: 24 + COLHEAD };
}

/* the content, in order, as blocks for the page plan */
function blocksFor(d, O, focus, showStanding, W) {
  const c = measurer();
  const pics = focus !== null ? d.pics.filter(p => p.code === focus) : d.pics;
  const pic = focus !== null ? pics[0] : null;
  const self = !!pic && d.viewer && d.viewer.role === 'pic' && pic.code === d.viewer.picCode;
  const who = self ? 'Your' : pic ? `${pic.name.split(' ')[0]}'s` : null;
  const blocks = [];
  const hist = pic ? pic.history : d.history;
  const wantChart = O.chart && hist && hist.length > 0;
  if (O.figures || wantChart) {
    const both = O.figures && wantChart;
    blocks.push({ id: 'top', kind: 'top', figures: O.figures ? kpiItems(d, pic, who) : null, hist: wantChart ? hist : null, who, pic, h: both ? Math.max(2 * TILE_H + 8, CHART_H) : O.figures ? TILE_H : CHART_H });
  }
  const repeatH = {};
  if (O.tables) {
    for (const pc of pics) {
      if (!pc.projects.length) {
        blocks.push({ id: 'pic:' + pc.code, kind: 'great', pic: pc, h: 30 });
        continue;
      }
      blocks.push({ id: 'pic:' + pc.code, group: pc.code, keepWithNext: true, ...picHead(pc, showStanding) });
      repeatH[pc.code] = 20 + COLHEAD;
      pc.projects.forEach((p, i) => blocks.push({ id: `row:${pc.code}:${i}`, group: pc.code, ...rowBlock(c, p, [0, ...COLS.map((_, k) => COLS.slice(0, k + 1).reduce((a, b) => a + b, 0))], W) }));
    }
  }
  return { blocks, repeatH, pics, pic, who };
}

/* ---------- painting ---------- */
const xsOf = W => { const xs = [0]; COLS.forEach(k => xs.push(xs[xs.length - 1] + k * W)); return xs; };

function paintColHead(c, F, W, y) {
  const xs = xsOf(W);
  c.fillStyle = PAL.headBg; c.fillRect(0, y, W, COLHEAD);
  c.fillStyle = PAL.text2; c.font = fnt(F, 'cond', 7.5, true);
  HEADS.forEach((t, i) => { c.textAlign = i === 1 ? 'right' : 'left'; c.fillText(t, i === 1 ? xs[2] - PAD : xs[i] + PAD, y + 11); });
  c.textAlign = 'left';
}

function paintPicHead(c, F, W, y, b, continued) {
  const pic = b.pic || b;
  c.textAlign = 'left';
  c.fillStyle = PAL.ink; c.font = fnt(F, 'cond', continued ? 11 : 13, true);
  const name = continued ? `${pic.name} (continued)` : pic.name;
  c.fillText(name, 0, y + (continued ? 13 : 16));
  let x = c.measureText(name).width + 10;
  if (!continued) {
    c.font = fnt(F, 'ui', 10, true); c.fillText(fmtCents(pic.totals.profit), x, y + 16);
    x += c.measureText(fmtCents(pic.totals.profit)).width + 6;
    c.font = fnt(F, 'ui', 9); c.fillStyle = PAL.muted; c.fillText(fmtLoss(100 * pic.totals.profit / pic.totals.billed), x, y + 16);
    c.textAlign = 'right'; let rx = W;
    if (b.standing) {
      c.font = fnt(F, 'ui', 8.5, true); c.fillStyle = PAL[b.standing[0]];
      c.fillText(b.standing[1], rx, y + 16); rx -= c.measureText(b.standing[1]).width + 14;
    }
    c.font = fnt(F, 'ui', 8.5); c.fillStyle = PAL.text2; c.fillText(b.right, rx, y + 16);
    c.textAlign = 'left';
  }
  paintColHead(c, F, W, y + (continued ? 20 : 24));
}

function paintRow(c, F, W, y, b) {
  const xs = xsOf(W), p = b.p;
  let ty = y + PAD + 8.5;
  // project: name, number and PM, plan status
  c.textAlign = 'left';
  c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 8.5, true);
  b.name.forEach(t => { c.fillText(t, xs[0] + PAD, ty); ty += LH; });
  c.fillStyle = PAL.muted; c.font = fnt(F, 'ui', 8);
  b.meta.forEach(t => { c.fillText(t, xs[0] + PAD, ty); ty += LH; });
  c.fillStyle = PAL[PLAN_TONE[p.plan.status] || (p.plan.daysOverdue > 0 ? 'crit' : 'out')]; c.font = fnt(F, 'ui', 8, true);
  c.fillText('• ' + planText(p.plan), xs[0] + PAD, ty);
  // profit
  c.textAlign = 'right';
  c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 8.5, true); c.fillText(fmtCents(p.profit.ytd), xs[2] - PAD, y + PAD + 8.5);
  c.fillStyle = PAL.muted; c.font = fnt(F, 'ui', 8); c.fillText(fmtLoss(p.pctYtd), xs[2] - PAD, y + PAD + 8.5 + LH);
  c.textAlign = 'left';
  // latest update, in full
  ty = y + PAD + 8.5;
  if (p.latest) { c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 8.5, true); c.fillText(fmtDay(p.latest.date), xs[2] + PAD, ty); ty += LH; }
  c.fillStyle = p.latest ? PAL.ink : PAL.muted; c.font = fnt(F, 'ui', 8.5);
  b.latest.forEach(t => { c.fillText(t, xs[2] + PAD, ty); ty += LH; });
  // the current goal: its approach and the latest mid-month word on it, then its words
  ty = y + PAD + 8.5;
  const n = p.goal;
  if (n) {
    c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 8.5, true); c.fillText(n.approach, xs[3] + PAD, ty);
    if (n.mid) {
      const dx = c.measureText(n.approach).width + 8;
      c.fillStyle = PAL[n.mid.status === 'stuck' ? 'crit' : 'ok']; c.font = fnt(F, 'ui', 8, true); c.fillText('• ' + MID_LABEL[n.mid.status], xs[3] + PAD + dx, ty);
    }
    ty += LH;
  }
  c.fillStyle = n ? PAL.ink : PAL.muted; c.font = fnt(F, 'ui', 8.5);
  b.next.forEach(t => { c.fillText(t, xs[3] + PAD, ty); ty += LH; });
  if (p.earlierMissed) { c.fillStyle = PAL.warn; c.font = fnt(F, 'ui', 8); c.fillText(`${plural(p.earlierMissed, 'earlier goal')} not reported on`, xs[3] + PAD, ty); }
  c.fillStyle = PAL.rule; c.fillRect(0, y + b.h - 0.5, W, 0.5);
}

function paintTile(c, F, x, y, w, h, it) {
  c.strokeStyle = PAL.box; c.lineWidth = 0.8; c.strokeRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
  c.textAlign = 'left';
  c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 8.5, true); c.fillText(fitText(c, it.label, w - 16), x + 8, y + 14);
  c.font = fnt(F, 'ui', 15, true); c.fillText(fitText(c, it.big, w - 16), x + 8, y + 33);
  c.fillStyle = PAL.muted; c.font = fnt(F, 'ui', 7.5);
  const sub = it.sub + (it.drafts !== null && it.drafts !== undefined ? ` ${plural(it.drafts, 'check-in draft')} ready.` : '');
  wrap(c, sub, w - 16, 2).forEach((t, i) => c.fillText(t, x + 8, y + 45 + i * 9));
}

function niceStep(range, ticks) {
  const raw = range / ticks, pow = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function paintChart(c, F, x, y, w, h, hist, who) {
  c.strokeStyle = PAL.box; c.lineWidth = 0.8; c.strokeRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
  const last = hist[hist.length - 1], prev = hist[hist.length - 2];
  c.textAlign = 'left'; c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 9, true);
  c.fillText(who ? `${who} negative YTD profit` : 'Total negative YTD profit', x + 8, y + 14);
  c.fillStyle = PAL.muted; c.font = fnt(F, 'ui', 7.5); c.fillText('In thousands. Gray is last year.', x + 8, y + 25);
  c.textAlign = 'right'; c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 12, true); c.fillText(fmtK(last.negativeYtd).replace('+', ''), x + w - 8, y + 17);
  if (prev) {
    const deeper = last.negativeYtd - prev.negativeYtd;
    c.fillStyle = PAL.muted; c.font = fnt(F, 'ui', 7.5);
    c.fillText(`${fmtK(Math.abs(deeper)).replace('+', '')} ${deeper <= 0 ? 'deeper' : 'shallower'} than last month`, x + w - 8, y + 27);
  }
  // bars down from zero
  const L = x + 40, R = x + w - 10, T = y + 36, B = y + h - 22;
  const lo = Math.min(...hist.map(p => p.negativeYtd), -1);
  const step = niceStep(-lo, 3), min = -Math.ceil(-lo / step) * step;
  const py = v => T + (v / min) * (B - T);
  c.font = fnt(F, 'cond', 7); c.textAlign = 'right';
  for (let v = 0; v >= min - 1; v -= step) {
    c.fillStyle = v === 0 ? PAL.muted : PAL.grid; c.fillRect(L, py(v) - 0.25, R - L, 0.5);
    c.fillStyle = PAL.muted; c.fillText(v === 0 ? '0' : fmtK(v), L - 4, py(v) + 2.5);
  }
  const slot = (R - L) / hist.length, bw = slot * 0.62;
  c.textAlign = 'center';
  hist.forEach((p, i) => {
    const bx = L + i * slot + (slot - bw) / 2;
    c.fillStyle = i === hist.length - 1 ? PAL.now : p.lastYear ? PAL.prev : PAL.bar;
    c.fillRect(bx, py(0), bw, Math.max(0.6, py(p.negativeYtd) - py(0)));
    c.fillStyle = PAL.muted; c.font = fnt(F, 'cond', 7); c.fillText(monthLetter(p.period), bx + bw / 2, B + 9);
    if (i === 0 || p.period % 100 === 1) { c.font = fnt(F, 'cond', 7, true); c.fillText(String(Math.floor(p.period / 100)), bx + bw / 2, B + 18); }
  });
  c.textAlign = 'left';
}

function paintTop(c, F, W, y, b) {
  if (b.figures && b.hist) {
    const lw = W * 0.48, tw = (lw - 8) / 2;
    b.figures.forEach((it, i) => paintTile(c, F, (i % 2) * (tw + 8), y + Math.floor(i / 2) * (TILE_H + 8), tw, TILE_H, it));
    paintChart(c, F, lw + 10, y, W - lw - 10, b.h, b.hist, b.who);
  } else if (b.figures) {
    const tw = (W - 24) / 4;
    b.figures.forEach((it, i) => paintTile(c, F, i * (tw + 8), y, tw, TILE_H, it));
  } else paintChart(c, F, 0, y, W, b.h, b.hist, b.who);
}

function paintGreat(c, F, W, y, b) {
  c.textAlign = 'left'; c.fillStyle = PAL.ink; c.font = fnt(F, 'cond', 13, true); c.fillText(b.pic.name, 0, y + 14);
  const x = c.measureText(b.pic.name).width + 10;
  c.fillStyle = PAL.ok; c.font = fnt(F, 'ui', 8.5, true); c.fillText('• No projects below break-even this year', x, y + 14);
  c.fillStyle = PAL.rule; c.fillRect(0, y + b.h - 0.5, W, 0.5);
}

/* ---------- heading and footer ---------- */
function paintHeading(c, F, o) {
  const { W, page, hd, d, O, who, logoAt } = o;
  const full = page === 0 || O.logo === 'all';
  const showLogo = O.logo !== 'none' && full && logo();
  const rx = W - (showLogo ? hd.logoW + hd.clear : 0);
  c.textAlign = 'left'; c.fillStyle = PAL.title;
  c.font = fnt(F, 'cond', full ? 22 : 16, true);
  c.fillText('Project Turnaround', 0, full ? 20 : 16);
  c.fillStyle = PAL.text2; c.font = fnt(F, 'cond', full ? 10.5 : 9);
  const sub = `${d.run.label} run  ·  Published ${longDay(new Date(d.run.publishedAt).toISOString())}  ·  ${who}`;
  c.fillText(fitText(c, sub.toUpperCase(), rx - 6), 0, full ? 36 : 28);
  if (full && O.desc && O.desc.trim()) {
    c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 10);
    wrap(c, O.desc.trim(), rx - 6, 4).forEach((t, i) => c.fillText(t, 0, 54 + i * 13));
  }
  if (showLogo) logoAt(W - hd.logoW, 0, hd.logoW, hd.logoH);
}
function paintFooter(c, F, o) {
  const { W, H, page, count, d, O, today } = o;
  c.font = fnt(F, 'ui', 8); c.fillStyle = PAL.muted;
  c.textAlign = 'left';
  c.fillText([O.printed ? 'Printed ' + longDay(today) : '', 'Project Turnaround, ' + d.run.label].filter(Boolean).join('  ·  '), 0, H);
  c.textAlign = 'right'; c.fillText(`Page ${page + 1} of ${count}`, W, H);
  c.textAlign = 'left';
}

/* ---------- a job: page geometry and a paint function ---------- */
export function buildJob(d, O, today, focus, showStanding) {
  const P = X.paperSize(O.paper, O.orientation);
  const M = X.MARGIN, W = P.w - 2 * M;
  const descLines = O.desc && O.desc.trim() ? Math.min(4, Math.max(1, Math.ceil(O.desc.trim().length / 90))) : 0;
  const hd = X.headingHeights({ logo: O.logo, descLines });
  const { blocks, repeatH, pic } = blocksFor(d, O, focus, showStanding, W);
  const who = pic ? pic.name : 'Everyone';
  const avail = head => P.h - 2 * M - head - X.FOOT - 8;
  const later = O.logo === 'all' ? hd.full : hd.compact;
  const pl = X.paginate({ blocks, first: avail(hd.full), later: avail(later), gap: X.GAP, repeatH });
  const byId = new Map(blocks.map(b => [b.id, b]));
  const pages = pl.pages.length ? pl.pages : [{ items: [] }];
  return {
    P, count: pages.length, tooTall: pl.tooTall, empty: !blocks.length,
    paint(c, F, k, logoAt) {
      const pg = pages[k];
      const Hh = P.h - 2 * M;
      c.save(); c.translate(M, M);
      const head = k === 0 ? hd.full : later;
      paintHeading(c, F, { W, page: k, hd, d, O, who, logoAt: (x, y, w, h0) => logoAt(M + x, M + y, w, h0) });
      const top = head + 8;
      for (const it of pg.items) {
        const y = top + it.y;
        if (it.repeat !== undefined) { paintPicHead(c, F, W, y, d.pics.find(p => p.code === it.repeat), true); continue; }
        const b = byId.get(it.id);
        if (b.kind === 'top') paintTop(c, F, W, y, b);
        else if (b.kind === 'pic') paintPicHead(c, F, W, y, b, false);
        else if (b.kind === 'great') paintGreat(c, F, W, y, b);
        else paintRow(c, F, W, y, b);
      }
      paintFooter(c, F, { W, H: Hh, page: k, count: pages.length, d, O, today });
      c.restore();
    },
  };
}

/* one page as a canvas at a pixel width: the preview */
export function pageCanvas(job, k, pxW) {
  const z = pxW / job.P.w;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(job.P.w * z); cv.height = Math.ceil(job.P.h * z);
  const c = cv.getContext('2d');
  c.scale(z, z);
  c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, job.P.w, job.P.h);
  job.paint(c, FONTS_CANVAS, k, (x, y, w, h0) => { const im = logo(); if (!im) return; c.save(); c.setTransform(z, 0, 0, z, 0, 0); c.drawImage(im, x, y, w, h0); c.restore(); });
  return cv;
}

export { fontsReady, loadLogo };

/* the vector PDF: the same painting on jsPDF's context2d, with Lato and Roboto Condensed embedded */
export async function buildPdf(d, O, today, focus, showStanding) {
  await fontsReady();
  if (O.logo !== 'none') await loadLogo();
  const lib = await loadJsPdf();
  const job = buildJob(d, O, today, focus, showStanding);
  const doc = new lib.jsPDF({ orientation: job.P.w > job.P.h ? 'landscape' : 'portrait', unit: 'pt', format: [Math.min(job.P.w, job.P.h), Math.max(job.P.w, job.P.h)], compress: true });
  if (doc.setProperties) doc.setProperties({ title: 'Project Turnaround ' + d.run.label, creator: 'Arch Nexus Compass' });
  const vector = !!(doc.context2d && doc.addFileToVFS && doc.addFont);
  if (vector) for (const f of PDF_FONTS) { doc.addFileToVFS(f.file, f.data); doc.addFont(f.file, f.family, f.style); }
  for (let k = 0; k < job.count; k++) {
    if (k > 0) doc.addPage();
    if (vector) job.paint(doc.context2d, FONTS_PDF, k, (x, y, w, h0) => doc.addImage(LOGO.src, 'PNG', x, y, w, h0, 'arch-nexus-logo', 'SLOW'));
    else doc.addImage(pageCanvas(job, k, job.P.w * 3).toDataURL('image/png'), 'PNG', 0, 0, job.P.w, job.P.h);
  }
  return { bytes: doc.output('arraybuffer'), pages: job.count };
}
