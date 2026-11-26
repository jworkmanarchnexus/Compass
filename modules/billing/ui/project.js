/* One project's billing: what Vantagepoint says, what to bill (by phase, or by line for an hourly job), notes for accounting,
   the buttons, and the history. The rules (arithmetic, what blocks a submit) are the pure ones in modules/billing/logic; the server
   runs them again on every save and submit. Money is whole cents; this file shows and takes dollars. */
import { Billing, ApiError } from '/shared/platform/index.js';
import { richEditor, showRich } from '/modules/billing/ui/rich.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = m => { const [y, mm] = m.split('-').map(Number); return `${MONTHS[mm - 1]} ${y}`; };
export const longDate = d => { const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${dd}, ${y}`; };
const fmtTime = ms => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const CB = () => window.CompassBilling, FX = () => window.CompassBillingFixed, HR = () => window.CompassBillingHourly;
const money = c => CB().centsText(c);
const plain = c => (c == null ? '' : CB().centsText(c).slice(c < 0 ? 2 : 1)); // "12,345.00", for a box

export const STATUS = {
  awaiting: ['out', 'Awaiting PM'], draft: ['warn', 'Draft'], returned: ['crit', 'Returned'], submitted: ['blue', 'Submitted'], review: ['blue', 'In accounting review'],
  processed: ['ok', 'Processed'], excluded: ['out', 'Left out this month'],
};
export const statusChip = (h, s) => h('span', { class: 'chip ' + STATUS[s][0], text: STATUS[s][1] });

/* what a blocked submit says, in plain words */
function issueText(i, evaluated, thresholdCents) {
  const name = (evaluated.lines.find(l => l.id === i.lineId) || {}).name || '';
  switch (i.code) {
    case 'line-blank': return `Enter an amount or a percent for ${name}.`;
    case 'line-negative': return `${name}: an amount cannot be negative.`;
    case 'line-below-prior': return `${name}: the percent is below what is already billed. Use the amount box to bill nothing more.`;
    case 'line-over-fee': return `${name}: this is more than the phase fee that is left.`;
    case 'line-locked': return `${name} is fully billed and takes no more.`;
    case 'line-over-available': return `${name}: this is more than is available to bill.`;
    case 'over-authorization': return 'The total is more than the project\'s authorization.';
    case 'no-billing-nonzero': return '"No billing this month" is checked, but the total is not $0.';
    case 'variance-note-required': return `The total is more than ${money(thresholdCents)} away from the projection. Add a note to accounting that says why.`;
    case 'stale-source': return 'The Vantagepoint numbers changed since you started. Read them again, then say you have.';
    default: return i.code;
  }
}

export async function renderBillingProject(ctx, body, wbs1, requestId) {
  const { h, icon, banner } = ctx;
  const detail = await Billing.project(wbs1);
  const targetId = requestId || (detail.open && detail.open.id) || null;
  const req = targetId ? await Billing.request(targetId) : null;
  const reload = () => { body.textContent = ''; return renderBillingProject(ctx, body, wbs1, requestId); };

  /* ---- header ---- */
  const dl = detail.deadline;
  const dlChip = !dl || dl.state === 'none' ? h('span', { class: 'chip out', text: 'No deadline set' })
    : h('span', { class: 'chip ' + (dl.state === 'passed' ? 'crit' : dl.daysLeft <= 3 ? 'warn' : 'ok'), text: dl.state === 'passed' ? `Deadline was ${longDate(dl.deadline)}` : dl.state === 'today' ? 'Deadline is today' : `Deadline ${longDate(dl.deadline)}` });
  body.append(h('div', { class: 'bproj-head' },
    h('div', {}, h('h2', { class: 'bproj-name', text: detail.name }), h('div', { class: 'muted', text: `${detail.wbs1}  |  ${detail.billingType === 'fixed' ? 'Fixed fee, by phase' : 'Hourly'}  |  PM ${detail.pm || '-'}  |  PIC ${detail.pic || '-'}` })),
    h('div', { class: 'bproj-chips' }, h('span', { class: 'chip', text: monthLabel((req && req.month) || detail.month) }), dlChip,
      h('span', { class: 'chip out', text: detail.assignedTo ? 'Accounting: ' + detail.assignedTo.name : 'No processor yet' }))));

  const msg = h('div', { class: 'stack', role: 'status' });
  const say = (text, kind) => { msg.textContent = ''; if (text) msg.append(banner(kind === 'err' ? 'circle-alert' : 'info', text, kind)); };
  const fail = e => {
    if (e instanceof ApiError && e.status === 422 && e.body && e.body.issues) say('This request cannot be submitted yet. Fix what is listed under the buttons.', 'err');
    else if (e instanceof ApiError && e.status === 409) { say(e.message + ' ', 'err'); msg.firstChild.append(h('button', { class: 'btn sm', type: 'button', style: 'margin-left:12px', text: 'Reload', onclick: reload })); }
    else say(e.message || 'Something went wrong. Nothing was changed.', 'err');
  };
  body.append(msg);

  /* ---- no open request: start one ---- */
  if (!req) {
    const can = detail.canStart;
    const startBtn = h('button', { class: 'btn primary', type: 'button', disabled: !(detail.access.edit && can.ok), text: can.ok && can.kind === 'additional' ? 'Bill again (additional request)' : `Start billing for ${monthLabel(detail.month)}`,
      onclick: async () => { try { const r = await Billing.startRequest(wbs1); location.hash = `#/billing/${encodeURIComponent(wbs1)}/${r.id}`; } catch (e) { fail(e); } } });
    body.append(h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Nothing is open for this project' }),
      h('p', { text: can.ok ? (can.kind === 'additional' ? `A request for ${monthLabel(detail.month)} is already in. You can send another one, marked "additional".` : 'You have not started billing for this month yet.') : 'Another request for this project is still open.' })),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: detail.access.edit ? 'Nothing is locked. You can bill at any time, including mid-month.' : 'You can read this project. Only its PM or PIC starts a request.' }), h('div', { class: 'acts' }, startBtn))));
    body.append(...projectNotesAndHistory(ctx, detail, null, reload, fail));
    return;
  }

  /* ---- the request ---- */
  const editing = detail.access.edit && ['draft', 'returned', 'submitted', 'review'].includes(req.status);
  const canWrite = editing && req.access.edit;
  const fixed = req.form === 'fixed';
  const F = fixed ? FX() : HR();
  const facts = req.facts;
  const st = {
    entries: JSON.parse(JSON.stringify(req.draft.entries || {})), noBilling: !!req.draft.noBilling,
    sourceHash: req.sourceHash, ack: false,
  };
  const lastReturn = [...req.events].reverse().find(e => e.event === 'return');

  body.append(h('div', { class: 'bproj-status' }, statusChip(h, req.status), req.kind === 'additional' ? h('span', { class: 'chip', text: 'Additional request' }) : null,
    req.revision ? h('span', { class: 'muted', text: `Revision ${req.revision}` }) : null,
    req.handledBy ? h('span', { class: 'muted', text: `${req.handledBy.name} is reviewing it` }) : null,
    req.status === 'processed' && req.invoiceRef ? h('span', { class: 'muted', text: `Invoice ${req.invoiceRef}` }) : null));
  if (req.status === 'returned' && lastReturn) body.append(h('div', { class: 'banner warn' }, h('span', { class: 'bmsg' }, icon('triangle-alert'), h('span', {}, h('b', { text: `Accounting sent this back (${lastReturn.by}, ${fmtTime(lastReturn.at)}): ` }), lastReturn.text))));
  const staleBox = h('div', {});
  const drawStale = () => {
    staleBox.textContent = '';
    if (!canWrite || !(req.currentSourceHash != null && req.currentSourceHash !== req.sourceHash) || st.ack) return;
    staleBox.append(h('div', { class: 'banner warn' }, h('span', { class: 'bmsg' }, icon('triangle-alert'), h('span', { text: 'The Vantagepoint numbers changed since you started. The figures below are the new ones. Look them over, then confirm.' })),
      h('button', { class: 'btn sm', type: 'button', text: 'I have looked at them', onclick: () => { st.ack = true; st.sourceHash = req.currentSourceHash; drawStale(); recalc(); } })));
  };
  body.append(staleBox);

  const formBody = h('div', {});
  const totalsBox = h('div', { class: 'bproj-totals' });
  const issuesBox = h('div', { class: 'bproj-issues' });
  const cells = {}; // per line: the boxes that change as the person types

  /* ---- the form ---- */
  let lines;
  const parseAmt = text => { const t = String(text).trim(); if (t === '') return null; const c = CB().parseCents(t); return c; };
  const entryOf = (c) => ({ amountCents: c });

  function buildFixed() {
    const rows = facts.phases.map(p => {
      const c = cells[p.id] = {};
      const prior = p.billedCents + (p.pendingCents || 0);
      const locked = prior >= p.feeCents;
      c.pct = h('input', { class: 'txt narrow', type: 'text', inputmode: 'decimal', disabled: !canWrite || locked, 'aria-label': `Bill through percent for ${p.name}` });
      c.amt = h('input', { class: 'txt narrow money-in', type: 'text', inputmode: 'decimal', disabled: !canWrite || locked, 'aria-label': `Amount this billing for ${p.name}` });
      c.rem = h('td', { class: 'r' }); c.err = h('div', { class: 'cell-err' });
      c.pct.addEventListener('input', () => {
        const bp = CB().parseBp(c.pct.value);
        edit(p.id, c.pct.value.trim() === '' || bp === null ? null : { pctBp: bp }, c.pct.value.trim() !== '' && bp === null, 'pct');
      });
      c.amt.addEventListener('input', () => {
        const v = parseAmt(c.amt.value);
        edit(p.id, v === null ? null : entryOf(v), c.amt.value.trim() !== '' && v === null, 'amt');
      });
      for (const k of ['pct', 'amt']) { c[k].addEventListener('blur', () => syncBoxes(p.id, true)); c[k].addEventListener('focus', () => c[k].select()); }
      return h('tr', {},
        h('td', { class: 'strong' }, p.name, c.err),
        h('td', { class: 'r', text: money(p.feeCents) }),
        h('td', { class: 'r', title: p.pendingCents ? `${money(p.billedCents)} in Vantagepoint plus ${money(p.pendingCents)} sent but not yet invoiced` : 'Billed to date in Vantagepoint', text: money(prior) + (p.pendingCents ? ' *' : '') }),
        h('td', { class: 'r muted', text: money(p.projectionCents) }),
        h('td', {}, locked ? h('span', { class: 'chip ok', text: 'Fully billed' }) : h('span', { class: 'ctl-inline' }, c.pct, h('span', { class: 'muted', text: '%' }))),
        h('td', {}, locked ? null : h('span', { class: 'ctl-inline' }, h('span', { class: 'muted', text: '$' }), c.amt)),
        c.rem);
    });
    return h('div', { class: 'tblwrap' }, h('table', { class: 'dt bill-tbl' },
      h('thead', {}, h('tr', {}, ...['Phase', 'Fee', 'Billed to date', 'Projection this month', 'Bill through', 'Amount this billing', 'Left after'].map((x, i) => h('th', { class: i === 1 || i === 2 || i === 3 || i === 6 ? 'r' : '', text: x })))),
      h('tbody', {}, ...rows)));
  }
  function buildHourly() {
    const rows = facts.lines.map(l => {
      const c = cells[l.id] = {};
      c.amt = h('input', { class: 'txt narrow money-in', type: 'text', inputmode: 'decimal', disabled: !canWrite, 'aria-label': `Amount this billing for ${l.name}` });
      c.err = h('div', { class: 'cell-err' });
      c.amt.addEventListener('input', () => { const v = parseAmt(c.amt.value); edit(l.id, v === null ? null : entryOf(v), c.amt.value.trim() !== '' && v === null, 'amt'); });
      c.amt.addEventListener('blur', () => syncBoxes(l.id, true)); c.amt.addEventListener('focus', () => c.amt.select());
      return h('tr', {},
        h('td', { class: 'strong' }, l.name, c.err),
        h('td', { text: { labor: 'Labor', expense: 'Expense', consultant: 'Consultant' }[l.kind] || l.kind }),
        h('td', { class: 'r', text: money(l.availableCents) }),
        h('td', { class: 'r muted', text: money(l.projectionCents) }),
        h('td', {}, h('span', { class: 'ctl-inline' }, h('span', { class: 'muted', text: '$' }), c.amt)));
    });
    return h('div', { class: 'tblwrap' }, h('table', { class: 'dt bill-tbl' },
      h('thead', {}, h('tr', {}, ...['Line', 'Type', 'Available to bill', 'Projection this month', 'Amount this billing'].map((x, i) => h('th', { class: i === 2 || i === 3 ? 'r' : '', text: x })))),
      h('tbody', {}, ...rows)));
  }

  const noBox = h('input', { type: 'checkbox', disabled: !canWrite, checked: st.noBilling, id: 'no-billing' });
  noBox.addEventListener('change', () => { if (noBox.checked) quick('none'); else { st.noBilling = false; recalc(); } });
  const quickBtn = (text, action) => h('button', { class: 'btn quiet sm', type: 'button', disabled: !canWrite, text, onclick: () => quick(action) });

  function quick(action) {
    const q = F.quickAction(fixed ? facts.phases : facts.lines, action);
    st.entries = q.entries; st.noBilling = q.noBilling;
    for (const id of Object.keys(cells)) syncBoxes(id, true);
    recalc();
  }

  /* the person typed in one box */
  function edit(id, entry, invalid, from) {
    const next = fixed ? F.applyEdit({ entries: st.entries, noBilling: st.noBilling, phases: facts.phases }, id, entry) : { entries: Object.assign({}, st.entries, { [id]: entry }), noBilling: st.noBilling };
    const positive = entry && (entry.amountCents > 0 || (fixed && entry.pctBp > 0));
    st.entries = next.entries; st.noBilling = positive ? false : next.noBilling;
    cells[id][from].setAttribute('aria-invalid', invalid ? 'true' : 'false');
    recalc(id, from);
  }

  /* fill the boxes of one line from the entry; `all` also rewrites the box being typed in */
  function syncBoxes(id, all, typing) {
    const c = cells[id], e = st.entries[id], ln = lines && lines.find(l => l.id === id);
    if (!c) return;
    if (!e || (e.amountCents == null && e.pctBp == null)) { if (all) { if (c.pct) c.pct.value = ''; c.amt.value = ''; } return; }
    if (c.pct && typing !== 'pct') c.pct.value = ln && ln.throughBp != null ? CB().bpText(ln.throughBp) : (e.pctBp != null ? CB().bpText(e.pctBp) : '');
    if (typing !== 'amt') c.amt.value = e.pctBp != null && ln && ln.amountCents != null ? plain(ln.amountCents) : e.amountCents != null ? plain(e.amountCents) : '';
  }

  const evaluate = () => (fixed ? F.evaluate(facts.phases, st.entries) : F.evaluate(facts.hourlyProject, facts.lines, st.entries));
  let verdict = null;
  function recalc(id, typing) {
    const ev = evaluate();
    lines = ev.lines;
    for (const l of ev.lines) {
      const c = cells[l.id];
      if (!c) continue;
      if (id === l.id) syncBoxes(l.id, false, typing); else syncBoxes(l.id, false);
      if (c.rem) c.rem.textContent = l.remainingCents == null ? '-' : money(l.remainingCents);
      const e = st.entries[l.id];
      const shown = (e && (e.amountCents != null || e.pctBp != null)) || id === l.id;
      c.err.textContent = shown && l.errors.length ? issueText({ code: 'line-' + l.errors[0], lineId: l.id }, ev, 0) : '';
    }
    verdict = CB().review(ev, { noBilling: st.noBilling, notes: notesEd.text(), projectionCents: ev.projectionCents, thresholdCents: detail.thresholdCents, sourceHash: st.sourceHash, currentSourceHash: req.currentSourceHash });
    noBox.checked = st.noBilling;
    totalsBox.textContent = '';
    totalsBox.append(...[
      h('span', {}, 'Total this billing ', h('b', { text: ev.totalCents == null ? '-' : money(ev.totalCents) })),
      h('span', { class: 'muted', text: `Projection ${money(ev.projectionCents)}` }),
      ev.totalCents != null ? h('span', { class: 'muted', text: `Difference ${money(Math.abs(ev.totalCents - ev.projectionCents))}` }) : null,
      !fixed && ev.authorizedCents != null ? h('span', { class: 'muted', text: `Authorization left after this: ${ev.remainingAuthorizationCents == null ? '-' : money(ev.remainingAuthorizationCents)}` }) : null].filter(Boolean));
    drawIssues();
  }

  function drawIssues() {
    issuesBox.textContent = '';
    if (!canWrite) return;
    const ev = evaluate();
    // the per-line errors are already under each line; here, what stops Submit
    const items = verdict.issues.map(i => issueText(i, ev, detail.thresholdCents));
    submitBtns.forEach(b => { b.disabled = !verdict.canSubmit; });
    if (items.length) issuesBox.append(h('div', { class: 'muted', text: 'To submit:' }), h('ul', {}, ...items.map(t => h('li', { text: t }))));
  }

  /* ---- build the screen ---- */
  const notesEd = richEditor(h, { html: req.draft.notes || '', editable: canWrite, label: 'Notes to accounting' });
  notesEd.box.addEventListener('input', () => recalc());

  const fixedActions = fixed
    ? [quickBtn('Reset to billed', 'reset'), quickBtn('Use phase projections', 'projection')]
    : [quickBtn('Bill everything available', 'all'), quickBtn('Use projections', 'projection'), quickBtn('Clear', 'clear')];
  formBody.append(...[
    canWrite ? h('div', { class: 'bproj-quick' }, ...fixedActions, quickBtn('No new billings', 'none'), h('label', { class: 'check' }, noBox, h('span', { text: 'No billing this month' }))) : null,
    fixed ? buildFixed() : buildHourly(),
    facts.phases && facts.phases.some(p => p.pendingCents) ? h('p', { class: 'muted bproj-foot', text: '* Includes an amount already sent to accounting that Vantagepoint does not show yet.' }) : null,
    !fixed && facts.hourlyProject.pendingCents ? h('p', { class: 'muted bproj-foot', text: `Includes ${money(facts.hourlyProject.pendingCents)} already sent to accounting that Vantagepoint does not show yet.` }) : null,
    totalsBox].filter(Boolean));

  const hourlyHead = !fixed ? h('div', { class: 'bproj-facts' },
    h('span', {}, 'Authorized ', h('b', { text: facts.hourlyProject.authorizedCents == null ? 'no limit' : money(facts.hourlyProject.authorizedCents) })),
    h('span', {}, 'Billed to date ', h('b', { text: money(facts.hourlyProject.billedCents) })),
    h('span', {}, 'Waiting for invoice ', h('b', { text: money(facts.hourlyProject.pendingCents) }))) : null;

  body.append(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: fixed ? 'What to bill, by phase' : 'What to bill, by line' }),
      h('p', { text: fixed ? '"Bill through" is the total percent of the phase billed once this is done, not percent complete. Type either box; the other follows.' : 'Type the amount to bill on each line. A line cannot go past what is available, and the total cannot pass the authorization.' })),
    h('div', { class: 'sec-body' }, hourlyHead, canWrite ? formBody : readOnlyLines(ctx, req, fixed, formBody))));

  body.append(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Notes to accounting' }), h('p', { text: 'Anything accounting needs for this invoice. A note is required when the total is far from the projection.' })),
    h('div', { class: 'sec-body', style: 'padding-top:12px;padding-bottom:12px' }, canWrite ? notesEd.el : (req.draft.notes ? showRich(h, req.draft.notes) : h('p', { class: 'muted', text: 'No notes.' })))));

  /* ---- buttons ---- */
  const answer = h('textarea', { class: 'txt', rows: '3', placeholder: 'Your answer to accounting', 'aria-label': 'Answer to accounting' });
  const payload = () => ({
    rev: req.rev, sourceHash: st.sourceHash, noBilling: st.noBilling, notes: notesEd.html(),
    entries: Object.fromEntries(Object.entries(st.entries).map(([k, e]) => [k, e && (e.pctBp != null || e.amountCents != null) ? (e.pctBp != null ? { pctBp: e.pctBp } : { amountCents: e.amountCents }) : { amountCents: null }])),
  });
  const run = async (fn, okText) => { try { await fn(); await reload(); if (okText) { const m = body.querySelector('[role=status]'); if (m) { m.append(banner('check', okText)); } } } catch (e) { fail(e); } };
  const actions = req.actions;
  const submitEvent = ['submit', 'resubmit', 'revise'].find(e => actions.includes(e));
  const submitLabel = { submit: 'Submit to accounting', resubmit: 'Resubmit', revise: 'Send revision' }[submitEvent];
  const submitBtns = [];
  const btns = [];
  if (canWrite) {
    if (req.status === 'draft' || req.status === 'returned') btns.push(h('button', { class: 'btn', type: 'button', text: 'Save draft', onclick: () => run(() => Billing.saveDraft(req.id, payload()), 'Draft saved.') }));
    if (submitEvent) { const b = h('button', { class: 'btn primary', type: 'button', text: submitLabel, onclick: () => run(() => Billing.act(req.id, submitEvent, payload()), req.status === 'draft' || req.status === 'returned' ? 'Sent to accounting.' : 'Revision sent.') }); submitBtns.push(b); btns.push(b); }
    if (actions.includes('withdraw')) btns.push(h('button', { class: 'btn quiet', type: 'button', text: 'Withdraw to draft', onclick: () => run(() => Billing.act(req.id, 'withdraw', { rev: req.rev }), 'Back to a draft. Nothing was sent.') }));
  }
  body.append(h('section', { class: 'sec' },
    actions.includes('answer') && detail.access.edit ? h('div', { class: 'sec-body', style: 'padding-top:12px;padding-bottom:12px' }, h('div', { class: 'stack' }, h('div', { class: 'lab', style: 'font-weight:700', text: 'Reply to accounting' }), answer,
      h('div', {}, h('button', { class: 'btn', type: 'button', text: 'Send reply', onclick: () => run(() => Billing.act(req.id, 'answer', { rev: req.rev, text: answer.value }), 'Reply sent.') })))) : null,
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: canWrite ? (req.status === 'draft' || req.status === 'returned' ? 'Save draft keeps what you have, even if it is not ready.' : 'This is already with accounting. Send a revision to change it; the earlier one stays in the history.') : 'You are reading this request.' }),
      h('div', { class: 'acts' }, ...btns))));
  body.append(issuesBox);

  drawStale();
  const ev0 = evaluate(); lines = ev0.lines;
  for (const id of Object.keys(cells)) syncBoxes(id, true);
  if (canWrite) recalc(); else { totalsBox.textContent = ''; }
  body.append(...projectNotesAndHistory(ctx, detail, req, reload, fail));
}

/* a request nobody is editing: what was sent, from the latest revision (or the draft, if nothing was sent yet) */
function readOnlyLines(ctx, req, fixed, fallback) {
  const { h } = ctx;
  const rev = req.revisions[req.revisions.length - 1];
  const lines = rev ? rev.lines : (req.evaluated ? req.evaluated.lines : []);
  if (!lines.length) return fallback;
  const total = rev ? rev.totalCents : req.evaluated.totalCents;
  const head = fixed ? ['Phase', 'Fee', 'Billed before', 'Bill through', 'Amount'] : ['Line', 'Type', 'Available', 'Amount'];
  const rows = lines.map(l => fixed
    ? h('tr', {}, h('td', { class: 'strong', text: l.name }), h('td', { class: 'r', text: money(l.feeCents) }), h('td', { class: 'r', text: money(l.priorCents) }), h('td', { class: 'r', text: l.throughBp == null ? '-' : CB().bpText(l.throughBp) + '%' }), h('td', { class: 'r', text: l.amountCents == null ? '-' : money(l.amountCents) }))
    : h('tr', {}, h('td', { class: 'strong', text: l.name }), h('td', { text: { labor: 'Labor', expense: 'Expense', consultant: 'Consultant' }[l.kind] || l.kind }), h('td', { class: 'r', text: money(l.availableCents) }), h('td', { class: 'r', text: l.amountCents == null ? '-' : money(l.amountCents) })));
  return h('div', {}, h('div', { class: 'tblwrap' }, h('table', { class: 'dt bill-tbl' },
    h('thead', {}, h('tr', {}, ...head.map((x, i) => h('th', { class: (fixed ? i > 0 : i > 1) ? 'r' : '', text: x })))), h('tbody', {}, ...rows))),
  h('div', { class: 'bproj-totals' }, h('span', {}, 'Total ', h('b', { text: total == null ? '-' : money(total) })), rev ? h('span', { class: 'muted', text: `Projection ${money(rev.projectionCents)}` }) : null, rev && rev.noBilling ? h('span', { class: 'chip', text: 'No billing this month' }) : null));
}

/* project notes (kept for every month), this request's trail, earlier requests, and Advanced settings */
function projectNotesAndHistory(ctx, detail, req, reload, fail) {
  const { h } = ctx;
  const out = [];
  const notesEd = richEditor(h, { html: detail.notes ? detail.notes.body : '', editable: detail.access.edit, label: 'Project billing notes' });
  const saved = h('span', { class: 'saved', role: 'status' });
  out.push(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Project notes' }), h('p', { text: 'Standing instructions for this project\'s billing: who gets the invoice, what to attach, anything accounting should know every month.' })),
    h('div', { class: 'sec-body', style: 'padding-top:12px;padding-bottom:12px' }, notesEd.el),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: detail.notes ? `Last saved ${fmtTime(detail.notes.at)} by ${detail.notes.by}.` : 'No project notes yet.' }),
      detail.access.edit ? h('div', { class: 'acts' }, saved, h('button', { class: 'btn', type: 'button', text: 'Save project notes', onclick: async () => { try { await Billing.saveNotes(detail.wbs1, notesEd.html()); saved.textContent = 'Saved.'; } catch (e) { fail(e); } } })) : null)));

  if (req && (req.events.length || req.revisions.length)) {
    const trail = req.events.slice().reverse().map(e => h('li', {}, h('span', { class: 'muted', text: fmtTime(e.at) + '  ' }), h('b', { text: e.by }), ' ' + ({ create: 'started it', submit: 'submitted it', resubmit: 'resubmitted it', revise: 'sent a revision', withdraw: 'withdrew it', edit: 'reopened it to edit', answer: 'replied', 'start-review': 'began the review', return: 'sent it back', process: 'marked it processed', release: 'released it' }[e.event] || e.event), e.text ? h('div', { class: 'trail-text', text: e.text }) : null));
    const revs = req.revisions.slice().reverse().map(v => h('tr', {}, h('td', { text: 'Revision ' + v.number }), h('td', { class: 'muted', text: fmtTime(v.at) }), h('td', { text: v.by }), h('td', { class: 'r', text: v.totalCents == null ? '-' : money(v.totalCents) }), h('td', { class: 'muted', text: v.noBilling ? 'No billing' : '' })));
    out.push(h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: 'This request' }), h('p', { text: 'Everything that happened to it. Nothing here is ever changed or deleted.' })),
      h('div', { class: 'sec-body', style: 'padding-top:12px;padding-bottom:12px' }, h('ul', { class: 'trail' }, ...trail),
        revs.length ? h('div', { class: 'tblwrap' }, h('table', { class: 'dt' }, h('thead', {}, h('tr', {}, ...['Sent', 'When', 'By', 'Total', ''].map((x, i) => h('th', { class: i === 3 ? 'r' : '', text: x })))), h('tbody', {}, ...revs))) : null)));
  }

  if (detail.history.length) {
    out.push(h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Earlier billing' })),
      h('div', { class: 'tblwrap' }, h('table', { class: 'dt' },
        h('thead', {}, h('tr', {}, ...['Month', 'Request', 'Status', 'Amount', 'Sent'].map((x, i) => h('th', { class: i === 3 ? 'r' : '', text: x })))),
        h('tbody', {}, ...detail.history.map(r => h('tr', {}, h('td', {}, h('a', { href: `#/billing/${encodeURIComponent(detail.wbs1)}/${r.id}`, text: monthLabel(r.month) })), h('td', { text: r.kind === 'additional' ? 'Additional' : 'Regular' }), h('td', {}, statusChip(h, r.status)), h('td', { class: 'r', text: r.totalCents == null ? '-' : money(r.totalCents) }), h('td', { class: 'muted', text: r.submittedOn ? longDate(r.submittedOn) : '-' }))))))));
  }

  /* Advanced settings: this project's own reset day; leaving it out of a month */
  const adj = detail.adjustments || { rolloverDay: null, excluded: [] };
  const day = h('select', { class: 'txt', style: 'width:130px', disabled: !detail.access.edit, 'aria-label': 'Reset day for this project', onchange: async () => { try { await Billing.adjust(detail.wbs1, { rolloverDay: day.value === '' ? null : Number(day.value) }); await reload(); } catch (e) { fail(e); } } },
    h('option', { value: '', text: 'Firm default', selected: adj.rolloverDay === null }), ...Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1), text: 'Day ' + (i + 1), selected: adj.rolloverDay === i + 1 })));
  const why = h('input', { class: 'txt', type: 'text', maxlength: '200', placeholder: 'Why (required)', style: 'width:240px', disabled: !detail.access.edit, 'aria-label': 'Reason for leaving this month out' });
  const here = h('details', { class: 'sec adv' }, h('summary', { text: 'Advanced settings' }),
    h('div', { class: 'sec-body' },
      ctx.row('Reset day', 'The day each month this project goes back on your unbilled list. Leave it on the firm default unless this client bills on its own schedule.', day),
      ctx.row(`Leave out of ${monthLabel(detail.month)}`, 'Use this when there is nothing to bill and you do not want to enter $0. It stays on record with your reason.', why, h('button', { class: 'btn quiet sm', type: 'button', disabled: !detail.access.edit, text: 'Leave out', onclick: async () => {
        if (!why.value.trim()) { why.focus(); return; }
        try { await Billing.adjust(detail.wbs1, { exclude: { month: detail.month, reason: why.value } }); await reload(); } catch (e) { fail(e); }
      } })),
      ...adj.excluded.map(x => ctx.row(`Left out of ${monthLabel(x.month)}`, x.reason, detail.access.edit ? h('button', { class: 'btn quiet sm', type: 'button', text: 'Put back', onclick: async () => { try { await Billing.adjust(detail.wbs1, { include: x.month }); await reload(); } catch (e) { fail(e); } } }) : null))));
  out.push(here);
  return out;
}
