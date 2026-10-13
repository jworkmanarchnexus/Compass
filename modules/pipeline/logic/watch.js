/* ===== Pipeline watch: weekly snapshots, what changed, and the alert rules =====
   Pure: no database, clock or network. Money is whole cents; dates are 'YYYY-MM-DD'. Tested from tests/fixtures/watch.json.

   A snapshot is what the pipeline looked like on one Monday:
     { date, pursuits: [{ id, name, pic, stage, winProb, amount }],          MWIP: pursuits not yet contracted, through Dec 31
              forecast: [{ wbs1, name, pic, amount, moved }] }                contracted work still to bill through Dec 31; moved = the part now scheduled for next year
   History is an array of snapshots, oldest first. `projects` is [{ wbs1, name, pic, opened }]: the project numbers that exist, used to
   tell a pursuit that became a project ("matched, not a loss") from one that just vanished.

   A pursuit's id is its project number: when a pursuit is promoted to a project it keeps the number, so a pursuit that left MWIP
   and has a project with its number "converted". One that left and has no such project is flagged. */
'use strict';

const DAY = 86400000;
const ms = d => Date.parse(d + 'T00:00:00Z');
const addDays = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

const money = c => (c < 0 ? '-$' : '$') + (Math.abs(c) >= 100000 ? Math.round(Math.abs(c) / 100000).toLocaleString('en-US') + 'K' : Math.round(Math.abs(c) / 100).toLocaleString('en-US'));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = d => { const [, m, dd] = d.split('-').map(Number); return MON[m - 1] + ' ' + dd; };
const shortName = full => { const p = String(full || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0] || ''; };

/* every pursuit the history knows about, with when it first appeared, where it stands now, and how it left */
function pursuitLog(history, projects) {
  const open = new Map((projects || []).map(p => [p.wbs1, p]));
  const log = new Map();
  history.forEach((snap, i) => {
    for (const p of snap.pursuits) {
      let e = log.get(p.id);
      if (!e) { e = { id: p.id, firstSeen: snap.date, first: i === 0, trail: [] }; log.set(p.id, e); }
      e.name = p.name; e.pic = p.pic; e.stage = p.stage; e.winProb = p.winProb; e.amount = p.amount; e.lastSeen = snap.date; e.lastIndex = i;
      e.trail.push({ date: snap.date, amount: p.amount, stage: p.stage, winProb: p.winProb });
    }
  });
  const lastIdx = history.length - 1;
  for (const e of log.values()) {
    e.present = e.lastIndex === lastIdx;
    if (!e.present) {
      const gone = history[e.lastIndex + 1].date;
      const proj = open.get(e.id);
      e.leftOn = gone;
      e.outcome = proj ? 'converted' : 'no_match';
      if (proj) { e.wbs1 = proj.wbs1; e.openedOn = proj.opened; }
    }
  }
  return log;
}

/* the changes between two snapshots, per pursuit: for the "what happened" column */
function changes(prev, cur, log) {
  const was = new Map(prev.pursuits.map(p => [p.id, p])), now = new Map(cur.pursuits.map(p => [p.id, p]));
  const out = [];
  for (const [id, p] of now) {
    const w = was.get(id);
    if (!w) out.push({ id, pic: p.pic, kind: 'new', from: 0, to: p.amount });
    else if (w.amount !== p.amount || w.stage !== p.stage || w.winProb !== p.winProb) out.push({ id, pic: p.pic, kind: 'changed', from: w.amount, to: p.amount, stageFrom: w.stage, stageTo: p.stage, winFrom: w.winProb, winTo: p.winProb });
  }
  for (const [id, w] of was) if (!now.has(id)) { const e = log && log.get(id); out.push({ id, pic: w.pic, kind: 'left', from: w.amount, to: 0, outcome: e ? e.outcome : undefined, wbs1: e && e.wbs1 }); }
  return out;
}

/* a PIC's total in each snapshot: [{ date, amount }] */
function totals(history, kind) {
  const pics = new Set();
  for (const s of history) for (const x of kind === 'mwip' ? s.pursuits : s.forecast) pics.add(x.pic);
  const out = new Map();
  for (const pic of pics) out.set(pic, history.map(s => ({ date: s.date, amount: sum((kind === 'mwip' ? s.pursuits : s.forecast).filter(x => x.pic === pic), x => x.amount) })));
  return out;
}

/* the value `days` or more before the last snapshot (the latest snapshot at least that old); null when the history is too short */
function before(series, days) {
  const last = series[series.length - 1];
  for (let i = series.length - 2; i >= 0; i--) if (daysBetween(series[i].date, last.date) >= days) return series[i];
  return null;
}

/* consecutive snapshots, ending at the last one, where the amount fell each time */
function slideRun(series) {
  let n = 0;
  for (let i = series.length - 1; i > 0; i--) { if (series[i].amount < series[i - 1].amount) n++; else break; }
  return n;
}

/* The table for one tab: a row per PIC (and the firm), the last `weeks` values, this week's change, the change against 4 weeks ago,
   and the counts. pics orders the rows. */
function picRows({ history, kind, projects, weeks, pics }) {
  weeks = weeks || 8;
  const log = pursuitLog(history, projects);
  const tot = totals(history, kind);
  const last = history[history.length - 1].date;
  const first = history[0].date;
  const win = d => daysBetween(d, last) <= 30 && d > first;
  const forecastFirst = new Map();
  history.forEach((s, i) => { for (const f of s.forecast) if (!forecastFirst.has(f.wbs1)) forecastFirst.set(f.wbs1, { date: s.date, pic: f.pic, first: i === 0 }); });
  const row = (pic, label, series) => {
    const tail = series.slice(-weeks);
    const cur = series[series.length - 1].amount;
    const prev = series.length > 1 ? series[series.length - 2].amount : null;
    const four = series.length > 4 ? series[series.length - 5].amount : series.length > 1 ? series[0].amount : null;
    const mine = x => pic === null || x.pic === pic;
    return {
      pic, label, values: tail.map(x => x.amount), dates: tail.map(x => x.date), current: cur,
      thisWeek: prev === null ? null : cur - prev, vs4: four === null ? null : cur - four,
      newPursuits: [...log.values()].filter(e => mine(e) && !e.first && win(e.firstSeen)).length,
      newContracts: [...forecastFirst.entries()].filter(([, e]) => mine(e) && !e.first && win(e.date)).length,
      moved: sum(history[history.length - 1].forecast.filter(mine), x => x.moved || 0),
    };
  };
  const rows = (pics || [...tot.keys()]).filter(p => tot.has(p)).map(p => row(p, p, tot.get(p)));
  const firmSeries = history.map((s, i) => ({ date: s.date, amount: sum([...tot.values()], t => t[i].amount) }));
  return { rows, firm: row(null, 'Firm', firmSeries) };
}

/* Alerts for the last snapshot in `history`. settings = the pipeline.rules object (amounts in dollars). picName(code) gives a display name.
   Each alert: { rule, severity: 'alert'|'watch', pic, title, message, detail }. Rules set to 'off' make none. Cleared alerts are the server's business. */
function evaluate({ history, projects, rules, picName }) {
  const out = [];
  if (!history.length) return out;
  const cur = history[history.length - 1];
  const log = pursuitLog(history, projects);
  const mwip = totals(history, 'mwip'), fc = totals(history, 'forecast');
  const nm = pic => shortName(picName ? picName(pic) : pic);
  const push = (rule, pic, title, message, detail) => { const sev = rules[rule].sev; if (sev !== 'off') out.push({ rule, severity: sev, pic, title, message, detail: detail || {} }); };

  // MWIP falls fast, and the slide that goes with it
  for (const [pic, series] of mwip) {
    const r = rules.mwipDrop, base = before(series, r.days);
    if (!base) continue;
    const now = series[series.length - 1].amount, drop = base.amount - now;
    if (drop >= r.amount * 100) {
      const run = slideRun(series), since = series[series.length - 1 - run];
      const lost = [...log.values()].filter(e => e.pic === pic && !e.present && e.leftOn === cur.date && e.outcome === 'no_match');
      const bits = [];
      if (run >= 2) bits.push(`Down ${run} snapshots in a row, ${money(since.amount - now)} since ${dayText(since.date)}.`);
      if (lost.length) bits.push(`This drop is ${lost.map(e => `${e.name}, no longer in MWIP and with no matching project`).join('; ')}.`);
      bits.push(`Threshold is ${money(r.amount * 100)} in ${r.days} days.`);
      push('mwipDrop', pic, `${nm(pic)}: MWIP down ${money(drop)}${r.days === 7 ? ' this week' : ` in ${r.days} days`}`, bits.join(' '), { drop, from: base.amount, to: now, since: base.date });
    }
    const s = rules.mwipSlide, run = slideRun(series);
    if (run >= s.weeks && !(out.some(a => a.rule === 'mwipDrop' && a.pic === pic)))
      push('mwipSlide', pic, `${nm(pic)}: MWIP down ${run} snapshots in a row`, `From ${money(series[series.length - 1 - run].amount)} on ${dayText(series[series.length - 1 - run].date)} to ${money(series[series.length - 1].amount)}. Threshold is ${s.weeks} in a row.`, { run });
  }

  // forecast falls fast
  for (const [pic, series] of fc) {
    const r = rules.forecastDrop, base = before(series, r.days);
    if (!base) continue;
    const now = series[series.length - 1].amount, drop = base.amount - now;
    if (drop >= r.amount * 100) {
      const prevSnap = history.find(s => s.date === base.date);
      const was = new Map(prevSnap.forecast.filter(f => f.pic === pic).map(f => [f.wbs1, f]));
      const movers = cur.forecast.filter(f => f.pic === pic && was.has(f.wbs1) && (f.moved || 0) > (was.get(f.wbs1).moved || 0)).sort((a, b) => (b.moved - was.get(b.wbs1).moved) - (a.moved - was.get(a.wbs1).moved));
      const msg = [];
      if (movers.length) msg.push(`In ${r.days === 7 ? 'one week' : r.days + ' days'}, mostly ${movers[0].name} moving into next year.`);
      msg.push(`Threshold is ${money(r.amount * 100)} in ${r.days} days.`);
      push('forecastDrop', pic, `${nm(pic)}: forecast down ${money(drop)}`, msg.join(' '), { drop, from: base.amount, to: now });
    }
  }

  // pursuits that left MWIP: the ones with no project need a look; the ones that became a project are good news
  for (const e of log.values()) {
    if (e.present || !e.leftOn) continue;
    const age = daysBetween(e.leftOn, cur.date);
    if (e.outcome === 'no_match' && age >= rules.noMatch.days)
      push('noMatch', e.pic, `${nm(e.pic)}: ${e.name} left with no matching project`, `It was ${money(e.amount)} in MWIP on ${dayText(e.lastSeen)} and is gone from the ${dayText(cur.date)} snapshot. Either it was lost, or it converted and nobody opened the job.`, { id: e.id, amount: e.amount });
  }
  // won, but nobody has opened the job
  const open = new Set((projects || []).map(p => p.wbs1));
  for (const e of log.values()) {
    if (!e.present || e.stage !== 'Won' || open.has(e.id)) continue;
    let since = e.trail.length - 1;
    while (since > 0 && e.trail[since - 1].stage === 'Won') since--;
    const days = daysBetween(e.trail[since].date, cur.date);
    if (days >= rules.unmatchedWin.days) push('unmatchedWin', e.pic, `${nm(e.pic)}: ${e.name} won, no project yet`, `Marked Won since ${dayText(e.trail[since].date)} (${days} days) and no project has its number.`, { id: e.id, days });
  }
  // win probability falls
  for (const e of log.values()) {
    if (!e.present || e.trail.length < 2) continue;
    const a = e.trail[e.trail.length - 2], b = e.trail[e.trail.length - 1];
    if (a.winProb != null && b.winProb != null && a.winProb - b.winProb >= rules.winProb.points)
      push('winProb', e.pic, `${nm(e.pic)}: ${e.name} win chance down ${a.winProb - b.winProb} points`, `From ${a.winProb}% to ${b.winProb}% in one snapshot. Threshold is ${rules.winProb.points} points.`, { id: e.id });
  }
  // no new pursuits
  for (const pic of mwip.keys()) {
    const mine = [...log.values()].filter(e => e.pic === pic);
    const newest = mine.reduce((a, e) => (e.first ? a : e.firstSeen > a ? e.firstSeen : a), history[0].date);
    const quiet = daysBetween(newest, cur.date);
    if (history.length > 1 && quiet >= rules.noNew.days) push('noNew', pic, `${nm(pic)}: no new pursuits in ${rules.noNew.days} days`, `Nothing added since ${dayText(newest)}. Watch items do not count toward the badge.`, { quiet });
  }
  return out;
}

/* the converted ones, for the "This week" panel: informational, never an alert */
function conversions(history, projects, picName) {
  if (history.length < 2) return [];
  const cur = history[history.length - 1].date;
  const log = pursuitLog(history, projects);
  return [...log.values()].filter(e => !e.present && e.leftOn === cur && e.outcome === 'converted').map(e => ({
    id: e.id, pic: e.pic, name: e.name, wbs1: e.wbs1, opened: e.openedOn,
    title: `${shortName(picName ? picName(e.pic) : e.pic)}: pursuit converted`,
    message: `${e.name} became project ${e.wbs1}${e.openedOn ? ' on ' + dayText(e.openedOn) : ''}. No action needed.`,
  }));
}

/* the Monday of the week a date falls in (snapshots are taken on Mondays) */
function mondayOf(d) {
  const dow = new Date(ms(d)).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}

const api = { addDays, daysBetween, money, dayText, shortName, pursuitLog, changes, totals, before, slideRun, picRows, evaluate, conversions, mondayOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.PipelineWatch = api;
