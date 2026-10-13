/* A project's plan page: add to the log, the log itself (newest first, nothing edited or deleted), the commitments, the facts.
   The PIC on the project writes; everyone else reads; the Admin may add a clearly labeled note.
   A commitment's action and number are in the data only when the viewer is the Admin (the server removes them otherwise). */
import { lineChart } from '/shared/ui/charts.js';
import { fmtCents, fmtK, fmtLoss, fmtPctNum, fmtDay, fmtClock, monthLetter, fmtPeriod, plural } from '/shared/ui/format.js';
import { Plan } from '/shared/platform/index.js';
import { planChip } from '/modules/turnaround/ui/overview.js';

const KIND_LABEL = { explanation: 'Explanation', commitment: 'Commitment', update: 'Update', correction: 'Correction', admin_note: 'Admin note', done: 'Done', date_revised: 'Date revised', missed: 'Missed' };
const KIND_CHIP = { explanation: 'blue', commitment: 'warn', update: '', correction: 'out', admin_note: 'out', done: 'ok', date_revised: '', missed: 'crit' };
const PROMPT = { explanation: 'What is driving the loss?', commitment: 'What specific action will you take?', update: 'What has happened since your last entry?', correction: 'What was wrong, and what is correct?', admin_note: 'A question or comment for the PIC. It is public and always labeled as yours.' };
const REVISED = n => (n === 1 ? 'Revised once' : `Revised ${n === 2 ? 'twice' : n + ' times'}`);
const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : '');

export async function renderPlan(ctx, body, wbs1, cycleArg) {
  const { h } = ctx;
  let data;
  const load = async () => { data = await Plan.get(wbs1, cycleArg); };
  await load();
  const holder = h('div', {});
  body.append(holder);
  const paint = () => { holder.textContent = ''; draw(ctx, holder, data, { reload: async () => { await load(); paint(); }, cycle: cycleArg }); ctx.T.hydrateIcons(holder); };
  paint();
  return data;
}

function draw(ctx, root, data, st) {
  const { h } = ctx;
  const p = data.project;
  const me = ctx.Session.me();
  const picName = p.pic.draftName || p.pic.name.split(' ')[0];
  root.append(...[
    h('div', { class: 'plan-title' },
      h('h1', { text: p.name }), h('span', { class: 'muted strong', text: p.wbs1 }), data.status ? planChip(ctx, data.status) : null),
    h('p', { class: 'muted plan-meta', text: `PIC ${p.pic.name} · PM ${p.pm.name} · Plan cycle ${data.cycle}${data.opened ? `, opened ${fmtDay(data.opened)}` : ', not opened yet'}` }),
    data.cycles.length > 1 ? cycleSwitch(ctx, data) : null,
    h('div', { class: 'who' }, h('span', { class: 'lbl', text: 'Who sees this' }),
      h('span', { class: 'chip blue', text: `${picName} adds entries` }), h('span', { class: 'chip', text: 'Other PICs read' }), h('span', { class: 'chip', text: 'Admin reads, adds admin notes' }), h('span', { class: 'chip', text: 'Marketing director reads (if allowed)' }))].filter(Boolean)); // native append() would print a null as the word "null"
  const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' });
  if (data.can.addEntry) left.append(addForm(ctx, data, st, false));
  else if (data.can.adminNote && data.cycle === data.cycles[0]) left.append(addForm(ctx, data, st, true));
  else if (data.cycle !== data.cycles[0] || data.project.status !== 'A') left.append(ctx.banner('archive', 'This is a past cycle. Nothing can be added to it, and nothing in it can be changed.'));
  left.append(logCard(ctx, data));
  right.append(commitmentsCard(ctx, data, st), chartCard(ctx, data), factsCard(ctx, data), legendCard(ctx));
  root.append(h('div', { class: 'plan-grid' }, left, right));
  void me;
}

function cycleSwitch({ h }, data) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': 'Plan cycle' }, ...data.cycles.map(y => h('button', { type: 'button', 'aria-pressed': String(y === data.cycle), text: String(y), onclick: () => { location.hash = `#/turnaround/p/${encodeURIComponent(data.project.wbs1)}${y === data.cycles[0] ? '' : '?cycle=' + y}`; } })));
}

/* ---- add to the log ----
   Kinds: explanation (first, once), then a check-in (when a commitment is open: report back on it and make the next one, in one step)
   or a commitment (when none is open), and an update (any time between due dates). */
function addForm(ctx, data, st, adminOnly) {
  const { h } = ctx;
  const open = data.commitments.filter(c => c.status === 'open');
  const base = adminOnly ? ['admin_note'] : data.can.kinds;
  // the PIC's two ways to move forward: with something open it is a check-in, with nothing open it is a new commitment
  const kinds = adminOnly ? base : base.map(k => (k === 'commitment' && open.length ? 'checkin' : k));
  const first = kinds.length === 1 && kinds[0] === 'explanation'; // nothing else is possible until the explanation is written
  const order = ['checkin', 'commitment', 'update'];
  const tabKinds = kinds.slice().sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const s = { kind: tabKinds[0], lever: null };
  const card = h('section', { class: 'sec form-card' });
  const msg = h('div', { role: 'alert' });
  const fields = h('div', { class: 'stack' });
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Kind of entry' });
  const text = h('textarea', { class: 'txt', rows: '4', style: 'height:auto;padding:8px 10px', 'aria-label': 'Entry text' });
  const leverBox = h('div', { class: 'levers' });
  const leverHelp = h('div', { class: 'lever-help muted small', 'aria-live': 'polite' });
  const otherText = h('input', { class: 'txt', type: 'text', maxlength: '120', style: 'max-width:420px', 'aria-label': 'What is the other action?', placeholder: 'In a few words, what will you do?' });
  const prompt = h('label', { class: 'fl' });
  const submit = h('button', { class: 'btn primary', type: 'button', text: adminOnly ? 'Add admin note' : 'Add to log' });
  let reports = []; // one per open commitment: { c, what, improved }
  const TAB = { checkin: 'Check in', commitment: 'Make a commitment', update: 'Update' };

  const refresh = () => {
    tabs.textContent = '';
    if (!adminOnly && tabKinds.length > 1) for (const k of tabKinds) tabs.append(h('button', { type: 'button', role: 'tab', 'aria-pressed': String(s.kind === k), 'aria-selected': String(s.kind === k), text: TAB[k] || KIND_LABEL[k], onclick: () => { s.kind = k; msg.textContent = ''; refresh(); } }));
    prompt.textContent = s.kind === 'checkin' ? 'What specific action will you take next?' : PROMPT[s.kind];
    fields.textContent = '';
    if (s.kind === 'checkin') {
      reports = open.map(c => ({ c, what: h('textarea', { class: 'txt', rows: '3', style: 'height:auto;padding:8px 10px', 'aria-label': `What happened with: ${c.text}` }), improved: null }));
      fields.append(h('div', { class: 'fl', text: 'Report back' }), ...reports.map(r => reportBlock(ctx, r)),
        h('div', { class: 'fl', text: 'Your next commitment' }), h('div', {}, h('div', { class: 'fl', text: 'What will it change? Pick one.' }), leverBox, leverHelp), prompt, text);
      if (data.nextDue) fields.append(ctx.banner('info', `Next due date: ${fmtDay(data.nextDue.date)}. On that date you will give an update on this commitment and make a new one.`));
      drawLevers();
    } else if (s.kind === 'commitment') {
      // the kind of action first, then what you will do in your own words, then when it is due (not chosen by the PIC)
      fields.append(h('div', {}, h('div', { class: 'fl', text: 'What will this commitment change? Pick one.' }), leverBox, leverHelp), prompt, text);
      if (data.nextDue) fields.append(ctx.banner('info', `Next due date: ${fmtDay(data.nextDue.date)}. On that date you will give an update on this commitment and make a new one.`));
      drawLevers();
    } else fields.append(prompt, text);
    submit.textContent = adminOnly ? 'Add admin note' : first ? 'Save explanation' : s.kind === 'checkin' ? 'Submit check-in' : s.kind === 'commitment' ? 'Save commitment' : 'Add to log';
    ctx.T.hydrateIcons(card);
  };
  st.openCheckin = () => { if (tabKinds.includes('checkin')) { s.kind = 'checkin'; msg.textContent = ''; refresh(); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };

  function drawLevers() {
    leverBox.textContent = '';
    const current = data.levers.find(l => l.key === s.lever);
    const hint = () => { leverHelp.textContent = current ? current.help : 'Point at an action to see what it means.'; };
    for (const [group, title] of [['money', 'Bring in money'], ['spend', 'Spend less']]) {
      leverBox.append(h('div', { class: 'lever-group' }, h('div', { class: 'muted small strong', text: title }),
        h('div', { class: 'pills' }, ...data.levers.filter(l => l.group === group).map(l => h('button', {
          type: 'button', class: 'pill', title: l.help, 'aria-pressed': String(s.lever === l.key), 'aria-describedby': 'lever-help', text: l.label,
          onmouseenter: () => { leverHelp.textContent = l.help; }, onfocus: () => { leverHelp.textContent = l.help; }, onmouseleave: hint, onblur: hint,
          onclick: () => { s.lever = l.key; s.other = !!l.other; drawLevers(); } })))));
    }
    leverHelp.id = 'lever-help';
    hint();
    if (s.other) leverBox.append(h('div', {}, h('label', { class: 'fl', text: 'Other: what is it?' }), otherText));
  }
  const needLever = () => {
    if (!s.lever) return 'Pick the kind of action.';
    if (s.other && !otherText.value.trim()) return 'Fill in the line for Other: say in a few words what you will do.';
    return null;
  };
  submit.addEventListener('click', async () => {
    msg.textContent = '';
    try {
      if (s.kind === 'checkin') {
        for (const r of reports) {
          if (!r.what.value.trim()) return fail('Say what happened on each commitment you are reporting back on.');
          if (r.improved === null) return fail('Answer yes or no: did this action improve the financial state of the project during this period?');
        }
        const bad = needLever(); if (bad) return fail(bad);
        submit.disabled = true;
        await Plan.checkIn(data.project.wbs1, { reports: reports.map(r => ({ commitmentId: r.c.id, body: r.what.value, improved: r.improved })), lever: s.lever, otherText: s.other ? otherText.value : undefined, body: text.value });
      } else {
        const entry = { kind: s.kind, body: text.value };
        if (s.kind === 'commitment') {
          const bad = needLever(); if (bad) return fail(bad);
          entry.lever = s.lever;
          if (s.other) entry.otherText = otherText.value;
        }
        submit.disabled = true;
        await Plan.add(data.project.wbs1, entry);
      }
      await st.reload();
    } catch (e) { submit.disabled = false; fail(e.message); }
  });
  const fail = t => { msg.textContent = ''; msg.append(ctx.banner('circle-alert', t, 'err')); };
  const headline = adminOnly ? 'Add an admin note' : first ? 'Start with an explanation' : tabKinds.includes('checkin') ? 'Check in' : 'Add to the log';
  const sub = adminOnly ? 'Admin notes are public and always labeled. They never count toward a PIC\'s record.'
    : first ? 'Say what is driving the loss on this project. You do this once for the year; after it, you check in and add updates. Entries are permanent.'
      : tabKinds.includes('checkin') ? 'At each due date, report back on your open commitment and make the next one. An update can go in any time between. Entries are permanent.'
        : 'Make your first commitment, or add an update. Entries are permanent.';
  card.append(h('div', { class: 'sec-head' }, h('h2', { text: headline }), h('p', { text: sub })),
    h('div', { class: 'sec-body', style: 'padding:14px 20px' }, h('div', { class: 'stack' }, adminOnly || tabKinds.length < 2 ? null : tabs, fields, msg)),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: adminOnly ? `Posted as ${ctx.Session.me().name}, labeled Admin note.` : `Posted as ${ctx.Session.me().name}. Josh gets no email; he sees it in the next review.` }), h('div', { class: 'acts' }, submit)));
  refresh();
  return card;
}

/* one open commitment, and the two things asked about it when reporting back */
function reportBlock(ctx, r) {
  const { h } = ctx;
  const radios = ['Yes', 'No'].map(label => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'improved-' + r.c.id, value: label, onchange: () => { r.improved = label === 'Yes'; } }), h('span', { text: label })));
  return h('div', { class: 'report stack' },
    h('div', {}, h('span', { class: 'chip warn', text: `Due ${fmtDay(r.c.dueDate)}` }), ' ', h('span', { class: 'strong', text: r.c.text })),
    h('label', { class: 'fl', text: 'What happened?' }), r.what,
    h('div', { class: 'fl', text: 'Did this action improve the financial state of the project during this period?' }), h('div', { class: 'cm-acts' }, ...radios));
}

/* ---- the log ---- */
function logCard(ctx, data) {
  const { h } = ctx;
  const byId = new Map(data.entries.map(e => [e.id, e]));
  const items = data.entries.map(e => {
    const chips = [];
    if (e.kind === 'commitment') { chips.push(h('span', { class: 'chip', text: `Promised by ${fmtDay(e.promisedBy)}` })); if (e.leverLabel) chips.push(h('span', { class: 'chip', text: e.leverLabel })); }
    if (e.correctedOn) chips.push(h('span', { class: 'chip out', text: `Corrected ${fmtDay(e.correctedOn)}` }));
    if (e.planOpened) chips.push(h('span', { class: 'chip out', text: 'Plan opened' }));
    let who = e.author ? e.author.name : 'Recorded by the system';
    let text = e.body;
    if (e.kind === 'correction') who = `${e.author.name} · corrects the ${fmtDay(e.correctsDate)} ${(KIND_LABEL[e.correctsKind] || 'entry').toLowerCase()}`;
    if (e.kind === 'done') { who = `Marked by ${e.author.name.split(' ')[0]}${e.daysEarly > 0 ? `, ${plural(e.daysEarly, 'day')} early` : e.daysEarly < 0 ? `, ${plural(-e.daysEarly, 'day')} late` : ', on the day'}`; if (e.improved !== undefined) chips.push(h('span', { class: 'chip ' + (e.improved ? 'ok' : 'out'), text: `Improved the project: ${yesNo(e.improved)}` })); }
    if (e.kind === 'date_revised') { who = `${e.author.name} · ${e.commitmentText}`; text = `${fmtDay(e.from)} moved to ${fmtDay(e.to)}. Reason given: ${e.body} Earlier dates stay on record.`; }
    if (e.kind === 'missed') { const c = byId.get(e.commitmentId); text = `Commitment${c ? ` from ${fmtDay(c.date)}` : ''}, ${(e.commitmentText || '').replace(/\.$/, '')} by ${fmtDay(e.dueDate)}, passed with no update logged.`; }
    return h('li', { class: 'log-item' + (e.kind === 'admin_note' ? ' note' : '') },
      h('div', { class: 'log-when' }, h('strong', { text: fmtDay(e.date) }), h('div', { class: 'muted', text: fmtClock(e.at) })),
      h('div', { class: 'log-body' }, h('div', { class: 'log-head' }, h('span', { class: 'chip ' + KIND_CHIP[e.kind], text: KIND_LABEL[e.kind] }), h('span', { class: e.author ? '' : 'muted', text: who }), ...chips), h('div', { class: 'log-text', text: text })));
  });
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head log-title' }, h('h2', { text: 'Plan log' }), h('span', { class: 'muted', text: `Newest first. ${data.cycle} cycle. Nothing here is edited or deleted.` })),
    items.length ? h('ol', { class: 'log' }, ...items) : h('div', { class: 'empty-row', text: 'Nothing has been logged this year.' }));
}

/* ---- commitments ---- */
function commitmentsCard(ctx, data, st) {
  const { h } = ctx;
  const cs = data.commitments;
  const kept = cs.filter(c => c.kept).length, missed = cs.filter(c => c.status === 'missed').length, open = cs.filter(c => c.status === 'open').length;
  const late = cs.filter(c => c.status === 'done' && !c.kept).length;
  const moved = cs.filter(c => c.revisions.length).length;
  const sum = `Kept ${kept}, missed ${missed}, open ${open}.${late ? ` ${late} done late.` : ''}${moved ? ` ${plural(moved, 'date')} revised.` : ''}`;
  const list = cs.map(c => commitmentRow(ctx, c, data, st));
  return h('section', { class: 'sec side-card' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Commitments' }), h('p', { text: cs.length ? sum : 'No commitments yet this year.' })),
    h('div', { class: 'sec-body' }, ...list));
}

function commitmentRow(ctx, c, data, st) {
  const { h } = ctx;
  const chips = [];
  if (c.status === 'open') chips.push(h('span', { class: 'chip warn', text: `Open, due ${fmtDay(c.dueDate)}` }));
  if (c.status === 'done') chips.push(h('span', { class: 'chip ' + (c.kept ? 'ok' : 'warn'), text: c.kept ? 'Kept' : 'Done late' }));
  if (c.status === 'missed') chips.push(h('span', { class: 'chip crit', text: 'Missed' }));
  if (c.revisions.length) chips.push(h('span', { class: 'chip out', text: REVISED(c.revisions.length) }));
  const dates = c.revisions.length
    ? `Promised ${fmtDay(c.promisedBy)}, ${c.revisions.map(r => `moved to ${fmtDay(r.to)}`).join(', ')}${c.status === 'done' ? `, done ${fmtDay(c.closedDate)}` : c.status === 'missed' ? ', no update logged' : `, now ${fmtDay(c.dueDate)}`}`
    : c.status === 'done' ? `Promised ${fmtDay(c.promisedBy)}, done ${fmtDay(c.closedDate)}` : c.status === 'missed' ? `Promised ${fmtDay(c.promisedBy)}, no update logged` : `Promised ${fmtDay(c.promisedBy)}`;
  const row = h('div', { class: 'cm' }, h('div', { class: 'chips' }, ...chips), h('div', { class: 'strong', text: c.text }), h('div', { class: 'muted small', text: dates }),
    c.leverLabel ? h('div', { class: 'muted small', text: `${c.leverLabel}${c.improved === null || c.improved === undefined ? '' : `. Improved the project: ${yesNo(c.improved).toLowerCase()}`}` }) : null);
  if (c.status === 'open' && data.can.addEntry) {
    row.append(h('div', { class: 'cm-acts' }, h('button', { class: 'btn primary sm', type: 'button', text: 'Check in', onclick: () => st.openCheckin && st.openCheckin() })));
  }
  return row;
}

/* ---- right column ---- */
function chartCard(ctx, data) {
  const { h } = ctx;
  if (!data.series.length) return h('div', {});
  const pts = data.series.map((s, i) => ({ label: monthLetter(s.period), value: s.profitYtd, kind: i === data.series.length - 1 ? 'now' : 'bar', tip: `${fmtPeriod(s.period)}: ${fmtCents(s.profitYtd)}` }));
  return h('section', { class: 'sec side-card' }, h('div', { class: 'sec-head' }, h('h2', { text: 'YTD profit on this project' }), h('p', { text: 'Month-end, in thousands.' })),
    h('div', { style: 'padding:8px 12px' }, lineChart(pts, { fmt: v => fmtK(v), aria: `Year-to-date profit on ${data.project.name} at each month end`, zero: true, ticks: 4, height: 200 })));
}

function factsCard(ctx, data) {
  const { h } = ctx;
  const f = data.facts;
  const cell = (label, value) => h('div', { class: 'fact' }, h('div', { class: 'k-label', text: label }), h('div', { class: 'k-big sm', text: value }));
  return h('section', { class: 'sec side-card' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Project facts' }), f ? h('p', { text: `As of the ${f.label} run.` }) : null),
    f ? h('div', { class: 'facts-grid' }, cell('Billed YTD', fmtCents(f.billedYtd)), cell('Profit YTD', fmtCents(f.profitYtd)), cell('Profit % YTD', fmtPctNum(f.pctYtd)), cell('Profit % JTD', fmtPctNum(f.pctJtd)))
      : h('div', { class: 'empty-row', text: 'This project is not on a published run yet.' }));
}

function legendCard(ctx) {
  const { h } = ctx;
  const rows = [
    ['Explanation', 'The PIC, once a year per project. Why it is below break-even. It comes first; updates and commitments can only follow it.'],
    ['Commitment', 'The PIC. One kind of action and a few words about it. The system sets the due date: the next check-in, every 14 days from the project\'s first report. Everyone who can read the plan sees the action.'],
    ['Update', 'The PIC. What has happened since the last entry, including anything that needs setting right.'],
    ['Check-in', 'The PIC, at each due date (or earlier): reports back on the open commitment, says whether it improved the project\'s finances, and makes the next commitment. Reporting on or before the date counts as kept.'],
    ['Date revised', 'Older plans only. Dates are no longer changed; the system sets them.'],
    ['Missed', 'The system. A date passed and nobody pressed Done.'],
    ['Admin note', 'The Admin. A question or comment, always labeled.'],
    ['Current', 'An open commitment and an entry in the last 30 days, nothing past due.'],
    ['Update due', 'The next update comes due within 14 days.'],
    ['Overdue', 'The due date passed with no new entry.'],
    ['No plan', 'No commitment yet this year. An explanation alone does not count.'],
  ];
  return h('details', { class: 'sec side-card legend' }, h('summary', { text: 'What the labels mean' }),
    h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
}
void fmtLoss;
