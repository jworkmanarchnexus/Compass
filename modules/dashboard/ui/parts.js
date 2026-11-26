/* My dashboard: what each dashpart draws, at each size. MADE-UP SAMPLE DATA in this file; nothing comes from the server yet.
   Each dashpart is { render(box), says(w, h) }:
   - box = { w, h, px, py }: its size in grid cells (as drawn on this screen) and the pixel size of its body.
     It draws more as it gets bigger (more rows, axis labels, names, a second chart), never a stretched copy.
   - says(w, h) is one plain sentence for edit mode: what this dashpart shows at that size. The resize arrows use it
     too ("Wider: adds the weekly trend") so a person can see what a change will do before making it.
   Everything here is static text we wrote, so building it as HTML strings is safe. Colors are classes in dashboard.css. */

const usd = k => { const d = Math.abs(k) * 1000, s = k < 0 ? '-$' : '$'; return d >= 1e6 ? s + (d / 1e6).toFixed(2) + 'M' : s + Math.round(d / 1000) + 'K'; };
const pct = (n, signed) => (signed && n > 0 ? '+' : '') + Math.round(n) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = (W, H, inner, cls) => `<svg class="dp-svg${cls ? ' ' + cls : ''}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${inner}</svg>`;
const kpi = (label, big, sub, extra) => `<div class="dpk"><div class="dpk-l">${label}</div><div class="dpk-b">${big}</div>${sub ? `<div class="dpk-s">${sub}</div>` : ''}${extra || ''}</div>`;
const legend = items => `<div class="dp-legend">${items.map(([cls, t]) => `<span><i class="${cls}"></i>${esc(t)}</span>`).join('')}</div>`;
const rowsFit = (py, rowH, min) => Math.max(min || 1, Math.floor(py / rowH));

/* a line through values, scaled into the box; returns path and area strings */
function linePath(vals, x0, y0, W, H, lo, hi) {
  const n = vals.length, sx = i => x0 + (n === 1 ? W / 2 : i * W / (n - 1)), sy = v => y0 + H - (v - lo) / (hi - lo || 1) * H;
  const pts = vals.map((v, i) => [sx(i), sy(v)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  return { d, area: d + `L${sx(n - 1).toFixed(1)} ${y0 + H}L${x0} ${y0 + H}Z`, pts };
}

/* ---------- My projects below break-even ---------- */
const TURN = [
  { name: 'Riverside Library Renovation', ytd: -38.4, status: 'Overdue', tone: 'warn' },
  { name: 'Canyon Clinic Tenant Improvement', ytd: -12.9, status: 'Update due', tone: 'blue' },
  { name: 'Westgate Elementary Addition', ytd: -4.7, status: 'No plan', tone: 'warn' },
  { name: 'Mesa Fire Station 4', ytd: -2.1, status: 'Current', tone: 'ok' },
];
const turnaround = {
  href: '#/turnaround', area: 'turnaround',
  says(w, h) {
    if (w === 1 && h === 1) return 'How many of your projects are listed, and their total year to date.';
    if (h === 1) return 'The projects furthest below break-even, with where each plan stands.';
    if (w === 1) return 'Each listed project, stacked, with its year to date and plan status.';
    return 'Every listed project, with a bar for how far below break-even it is.';
  },
  render({ w, h, py }) {
    const total = TURN.reduce((a, p) => a + p.ytd, 0);
    if (w === 1 && h === 1) return kpi('Below break-even', `${TURN.length} projects`, `${usd(total)} year to date`,
      `<div class="dp-chips"><span class="chip warn">1 overdue</span><span class="chip warn">1 no plan</span></div>`);
    const worst = Math.min(...TURN.map(p => p.ytd));
    const rowH = w === 1 ? 52 : (h > 1 ? 44 : 34);
    const n = rowsFit(py, rowH) >= TURN.length ? TURN.length : rowsFit(py - 18, rowH);
    return `<ul class="dp-list${w === 1 ? ' stacked' : ''}">${TURN.slice(0, n).map(p => `<li>
      <span class="nm">${esc(p.name)}</span>
      ${h > 1 && w > 1 ? `<span class="dp-minibar"><i style="width:${Math.round(p.ytd / worst * 100)}%"></i></span>` : ''}
      <span class="num">${usd(p.ytd)}</span><span class="chip ${p.tone}">${p.status}</span></li>`).join('')}</ul>
      ${n < TURN.length ? `<div class="dp-more">${TURN.length - n} more</div>` : ''}`;
  },
};

/* ---------- Revenue against goal ---------- */
const MONTHS = 'JFMAMJJASOND';
const REV = { goal: 1900, months: [98, 121, 135, 110, 142, 128, 150, 119, 161, 156] };
const revenue = {
  href: '#/bd', area: 'bd',
  says(w, h) {
    if (w === 1) return h === 1 ? 'Revenue so far, percent of goal, and a bar with your pace mark.' : 'Revenue so far and the pace bar, with each month underneath.';
    return h === 1 ? 'Revenue so far beside a running total against pace.' : 'Revenue so far, the running total against pace, and each month as a bar.';
  },
  render({ w, h, px, py }) {
    const ytd = REV.months.reduce((a, b) => a + b, 0), pace = REV.goal * REV.months.length / 12;
    const bar = `<div class="dp-prog" title="Pace"><i style="width:${(ytd / REV.goal * 100).toFixed(1)}%"></i><b style="left:${(pace / REV.goal * 100).toFixed(1)}%"></b></div>`;
    const head = kpi('Year to date', usd(ytd), `${pct(ytd / REV.goal * 100)} of ${usd(REV.goal)} goal · ${pct(ytd / pace * 100)} of pace`, bar);
    const monthBars = (W, H) => {
      const max = Math.max(...REV.months), bw = W / 12;
      return REV.months.map((v, i) => `<rect class="f1" x="${(i * bw + bw * .18).toFixed(1)}" y="${(H - 12 - v / max * (H - 16)).toFixed(1)}" width="${(bw * .64).toFixed(1)}" height="${(v / max * (H - 16)).toFixed(1)}" rx="2"/>`).join('')
        + MONTHS.split('').map((m, i) => `<text class="tk" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 1}" text-anchor="middle">${m}</text>`).join('');
    };
    if (w === 1) return head + (h > 1 ? `<div class="dp-fill">${svg(px, Math.max(60, py - 112), monthBars(px, Math.max(60, py - 112)))}</div>` : '');
    const left = Math.min(200, Math.round(px * .34)), W = px - left - 12, H = py;
    const lineH = h > 1 ? Math.round(H * .58) : H - 14 - (w >= 3 ? 24 : 0);
    let cum = 0; const run = REV.months.map(v => (cum += v));
    const paceEnd = linePath([0, REV.goal], 4, 6, W - 8, lineH - 10, 0, REV.goal);
    // the actual line covers 10 of 12 months, so squeeze it to that share of the width
    const sq = linePath(run, 4, 6, (W - 8) * (run.length - 1) / 11, lineH - 10, 0, REV.goal);
    const chart = `<path class="pace" d="${paceEnd.d}"/><path class="area1" d="${sq.area}"/><path class="ln1" d="${sq.d}"/>`
      + `<circle class="dot1" cx="${sq.pts[sq.pts.length - 1][0].toFixed(1)}" cy="${sq.pts[sq.pts.length - 1][1].toFixed(1)}" r="3.5"/>`
      + (h === 1 ? MONTHS.split('').map((m, i) => i % (W < 260 ? 3 : 1) ? '' : `<text class="tk" x="${(4 + i * (W - 8) / 11).toFixed(1)}" y="${lineH + 10}" text-anchor="middle">${m}</text>`).join('') : '');
    return `<div class="dp-split" style="grid-template-columns:${left}px 1fr">${head}<div>
      ${w >= 3 ? legend([['k1', 'Running total'], ['kpace', `Pace to the ${usd(REV.goal)} goal`]]) : ''}
      ${svg(W, lineH + (h === 1 ? 12 : 0), chart)}
      ${h > 1 ? svg(W, H - lineH - (w >= 3 ? 30 : 8), monthBars(W, H - lineH - (w >= 3 ? 30 : 8))) : ''}</div></div>`;
  },
};

/* ---------- Pipeline (MWIP) ---------- */
const PIPE = { weeks: [820, 845, 830, 880, 910, 905, 940, 925, 960, 990, 1010, 1050],
  pursuits: [['Juniper Federal Courthouse', 420, 40], ['Harbor Logistics Center', 310, 60], ['Aspen Medical Office', 180, 50], ['Northside Library', 140, 25], ['Lakeview TI', 60, 80]] };
const pipeline = {
  href: '#/pipeline', area: 'pipeline',
  says(w, h) {
    const base = w === 1 ? 'This week\'s MWIP, the change, and a 12-week sparkline.' : 'This week\'s MWIP beside a 12-week trend with dates.';
    return h > 1 ? base + ' Taller adds your biggest pursuits.' : base;
  },
  render({ w, h, px, py }) {
    const now = PIPE.weeks[PIPE.weeks.length - 1], delta = now - PIPE.weeks[PIPE.weeks.length - 2];
    const head = kpi('MWIP this week', usd(now), `+${usd(delta).slice(1)} since last week`);
    const top = h > 1 ? Math.round(py * .5) : py;
    const lo = Math.min(...PIPE.weeks) * .96, hi = Math.max(...PIPE.weeks) * 1.02;
    const list = h > 1 ? `<ul class="dp-list compact">${PIPE.pursuits.slice(0, rowsFit(py - top - 6, 28)).map(([n, a, p]) => `<li><span class="nm">${esc(n)}</span><span class="muted">${p}%</span><span class="num">${usd(a)}</span></li>`).join('')}</ul>` : '';
    if (w === 1) {
      const H = Math.max(28, top - 78), L = linePath(PIPE.weeks, 2, 4, px - 4, H - 8, lo, hi);
      return head + svg(px, H, `<path class="area1" d="${L.area}"/><path class="ln1" d="${L.d}"/>`) + list;
    }
    const left = Math.min(190, Math.round(px * .36)), W = px - left - 12, H = top - 4;
    const L = linePath(PIPE.weeks, 4, 6, W - 8, H - 24, lo, hi);
    const ticks = ['Sep 8', 'Oct 6', 'Nov 3', 'Nov 24'].map((t, i, a) => `<text class="tk" x="${(4 + i * (W - 8) / (a.length - 1)).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle'}">${t}</text>`).join('');
    return `<div class="dp-split" style="grid-template-columns:${left}px 1fr">${head}${svg(W, H, `<path class="area1" d="${L.area}"/><path class="ln1" d="${L.d}"/>${ticks}`)}</div>${list}`;
  },
};

/* ---------- Unbilled work ---------- */
const AGE = [['0 to 30 days', 84, 'a1'], ['31 to 60', 41, 'a2'], ['61 to 90', 18, 'a3'], ['Over 90', 9, 'a4']];
const UNB = [['Mesa Fire Station 4', 12, 95], ['Riverside Library Renovation', 38, 74], ['Canyon Clinic Tenant Improvement', 22, 48], ['Westgate Elementary Addition', 19, 31], ['Harbor Logistics Center', 27, 12]];
const unbilled = {
  says(w, h) {
    const base = w === 1 ? 'The total not yet invoiced and how much has waited over 60 days, with an aging bar.' : 'The total, with each age bracket labeled under the bar.';
    return h > 1 ? base + ' Taller lists the projects, oldest first.' : base;
  },
  render({ w, h, py }) {
    const total = AGE.reduce((a, b) => a + b[1], 0), old = AGE[2][1] + AGE[3][1];
    const bar = `<div class="dp-stack">${AGE.map(([l, v, c]) => `<i class="${c}" style="flex:${v}" title="${l}: ${usd(v)}"></i>`).join('')}</div>`;
    const labels = w > 1 ? legend(AGE.map(([l, v, c]) => [c, `${l} ${usd(v)}`])) : '';
    const list = h > 1 ? `<ul class="dp-list compact">${UNB.slice(0, rowsFit(py - (w > 1 ? 150 : 120), 28)).map(([n, v, d]) => `<li><span class="nm">${esc(n)}</span><span class="muted">${d} days</span><span class="num">${usd(v)}</span></li>`).join('')}</ul>` : '';
    return kpi('Not yet invoiced', usd(total), `${usd(old)} has waited over 60 days`, bar + labels) + list;
  },
};

/* ---------- Portfolio: margin against fee ---------- */
const SECTORS = [['s1', 'Federal'], ['s2', 'Industrial'], ['s3', 'Tenant improvement'], ['s4', 'Commercial']];
const PROJ = [
  ['Juniper Courthouse', 1850, 18, 9400, 's1'], ['Harbor Logistics', 1420, 9, 7100, 's2'], ['Riverside Library', 980, -6, 6900, 's4'],
  ['Mesa Fire Station', 640, 22, 2900, 's1'], ['Canyon Clinic TI', 210, -3, 1500, 's3'], ['Aspen Medical', 760, 14, 3900, 's4'],
  ['Westgate Elementary', 1120, 4, 6100, 's4'], ['Lakeview TI', 160, 27, 700, 's3'], ['Depot Warehouse', 520, 31, 2000, 's2'],
  ['VA Clinic Remodel', 890, 12, 4400, 's1'], ['Summit Offices TI', 340, 19, 1600, 's3'], ['Ridge Plant Expansion', 1260, 24, 5300, 's2'],
  ['Oak Street Retail', 450, -11, 2800, 's4'], ['Granite Ridge Lab', 1580, 7, 8200, 's2'],
];
const bubble = {
  says(w, h) {
    const parts = ['Every project by fee and margin, with the 15% target line'];
    if (w >= 3) parts.push(w === 3 ? 'names on the projects below target' : 'names on every project below target and the three largest');
    if (h >= 3) parts.push('a finer margin scale');
    return parts.join('; ') + '.';
  },
  render({ w, h, px, py }) {
    const LEG = 26, padL = 34, padB = 20, W = px, H = py - LEG, ch = H - padB - 6, rMax = Math.max(10, Math.min(W - padL, ch, 300) / 9), cw = W - padL - 6 - rMax * .6;
    const xMax = 2000, yLo = -20, yHi = 40, sx = v => padL + v / xMax * cw, sy = v => 6 + (yHi - v) / (yHi - yLo) * ch;
    const step = h >= 3 ? 10 : 20, maxHrs = Math.max(...PROJ.map(p => p[3]));
    let g = '';
    for (let v = yLo; v <= yHi; v += step) g += `<line class="grid" x1="${padL}" x2="${W - 6}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tk" x="${padL - 5}" y="${sy(v) + 3.5}" text-anchor="end">${v}%</text>`;
    const xt = cw > 420 ? [0, 500, 1000, 1500, 2000] : [0, 1000, 2000];
    for (const v of xt) g += `<text class="tk" x="${sx(v)}" y="${H - 4}" text-anchor="${v === 0 ? 'start' : v === xMax ? 'end' : 'middle'}">${v ? usd(v) : '$0'}</text>`;
    g += `<line class="zero" x1="${padL}" x2="${W - 6}" y1="${sy(0)}" y2="${sy(0)}"/><line class="target" x1="${padL}" x2="${W - 6}" y1="${sy(15)}" y2="${sy(15)}"/>`;
    if (w >= 3) g += `<text class="tk tgt" x="${padL + 4}" y="${sy(15) - 5}">15% target</text>`;
    const sorted = PROJ.slice().sort((a, b) => b[3] - a[3]);
    const big3 = new Set(sorted.slice(0, 3).map(p => p[0]));
    for (const [n, fee, m, hrs, s] of sorted) g += `<circle class="bub ${s}" cx="${sx(fee).toFixed(1)}" cy="${sy(m).toFixed(1)}" r="${(Math.sqrt(hrs / maxHrs) * rMax).toFixed(1)}"><title>${esc(n)}: ${usd(fee)} fee, ${m}% margin</title></circle>`;
    if (w >= 3) for (const [n, fee, m, hrs] of PROJ) if (m < 15 && (w === 4 || m < 5) || (w === 4 && big3.has(n))) {
      const r = Math.sqrt(hrs / maxHrs) * rMax;
      const left = sx(fee) > padL + cw * .7; // near the right edge: name on the left of the bubble
      g += `<text class="blbl" x="${(sx(fee) + (left ? -r - 3 : r + 3)).toFixed(1)}" y="${(sy(m) + 3.5).toFixed(1)}" text-anchor="${left ? 'end' : 'start'}">${esc(n)}</text>`;
    }
    return legend(SECTORS) + svg(W, H, g);
  },
};

/* ---------- Fee by phase ---------- */
const PHASES = [['SD', 'Schematic design', 180, 171], ['DD', 'Design development', 270, 284], ['CD', 'Construction documents', 600, 642], ['Bid', 'Bidding', 75, 61], ['CA', 'Construction administration', 375, 518]];
const phase = {
  says(w, h) {
    if (h === 1) return w >= 3 ? 'How far over or under plan each phase is, with full phase names.' : 'How far over or under plan each phase is.';
    return w >= 3 ? 'Planned against actual fee for each phase, with the dollar amounts.' : 'Planned against actual fee for each phase, with the percent over or under.';
  },
  render({ w, h, px, py }) {
    if (h === 1) {
      const max = Math.max(...PHASES.map(p => Math.abs(p[3] / p[2] - 1))) * 100, lab = w >= 3 ? 190 : 40;
      const rowH = Math.max(16, Math.floor(py / PHASES.length));
      return `<div class="dp-div" style="--lab:${lab}px">${PHASES.map(([s, l, pl, ac]) => {
        const v = (ac / pl - 1) * 100, wd = Math.abs(v) / max * 50;
        return `<div class="r" style="height:${rowH}px"><span class="l">${w >= 3 ? l : s}</span><span class="track"><i class="${v > 0 ? 'over' : 'under'}" style="${v > 0 ? 'left:50%' : `right:50%`};width:${wd.toFixed(1)}%"></i></span><span class="v">${pct(v, true)}</span></div>`;
      }).join('')}</div>`;
    }
    const LEG = 26, H = py - LEG, padB = 30, max = Math.max(...PHASES.map(p => Math.max(p[2], p[3]))), slot = px / PHASES.length, bw = Math.min(34, slot * .3);
    let g = '';
    PHASES.forEach(([s, l, pl, ac], i) => {
      const cx = slot * i + slot / 2, hp = pl / max * (H - padB - 16), ha = ac / max * (H - padB - 16), base = H - padB, v = (ac / pl - 1) * 100;
      g += `<rect class="plan" x="${(cx - bw - 1).toFixed(1)}" y="${(base - hp).toFixed(1)}" width="${bw.toFixed(1)}" height="${hp.toFixed(1)}" rx="2"/>`;
      g += `<rect class="${v > 10 ? 'over' : 'f1'}" x="${(cx + 1).toFixed(1)}" y="${(base - ha).toFixed(1)}" width="${bw.toFixed(1)}" height="${ha.toFixed(1)}" rx="2"/>`;
      g += `<text class="tk strong" x="${cx}" y="${base + 13}" text-anchor="middle">${s}</text>`;
      g += `<text class="tk" x="${cx}" y="${base + 26}" text-anchor="middle">${w >= 3 ? `${usd(ac)} of ${usd(pl)}` : pct(v, true)}</text>`;
      if (w >= 3) g += `<text class="tk ${v > 10 ? 'warnt' : ''}" x="${(cx + 1 + bw / 2).toFixed(1)}" y="${(base - ha - 4).toFixed(1)}" text-anchor="middle">${pct(v, true)}</text>`;
    });
    return legend([['kplan', 'Planned'], ['k1', 'Actual'], ['kover', 'More than 10% over']]) + svg(px, H, `<line class="zero" x1="0" x2="${px}" y1="${H - padB}" y2="${H - padB}"/>` + g);
  },
};

/* ---------- Staff mix by role ---------- */
const ROLES = [['r1', 'Principal in charge'], ['r2', 'Project manager'], ['r3', 'Project architect'], ['r4', 'Production'], ['r5', 'Visualization']];
const MIX = [['Firm', [8, 14, 22, 48, 8]], ['Your projects', [17, 12, 20, 44, 7]], ['Riverside Library', [22, 10, 18, 45, 5]], ['Canyon Clinic TI', [9, 16, 25, 42, 8]], ['Westgate Elementary', [14, 15, 20, 43, 8]], ['Mesa Fire Station', [25, 8, 15, 46, 6]], ['Juniper Courthouse', [6, 18, 24, 44, 8]], ['Harbor Logistics', [11, 13, 22, 46, 8]]];
const staffmix = {
  says(w, h) {
    const rows = h === 1 ? 'The firm against all your projects' : h === 2 ? 'The firm, your projects, and a bar for each of your five largest projects' : 'The firm, your projects, and a bar for every project';
    return rows + (w >= 3 ? ', with the percent inside each part.' : '.');
  },
  render({ w, h, px, py }) {
    const n = h === 1 ? 2 : Math.min(MIX.length, rowsFit(py - 30, 30, 2)), lab = Math.min(150, Math.round(px * .3));
    return legend(ROLES) + `<div class="dp-mix" style="--lab:${lab}px">${MIX.slice(0, n).map(([name, v], i) => `<div class="r${i < 2 ? ' head' : ''}"><span class="l">${esc(name)}</span><span class="dp-stack">${v.map((x, j) => `<i class="${ROLES[j][0]}" style="flex:${x}" title="${ROLES[j][1]}: ${x}%">${w >= 3 && x >= 10 ? x + '%' : ''}</i>`).join('')}</span></div>`).join('')}</div>`;
  },
};

/* ---------- Client scorecard ---------- */
const CLIENTS = [['County of Mesa', 2140, 18, 38, 6, 80], ['Juniper Federal', 1850, 12, 52, 2, 50], ['Harbor Partners', 1420, 9, 71, 3, 25], ['Westgate School District', 1120, 4, 44, 4, 60], ['Aspen Health', 760, 15, 33, 3, 100], ['Oak Street Holdings', 450, -11, 88, 2, 0], ['Summit Realty', 340, 19, 29, 5, 75], ['Lakeview Properties', 160, 27, 41, 2, 50]];
const clients = {
  says(w, h) {
    const cols = w === 2 ? 'Each client\'s revenue and margin' : w === 3 ? 'Revenue, margin and days to pay' : 'Revenue, margin, days to pay, repeat projects and extra services accepted';
    return `${cols}, ${h === 2 ? 'for your largest clients' : 'for about twice as many clients'}.`;
  },
  render({ w, py }) {
    const n = Math.min(CLIENTS.length, rowsFit(py - 30, 30));
    const tone = m => m >= 15 ? 'ok' : m >= 5 ? '' : 'warn', dot = d => d <= 45 ? 'ok' : d <= 60 ? 'mid' : 'late';
    const th = ['Client', 'Revenue', 'Margin'].concat(w >= 3 ? ['Days to pay'] : [], w >= 4 ? ['Projects', 'Extras accepted'] : []);
    return `<table class="dp-table"><thead><tr>${th.map((t, i) => `<th${i ? ' class="r"' : ''}>${t}</th>`).join('')}</tr></thead><tbody>${CLIENTS.slice(0, n).map(([c, r, m, d, p, a]) => `<tr>
      <td class="nm">${esc(c)}</td><td class="r">${usd(r)}</td><td class="r"><span class="chip ${tone(m)}">${m}%</span></td>
      ${w >= 3 ? `<td class="r"><span class="dp-dot ${dot(d)}"></span>${d}</td>` : ''}${w >= 4 ? `<td class="r">${p}</td><td class="r">${a}%</td>` : ''}</tr>`).join('')}</tbody></table>`;
  },
};

/* ---------- Where the fee goes ---------- */
const LEAK = { fee: 2400, notBilled: 190, writtenOff: 70, owed: 160 };
const leakage = {
  says(w, h) {
    if (h === 1) return w >= 3 ? 'One bar for the whole fee: collected, still owed, written off and not billed, with amounts and percents.' : 'One bar for the whole fee: collected, still owed, written off and not billed.';
    return w >= 3 ? 'A step chart from contract fee to collected, with every amount.' : 'A step chart from contract fee to collected.';
  },
  render({ w, h, px, py }) {
    const { fee, notBilled, writtenOff, owed } = LEAK, collected = fee - notBilled - writtenOff - owed;
    const seg = [['l1', 'Collected', collected], ['l2', 'Still owed', owed], ['l3', 'Written off', writtenOff], ['l4', 'Not billed', notBilled]];
    if (h === 1) {
      return kpi('Contract fee on your projects', usd(fee), `${pct(collected / fee * 100)} is collected`,
        `<div class="dp-stack tall">${seg.map(([c, l, v]) => `<i class="${c}" style="flex:${v}" title="${l}: ${usd(v)}"></i>`).join('')}</div>`
        + legend(seg.map(([c, l, v]) => [c, w >= 3 ? `${l} ${usd(v)} (${pct(v / fee * 100)})` : l])));
    }
    const steps = [['Fee', 0, fee, 'f1'], ['Not billed', fee - notBilled, fee, 'l4'], ['Billed', 0, fee - notBilled, 'f1'], ['Written off', fee - notBilled - writtenOff, fee - notBilled, 'l3'], ['Still owed', collected, collected + owed, 'l2'], ['Collected', 0, collected, 'l1']];
    const H = py, padB = 34, top = 14, sy = v => top + (1 - v / fee) * (H - padB - top), slot = px / steps.length, bw = Math.min(54, slot * .62);
    let g = '';
    steps.forEach(([l, lo, hi, c], i) => {
      const x = slot * i + (slot - bw) / 2;
      g += `<rect class="${c}" x="${x.toFixed(1)}" y="${sy(hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, sy(lo) - sy(hi)).toFixed(1)}" rx="2"/>`;
      if (i < steps.length - 1) g += `<line class="grid" x1="${(x + bw).toFixed(1)}" x2="${(x + slot).toFixed(1)}" y1="${sy(i % 2 ? lo : hi).toFixed(1)}" y2="${sy(i % 2 ? lo : hi).toFixed(1)}"/>`;
      g += `<text class="tk" x="${(slot * i + slot / 2).toFixed(1)}" y="${H - padB + 14}" text-anchor="middle">${l}</text>`;
      if (w >= 3 || px > 520) g += `<text class="tk strong" x="${(slot * i + slot / 2).toFixed(1)}" y="${H - padB + 28}" text-anchor="middle">${(c === 'f1' || c === 'l1' ? '' : '-') + usd(hi - lo).replace('-', '')}</text>`;
    });
    return svg(px, H, `<line class="zero" x1="0" x2="${px}" y1="${sy(0)}" y2="${sy(0)}"/>` + g);
  },
};

export const PARTS = { turnaround, revenue, pipeline, unbilled, bubble, phase, staffmix, clients, leakage };

/* draws one dashpart into `el` at its current size. A dashpart with no drawing yet gets a plain placeholder. */
export function drawPart(el, id, box) {
  const p = PARTS[id];
  el.innerHTML = p ? p.render(box) : `<div class="dp-empty">Not drawn yet</div>`;
}
export function partSays(id, w, h) { const p = PARTS[id]; return p ? p.says(w, h) : ''; }
export function partLink(id) { const p = PARTS[id]; return p && p.href ? { href: p.href, area: p.area } : null; }
