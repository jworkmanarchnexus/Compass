/* A project's page: the goal check-in or mid-month update (for its PIC, when one is owed), the full history of goals and comments,
   the project's numbers and every goal so far. One project at a time: the PIC steps through their projects on the list from the
   header tile ("Save and next"). Everyone who may see Turnaround reads it; the Admin may add a labeled note.
   The rules (what is owed, what is required) are the server's; this file draws the page and shows the server's plain-words answer. */
import { lineChart } from '/shared/ui/charts.js';
import { fmtCents, fmtK, fmtPctNum, fmtDay, monthLetter, fmtPeriod, plural } from '/shared/ui/format.js';
import { Plan } from '/shared/platform/index.js';
import { planChip, MID_LABEL, MID_TONE } from '/modules/turnaround/ui/overview.js';

const HELPED_TONE = { yes: 'ok', no: 'crit', early: 'out' };
const link = wbs1 => '#/turnaround/p/' + encodeURIComponent(wbs1);
const signed = c => `${c >= 0 ? 'better' : 'worse'} by ${fmtCents(Math.abs(c))}`;

export async function renderPlan(ctx, body, wbs1, cycleArg) {
  let data = await Plan.get(wbs1, cycleArg);
  // the answers being written stay put while the page redraws (picking a pill, a refused save)
  const st = { a: fresh(), error: null, saved: false };
  const paint = () => {
    header(ctx, body, data, st);
    body.textContent = '';
    draw(ctx, body, data, st, paint, async next => {
      data = next; st.a = fresh(); st.error = null; paint();
    });
    ctx.T.hydrateIcons(body);
  };
  paint();
  return data;
}

function fresh() { return { cause: '', helped: null, comment: '', keep: null, approach: null, how: '', mid: null, midComment: '' }; }

/* ---- the header tile: the project's name, who leads it, and (for its PIC) their projects on the list, one at a time ---- */
function header(ctx, body, data, st) {
  const { h } = ctx;
  const head = body.parentNode && body.parentNode.querySelector('.phead');
  if (!head) return;
  const p = data.project;
  head.querySelectorAll('.ptitle, .ck-steps').forEach(n => n.remove());
  const sub = [p.wbs1, `PIC ${p.pic.name}`, `PM ${p.pm.name}`, p.firstAppeared ? `On the list since ${fmtDay(p.firstAppeared)}` : null].filter(Boolean).join(' · ');
  head.append(h('div', { class: 'ptitle' }, h('h1', { class: 'brand', text: p.name }), h('span', { class: 'sub', text: sub }),
    h('div', { class: 'pacts' }, data.status ? planChip(ctx, data.status) : !data.onList && data.cycle === data.cycles[0] ? h('span', { class: 'chip out', text: 'Not on the list this month' }) : null)));
  if (data.steps.length > 1) {
    head.append(h('nav', { class: 'ck-steps', 'aria-label': 'Your projects on the list' },
      ...data.steps.map((s, i) => h('a', { class: 'ck-step', href: link(s.wbs1), 'aria-current': s.wbs1 === p.wbs1 ? 'page' : null },
        h('span', { class: 'ck-step-n', text: `${i + 1} of ${data.steps.length}` }), h('span', { class: 'strong ck-step-name', text: s.name }), stepChip(ctx, s.plan)))));
  }
  ctx.T.hydrateIcons(head);
  void st;
}

function stepChip({ h }, plan) {
  if (plan.status === 'current') return h('span', { class: 'chip ok', text: 'Done' });
  if (plan.status === 'overdue' || plan.daysOverdue > 0) return h('span', { class: 'chip crit', text: 'Late' });
  return h('span', { class: 'chip warn', text: 'To do' });
}

function draw(ctx, root, data, st, paint, replace) {
  const { h } = ctx;
  const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' });
  const live = data.cycle === data.cycles[0];
  if (data.cycles.length > 1) root.append(cycleSwitch(ctx, data));
  if (data.can.goalCheckin) left.append(goalCard(ctx, data, st, paint, replace));
  else if (data.can.mid) left.append(midCard(ctx, data, st, paint, replace));
  else if (data.steps.length && live) left.append(doneCard(ctx, data, st));
  if (data.can.adminNote) left.append(noteCard(ctx, data, replace));
  if (!live || data.project.status !== 'A') left.append(ctx.banner('archive', 'This is a past cycle. Nothing can be added to it, and nothing in it can be changed.'));
  left.append(historyCard(ctx, data, replace));
  right.append(numbersCard(ctx, data), goalsCard(ctx, data), chartCard(ctx, data), legendCard(ctx));
  root.append(h('div', { class: 'plan-grid' }, left, right));
}

function cycleSwitch({ h }, data) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': 'Plan cycle' }, ...data.cycles.map(y => h('button', { type: 'button', 'aria-pressed': String(y === data.cycle), text: String(y), onclick: () => { location.hash = link(data.project.wbs1) + (y === data.cycles[0] ? '' : '?cycle=' + y); } })));
}

/* ---- the forms ---- */
function area(ctx, label, value, set, rows, placeholder) {
  const t = ctx.h('textarea', { class: 'txt', rows: String(rows), style: 'height:auto;padding:8px 10px', 'aria-label': label, placeholder });
  t.value = value;
  t.addEventListener('input', () => set(t.value));
  return ctx.h('div', {}, ctx.h('label', { class: 'fl', text: label }), t);
}
const pills = (ctx, opts, value, pick, label) => ctx.h('div', { class: 'pills', role: 'group', 'aria-label': label }, ...opts.map(([k, t]) => ctx.h('button', { type: 'button', class: 'pill', 'aria-pressed': String(value === k), text: t, onclick: () => pick(k) })));
const goalLine = (ctx, g) => ctx.h('div', {}, ctx.h('span', { class: 'chip', text: g.approach }), ' ', ctx.h('span', { class: 'strong', text: g.text }));

/* where to go after saving: the next of the PIC's projects that still needs something, after this one, then from the top */
function nextStep(data) {
  const i = data.steps.findIndex(s => s.wbs1 === data.project.wbs1);
  const after = data.steps.slice(i + 1).concat(data.steps.slice(0, Math.max(0, i))).find(s => s.plan.status !== 'current');
  return after || null;
}

function formCard(ctx, data, st, { title, sub, fields, save }) {
  const { h } = ctx;
  const next = nextStep(data);
  const i = data.steps.findIndex(s => s.wbs1 === data.project.wbs1);
  const prev = i > 0 ? data.steps[i - 1] : null;
  const button = h('button', { class: 'btn primary', type: 'button', text: next ? 'Save and next' : 'Save' });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const out = await save();
      if (next) location.hash = link(next.wbs1); else await st.done(out);
    } catch (e) { st.error = e.message; button.disabled = false; st.repaint(); }
  });
  return h('section', { class: 'sec form-card' + (st.error ? ' ck-missing' : '') },
    h('div', { class: 'sec-head' }, h('h2', { text: title }), h('p', { text: sub })),
    h('div', { class: 'sec-body ck-form' }, fields, st.error ? h('div', { role: 'alert' }, ctx.banner('circle-alert', st.error, 'err')) : null),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: `Posted as ${ctx.Session.me().name}. Entries are permanent. Josh gets no email; he sees it in the next review.` }),
      h('div', { class: 'acts' }, prev ? h('a', { class: 'btn', href: link(prev.wbs1), text: 'Previous' }) : null, button)));
}

function goalCard(ctx, data, st, paint, replace) {
  const { h } = ctx;
  const a = st.a, f = data.form;
  st.repaint = paint; st.done = out => replace(out);
  const fields = h('div', { class: 'stack' });
  if (!f.explained) {
    fields.append(h('div', { class: 'report stack' }, area(ctx, 'New this year: what is driving the loss?', a.cause, v => { a.cause = v; }, 3, 'One or two sentences.'),
      h('div', { class: 'muted small', text: 'Once a year per project. It stays at the start of the history.' })));
  }
  if (f.openGoal) {
    const c = data.facts && data.facts.change;
    fields.append(h('div', { class: 'report stack' },
      h('div', { class: 'fl', text: 'Your last goal' }), goalLine(ctx, f.openGoal),
      f.openGoal.mid ? h('div', { class: 'muted small', text: `Mid-month you said: ${MID_LABEL[f.openGoal.mid.status]}.` }) : null,
      data.facts ? h('div', {}, h('span', { class: 'chip out', text: `Profit YTD ${fmtCents(data.facts.profitYtd)}${c === null ? '' : `, ${signed(c)} since last month`}` })) : null,
      h('div', { class: 'fl', text: 'Did it help?' }), pills(ctx, Object.entries(data.helped), a.helped, k => { a.helped = k; paint(); }, 'Did it help?'),
      area(ctx, 'Comment', a.comment, v => { a.comment = v; }, 2, 'What happened? Why did it help, or not?')));
  }
  // the next goal sits in its own grey card, like the last one (Josh, 2026-11-26)
  const next = h('div', { class: 'report stack' });
  fields.append(next);
  if (f.lastGoal) {
    next.append(h('div', {}, h('div', { class: 'fl', text: 'Your next goal' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Your next goal' }, ...[[true, 'Keep the same goal'], [false, 'Set a new goal']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(a.keep === k), text: t, onclick: () => { a.keep = k; paint(); } })))));
    if (a.keep === true) next.append(h('div', { class: 'muted', text: `Carried forward: ${f.lastGoal.approach}. ${f.lastGoal.text}` }));
  } else {
    next.append(h('div', { class: 'fl', text: 'Your first goal' }));
    a.keep = false;
  }
  if (a.keep === false) {
    next.append(h('div', {}, h('div', { class: 'fl', text: 'Approach (pick one)' }), pills(ctx, data.approaches.map(x => [x.key, x.label]), a.approach, k => { a.approach = k; paint(); }, 'Approach')));
    const chosen = data.approaches.find(x => x.key === a.approach);
    if (chosen) {
      next.append(h('div', { class: 'ck-ideas' }, h('div', { class: 'fl', text: 'Potential Approaches' }),
        h('ul', {}, ...chosen.ideas.map(([t, d]) => h('li', {}, h('span', { class: 'strong', text: t }), h('span', { class: 'muted', text: `: ${d}` }))))),
        area(ctx, 'How, specifically?', a.how, v => { a.how = v; }, 2, 'What will you do?'));
    }
  }
  return formCard(ctx, data, st, {
    title: 'Goal check-in',
    sub: f.openGoal ? `Say how your last goal went, then set the next one. Due ${fmtDay(data.status.dueDate)}.` : `Say what is driving the loss and set a first goal. Due ${fmtDay(data.status.dueDate)}.`,
    fields,
    save: () => Plan.goalCheckin(data.project.wbs1, { cause: a.cause, helped: a.helped, comment: a.comment, keep: a.keep, approach: a.approach, how: a.how }),
  });
}

function midCard(ctx, data, st, paint, replace) {
  const { h } = ctx;
  const a = st.a, g = data.form.openGoal;
  st.repaint = paint; st.done = out => replace(out);
  const fields = h('div', { class: 'stack' },
    h('div', { class: 'report stack' }, h('div', { class: 'fl', text: 'Your goal this month' }), goalLine(ctx, g), h('div', { class: 'muted small', text: `Set ${fmtDay(g.setDate)}.` })),
    h('div', {}, h('div', { class: 'fl', text: 'Where it stands' }), pills(ctx, Object.entries(data.midStatus), a.mid, k => { a.mid = k; paint(); }, 'Where it stands')),
    area(ctx, 'Comment', a.midComment, v => { a.midComment = v; }, 2, 'What has happened since you set the goal?'));
  return formCard(ctx, data, st, {
    title: 'Mid-month update', sub: `Where your goal stands, two weeks in. No new goal this time. Due ${fmtDay(data.status.dueDate)}.`, fields,
    save: () => Plan.midUpdate(data.project.wbs1, { status: a.mid, comment: a.midComment }),
  });
}

/* the PIC's own project with nothing owed this round */
function doneCard(ctx, data) {
  const { h } = ctx;
  const next = nextStep(data);
  const left = data.steps.filter(s => s.plan.status !== 'current').length;
  const R = data.status && data.status.round;
  const when = R ? (data.status.owes && data.status.owes.length ? '' : (data.today < R.midOpens ? ` The mid-month update opens ${fmtDay(R.midOpens)}.` : ' The next goal check-in opens when next month\'s numbers are published.')) : '';
  return h('section', { class: 'sec form-card ck-done' },
    h('div', { class: 'sec-head' }, h('h2', { text: data.status ? 'Done for this round' : 'Nothing to do here' }),
      h('p', { text: (left ? `${plural(left, 'project')} of yours still ${left === 1 ? 'needs' : 'need'} a check-in.` : 'All of your projects are done for this round.') + when })),
    next ? h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: `Next: ${next.name}` }), h('div', { class: 'acts' }, h('a', { class: 'btn primary', href: link(next.wbs1), text: 'Go to the next project' }))) : null);
}

function noteCard(ctx, data, replace) {
  const { h } = ctx;
  let text = '';
  const msg = h('div', { role: 'alert' });
  const t = area(ctx, 'A question or comment for the PIC', '', v => { text = v; }, 2, 'It is public and always labeled as yours.');
  const btn = h('button', { class: 'btn', type: 'button', text: 'Add admin note' });
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.textContent = '';
    try { replace(await Plan.add(data.project.wbs1, { kind: 'admin_note', body: text })); } catch (e) { btn.disabled = false; msg.append(ctx.banner('circle-alert', e.message, 'err')); }
  });
  return h('section', { class: 'sec form-card' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Add an admin note' }), h('p', { text: 'Admin notes are public and always labeled. They never count toward a PIC\'s record.' })),
    h('div', { class: 'sec-body ck-form' }, t, msg), h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: `Posted as ${ctx.Session.me().name}, labeled Admin note.` }), h('div', { class: 'acts' }, btn)));
}

/* ---- the history: every goal, check-in, comment and note, newest first. A goal check-in (the report on the last goal, the next goal,
   and on a first one the explanation) shows as one item. ---- */
function historyItems(entries) {
  const items = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind === 'commitment') {
      const it = { kind: 'checkin', date: e.date, author: e.author, goal: e, parts: [] };
      while (entries[i + 1] && ['done', 'explanation'].includes(entries[i + 1].kind) && entries[i + 1].date === e.date && entries[i + 1].author && e.author && entries[i + 1].author.id === e.author.id) it.parts.push(entries[++i]);
      items.push(it);
    } else items.push({ kind: e.kind, date: e.date, author: e.author, e });
  }
  return items;
}

function historyCard(ctx, data, replace) {
  const { h } = ctx;
  const items = historyItems(data.entries).map(it => {
    const head = [], body = [];
    const text = (t, cls) => h('div', { class: 'log-text' + (cls ? ' ' + cls : ''), text: t });
    if (it.kind === 'checkin') {
      const done = it.parts.find(p => p.kind === 'done'), ex = it.parts.find(p => p.kind === 'explanation');
      head.push(h('span', { class: 'chip warn', text: 'Goal check-in' }));
      if (ex) body.push(h('div', { class: 'log-text' }, h('span', { class: 'muted', text: 'What is driving the loss: ' }), h('span', { text: ex.body })));
      if (done) body.push(h('div', { class: 'log-text' }, h('span', { class: 'chip ' + (HELPED_TONE[done.helped] || 'out'), text: `Last goal helped: ${data.helped[done.helped] || '-'}` }), ' ', h('span', { text: done.body })));
      body.push(h('div', { class: 'log-text' }, h('span', { class: 'muted', text: it.goal.kept ? 'Kept the same goal: ' : done ? 'Next goal: ' : 'Goal: ' }), h('span', { class: 'chip', text: it.goal.approach }), ' ', h('span', { class: 'strong', text: it.goal.body })));
    } else {
      const e = it.e;
      if (e.kind === 'explanation') { head.push(h('span', { class: 'chip blue', text: 'What is driving the loss' })); body.push(text(e.body)); }
      else if (e.kind === 'update' && e.midStatus) { head.push(h('span', { class: 'chip', text: 'Mid-month update' }), h('span', { class: 'chip ' + MID_TONE[e.midStatus], text: MID_LABEL[e.midStatus] })); body.push(text(e.body)); }
      else if (e.kind === 'update') { head.push(h('span', { class: 'chip', text: 'Comment' })); body.push(text(e.body)); }
      else if (e.kind === 'admin_note') { head.push(h('span', { class: 'chip out', text: 'Admin note' })); body.push(text(e.body)); }
      else if (e.kind === 'missed') { head.push(h('span', { class: 'chip crit', text: 'Not reported on' })); body.push(text(`The goal "${(e.goalText || '').replace(/\.$/, '')}" was not reported on at the goal check-in due ${fmtDay(e.dueDate)}. Recorded by the system.`, 'muted')); }
      else if (e.kind === 'done') { head.push(h('span', { class: 'chip', text: 'Reported on' }), e.helped ? h('span', { class: 'chip ' + HELPED_TONE[e.helped], text: `Helped: ${data.helped[e.helped]}` }) : null); body.push(text(e.body)); }
      else { head.push(h('span', { class: 'chip out', text: { correction: 'Correction', date_revised: 'Date revised' }[e.kind] || e.kind })); body.push(text(e.kind === 'date_revised' ? `${fmtDay(e.from)} moved to ${fmtDay(e.to)}. ${e.body}` : e.body)); }
    }
    return h('li', { class: 'log-item' + (it.kind === 'admin_note' ? ' note' : '') },
      h('div', { class: 'log-when' }, h('strong', { text: fmtDay(it.date) })),
      h('div', { class: 'log-body' }, h('div', { class: 'log-head' }, ...head.filter(Boolean), h('span', { class: 'muted small', text: it.author ? it.author.name : 'Compass' })), ...body));
  });
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head log-title' }, h('h2', { text: 'History' }), h('span', { class: 'muted', text: `Every goal and comment this year, newest first. Nothing here is edited or deleted.` })),
    data.can.comment ? commentBox(ctx, data, replace) : null,
    items.length ? h('ol', { class: 'log' }, ...items) : h('div', { class: 'empty-row', text: 'Nothing yet this year.' }));
}

/* a comment between rounds: something worth saying that is not the check-in */
function commentBox(ctx, data, replace) {
  const { h } = ctx;
  let text = '';
  const msg = h('div', { role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'button', text: 'Add comment' });
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.textContent = '';
    try { replace(await Plan.add(data.project.wbs1, { kind: 'update', body: text })); } catch (e) { btn.disabled = false; msg.append(ctx.banner('circle-alert', e.message, 'err')); }
  });
  return h('details', { class: 'ck-comment' }, h('summary', { text: 'Add a comment' }),
    h('div', { class: 'stack' }, area(ctx, 'Comment', '', v => { text = v; }, 2, 'Anything worth saying between check-ins. Permanent, like every entry.'), msg, h('div', {}, btn)));
}

/* ---- right column ---- */
function numbersCard(ctx, data) {
  const { h } = ctx;
  const f = data.facts;
  const cell = (label, value) => h('div', { class: 'fact' }, h('div', { class: 'k-label', text: label }), h('div', { class: 'k-big sm', text: value }));
  return h('section', { class: 'sec side-card' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Project numbers' }), f ? h('p', { text: `As of the ${f.label} run.` }) : null),
    f ? h('div', { class: 'facts-grid' }, cell('Profit YTD', fmtCents(f.profitYtd)), cell('Since last month', f.change === null ? '-' : `${f.change >= 0 ? '+' : '-'}${fmtCents(Math.abs(f.change))}`),
      cell('Billed YTD', fmtCents(f.billedYtd)), cell('Profit % YTD', fmtPctNum(f.pctYtd)))
      : h('div', { class: 'empty-row', text: 'This project is not on a published run yet.' }));
}

/* each goal once, oldest kept goals folded in: its approach, when it was set, how many rounds it was kept, and what was said about it */
function goalsCard(ctx, data) {
  const { h } = ctx;
  const chains = []; // a goal kept for another round is the same goal: one row, with what was said about it each time
  for (const g of data.goals.slice().reverse()) {
    const last = chains[chains.length - 1];
    if (g.kept && last) { last.members.push(g); last.latest = g; } else chains.push({ first: g, latest: g, members: [g] });
  }
  const helpedOf = c => c.members.filter(g => g.helped).map(g => g.helped);
  const rows = chains.reverse().map(c => {
    const g = c.latest;
    const state = g.status === 'open' ? h('span', { class: 'chip warn', text: 'Current goal' }) : g.status === 'missed' ? h('span', { class: 'chip crit', text: 'Not reported on' }) : null;
    return h('div', { class: 'cm' },
      h('div', { class: 'chips' }, h('span', { class: 'chip', text: g.approach }), state, ...helpedOf(c).map(x => h('span', { class: 'chip ' + HELPED_TONE[x], text: `Helped: ${data.helped[x]}` }))),
      h('div', { class: 'strong', text: g.text }),
      h('div', { class: 'muted small', text: `Set ${fmtDay(c.first.setDate)}${c.members.length > 1 ? `, kept for ${c.members.length} rounds` : ''}` }));
  });
  return h('section', { class: 'sec side-card' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Goals so far' }), h('p', { text: chains.length ? `${plural(chains.length, 'goal')} this year.` : 'None yet this year.' })),
    rows.length ? h('div', { class: 'sec-body' }, ...rows) : null);
}

function chartCard(ctx, data) {
  const { h } = ctx;
  if (!data.series.length) return h('div', {});
  const pts = data.series.map((s, i) => ({ label: monthLetter(s.period), value: s.profitYtd, kind: i === data.series.length - 1 ? 'now' : 'bar', tip: `${fmtPeriod(s.period)}: ${fmtCents(s.profitYtd)}` }));
  return h('section', { class: 'sec side-card' }, h('div', { class: 'sec-head' }, h('h2', { text: 'YTD profit on this project' }), h('p', { text: 'Month-end, in thousands.' })),
    h('div', { style: 'padding:8px 12px' }, lineChart(pts, { fmt: v => fmtK(v), aria: `Year-to-date profit on ${data.project.name} at each month end`, zero: true, ticks: 4, height: 200 })));
}

function legendCard(ctx) {
  const { h } = ctx;
  const rows = [
    ['Goal check-in', 'When a month\'s numbers are published. Say whether the last goal helped, with a comment, then set the next goal or keep the same one. A project new to the list first says what is driving the loss.'],
    ['Mid-month update', 'Two weeks after the numbers are published. Where the goal stands: In progress, Done or Stuck, with a comment. No new goal.'],
    ['Goal', 'One approach, Lower costs or Bring in additional revenue, and a few words on how. No numbers.'],
    ['Comment', 'Anything worth saying between check-ins.'],
    ['Admin note', 'A question or comment from the Admin, always labeled.'],
    ['Not reported on', 'Nobody reported on a goal at the next goal check-in. The system records it.'],
    ['Done for this round', 'The goal check-in is done, and the mid-month update too once it has opened.'],
  ];
  return h('details', { class: 'sec side-card legend' }, h('summary', { text: 'What the labels mean' }),
    h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
}
