/* Billing's front page: every project expected this billing month, once each, with where it stands.
   A PM or PIC sees their own; a processor or the Admin sees all, and can narrow to what is theirs or nobody's. */
import { Billing } from '/shared/platform/index.js';
import { monthLabel, longDate, statusChip, STATUS } from '/modules/billing/ui/project.js';

const money = c => window.CompassBilling.centsText(c);
const ORDER = ['returned', 'awaiting', 'draft', 'submitted', 'review', 'processed', 'excluded']; // what needs the PM first

export async function renderBillingList(ctx, body, scope, state) {
  const { h, Session } = ctx;
  const me = Session.me();
  const canProcess = me.role === 'processor' || me.role === 'admin';
  const view = state || { scope: scope || 'all', status: '' };
  const data = await Billing.portfolio({ scope: canProcess ? view.scope : undefined });
  const redraw = () => { body.textContent = ''; return renderBillingList(ctx, body, view.scope, view); };

  const c = data.counts;
  const count = (label, n, kind) => h('span', { class: 'chip ' + (kind || ''), text: `${label} ${n}` });
  body.append(h('div', { class: 'bproj-chips' },
    count('Waiting on a PM', c.awaiting + c.draft, c.awaiting + c.draft ? 'warn' : ''), count('Returned', c.returned, c.returned ? 'crit' : ''),
    count('With accounting', c.submitted + c.review, 'blue'), count('Processed', c.processed, 'ok'), c.excluded ? count('Left out', c.excluded, 'out') : null,
    canProcess && c.unassigned !== undefined ? count('No processor yet', c.unassigned, c.unassigned ? 'warn' : '') : null));

  const status = h('select', { class: 'txt', style: 'width:210px', 'aria-label': 'Show projects that are', onchange: () => { view.status = status.value; redraw(); } },
    h('option', { value: '', text: 'All projects', selected: !view.status }),
    ...ORDER.map(s => h('option', { value: s, text: STATUS[s][1], selected: view.status === s })));
  const scopeBar = canProcess ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Whose projects' },
    ...[['all', 'All projects'], ['mine', 'Mine'], ['unassigned', 'No processor yet']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(view.scope === v), text: l, onclick: () => { view.scope = v; redraw(); } }))) : null;
  body.append(h('div', { class: 'bproj-filters' }, scopeBar, status));

  const rows = data.rows.filter(r => !view.status || r.state === view.status)
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
  if (!rows.length) { body.append(h('div', { class: 'empty-note', text: data.rows.length ? 'No projects match this filter.' : canProcess ? 'No projects here.' : 'You have no projects with billing this month.' })); return; }

  const first = data.rows[0];
  const dl = first && first.deadline;
  const link = r => `#/billing/${encodeURIComponent(r.wbs1)}${r.open ? '/' + r.open.id : ''}`;
  body.append(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: `Billing for ${first ? monthLabel(first.month) : 'this month'}` }),
      h('p', { text: dl && dl.deadline ? `Deadline ${longDate(dl.deadline)}. Nothing locks after it: a request can always be sent.` : 'No deadline has been entered for this month. Nothing is locked.' })),
    h('div', { class: 'tblwrap' }, h('table', { class: 'dt' },
      h('thead', {}, h('tr', {}, ...['Project', 'Number', 'Type', 'PM', 'Status', 'Projection', 'This billing', canProcess ? 'Processor' : '', ''].map((x, i) => h('th', { class: i === 5 || i === 6 ? 'r' : '', text: x })))),
      h('tbody', {}, ...rows.map(r => {
        const verb = r.open ? (r.open.status === 'returned' ? 'Fix' : r.open.status === 'draft' ? 'Continue' : 'Open') : r.state === 'awaiting' ? 'Bill' : 'Open';
        return h('tr', {},
          h('td', { class: 'strong' }, h('a', { href: link(r), text: r.name })), h('td', { class: 'muted nowrap', text: r.wbs1 }),
          h('td', { text: r.billingType === 'fixed' ? 'Fixed fee' : 'Hourly' }), h('td', { text: r.pm || '-' }),
          h('td', {}, statusChip(h, r.state), r.kind === 'additional' ? h('span', { class: 'chip', style: 'margin-left:6px', text: 'Additional' }) : null,
            r.state === 'excluded' ? h('div', { class: 'muted', text: r.excludedReason }) : null),
          h('td', { class: 'r', text: money(r.projectionCents) }), h('td', { class: 'r', text: r.amountCents == null ? '-' : money(r.amountCents) }),
          canProcess ? h('td', { class: 'muted', text: r.assignedTo ? r.assignedTo.name : 'Nobody yet' }) : null,
          h('td', {}, h('a', { class: 'btn sm' + (verb === 'Bill' || verb === 'Fix' ? ' primary' : ''), href: link(r), text: verb })));
      })))),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: 'Returned projects come first, then the ones nobody has started.' }))));
}
