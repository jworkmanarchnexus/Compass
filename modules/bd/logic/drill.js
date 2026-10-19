/* ===== Marketing Report drill-downs: what is behind each bar =====
   Pure: no database, clock or network. Money is whole cents.

   The report's rows are totals. The drill-down shows the projects (or pursuits) that make up a total, in three forms:
     ytd       one amount per project: revenue billed to date this year
     forecast  one amount per project per REMAINING month of the year: contracted revenue still to bill (like the Vantagepoint forecast report)
     mwip      one amount per pursuit per remaining month: the MWIP backlog, probability-weighted and factored exactly as the report totals it
   Every line already counted in the report (computeBd's \`lines\`) is spread over the remaining months using the source's own monthly
   shape as weights, with the odd cents placed so each line adds back to exactly the amount the report used. So a drill-down always adds
   up to its bar. */
'use strict';

const sum = xs => xs.reduce((a, b) => a + b, 0);

/* split a whole-cent total across weights; the parts add to the total exactly (largest remainder). No usable weights: equal parts. */
function spread(total, weights) {
  if (!weights.length) return [];
  const sign = total < 0 ? -1 : 1, t = Math.abs(total);
  let w = weights.map(x => (x > 0 ? x : 0));
  let s = sum(w);
  if (!(s > 0)) { w = weights.map(() => 1); s = w.length; }
  const raw = w.map(x => t * x / s);
  const parts = raw.map(Math.floor);
  let left = t - sum(parts);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, left).forEach(([, i]) => { parts[i] += 1; });
  return parts.map(p => sign * p);
}

/* the months after the billing cutoff, as YYYYMM (a December report has none, so its last month stands in) */
function remainingMonths(period) {
  const year = Math.floor(period / 100), m = period % 100;
  const out = [];
  for (let k = m + 1; k <= 12; k++) out.push(year * 100 + k);
  return out.length ? out : [period];
}

/* input: { period, lines, forecastMonths, mwipMonths, names }
     lines           computeBd's lines: [{ kind: 'ytd'|'forecast'|'mwip', id, pic, sector, amount }]  (amount as counted in the report)
     forecastMonths  [{ id, month, amount }]  the source's monthly shape for a project (weights only)
     mwipMonths      [{ id, month, amount }]  the same for a pursuit
     names           { id: name }
   -> [{ kind, id, name, pic, sector, month, amount }]   month 0 for ytd */
function buildDetail({ period, lines, forecastMonths, mwipMonths, names }) {
  const months = remainingMonths(period);
  const out = [];
  const byId = (kind) => {
    const m = new Map();
    for (const l of lines.filter(x => x.kind === kind)) {
      if (!m.has(l.id)) m.set(l.id, { id: l.id, pic: l.pic, sector: l.sector, amount: 0 });
      m.get(l.id).amount += l.amount;
    }
    return [...m.values()];
  };
  const name = id => (names && names[id]) || id;
  for (const it of byId('ytd')) if (it.amount !== 0) out.push({ kind: 'ytd', id: it.id, name: name(it.id), pic: it.pic, sector: it.sector, month: 0, amount: it.amount });
  for (const [kind, shape] of [['forecast', forecastMonths || []], ['mwip', mwipMonths || []]]) {
    for (const it of byId(kind)) {
      if (it.amount === 0) continue;
      const mine = shape.filter(s => s.id === it.id);
      const parts = spread(it.amount, months.map(mo => sum(mine.filter(s => s.month === mo).map(s => s.amount))));
      months.forEach((mo, i) => out.push({ kind, id: it.id, name: name(it.id), pic: it.pic, sector: it.sector, month: mo, amount: parts[i] }));
    }
  }
  return out;
}

const api = { spread, remainingMonths, buildDetail };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.BdDrill = api;
