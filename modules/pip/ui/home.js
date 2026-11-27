/* Projects in Pursuit home: PiPs still waiting (submitted, not yet created in Vantagepoint) at the top, then the last 30 days.
   A PiP admin sees "Review this PiP" on the ones waiting for them; whoever submitted a returned one sees "Fix and resubmit". */
import { Pip } from '/shared/platform/index.js';
import { money, day, when, statusChip, aiaChip } from '/modules/pip/ui/common.js';

export async function renderPipHome(ctx, body, state) {
  const { h, actions } = ctx;
  const view = state || { only2030: false };
  const data = await Pip.home();
  const redraw = () => { body.textContent = ''; return renderPipHome(ctx, body, view); };

  actions(body, data.perms.submit ? h('a', { class: 'btn primary', href: '#/pip/new' }, h('span', { html: ctx.T.icon('plus', 16) }), h('span', { text: 'New PiP' })) : null);

  const flagged = r => r.aia2030.key === 'rep' || r.aia2030.key === 'review';
  const keep = r => !view.only2030 || flagged(r);
  const toReview = data.waiting.filter(r => r.review).length;
  const toFix = data.waiting.filter(r => r.mineToFix).length;

  const chips = h('div', { class: 'pip-chips' },
    h('span', { class: 'chip blue', text: `Waiting ${data.waiting.length}` }),
    data.perms.review ? h('span', { class: 'chip ' + (toReview ? 'warn' : ''), text: `For you to review ${toReview}` }) : null,
    toFix ? h('span', { class: 'chip warn', text: `Returned to you ${toFix}` }) : null,
    h('span', { class: 'grow' }),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' },
      ...[[false, 'All PiPs'], [true, 'AIA 2030 flagged']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(view.only2030 === v), text: l, onclick: () => { view.only2030 = v; redraw(); } }))));
  body.append(chips);

  const table = (rows, kind) => h('div', { class: 'tblwrap' }, h('table', { class: 'dt pip-tbl' },
    h('thead', {}, h('tr', {}, ...['PiP', 'Project', 'Client', 'Est. fee', 'Est. start', kind === 'waiting' ? 'Submitted' : 'Decided', 'Status', ''].map((x, i) => h('th', { class: i === 3 ? 'r' : '', text: x })))),
    h('tbody', {}, ...rows.map(r => h('tr', {},
      h('td', { class: 'muted nowrap', text: String(r.seq) }),
      h('td', { class: 'strong' }, h('a', { href: '#/pip/' + r.id, text: r.name }), flagged(r) ? h('div', {}, aiaChip(h, r.aia2030)) : null),
      h('td', { text: r.client }),
      h('td', { class: 'r nowrap', text: money(r.fee) }),
      h('td', { class: 'nowrap', text: day(r.start) }),
      h('td', { class: 'nowrap' }, h('div', { text: when(kind === 'waiting' ? r.submittedAt : r.decidedAt) }), h('div', { class: 'muted small', text: r.submittedBy })),
      h('td', {}, statusChip(h, r.status, r.statusLabel), r.vpNumber ? h('div', { class: 'muted small', text: r.vpNumber }) : null),
      h('td', { class: 'r' }, r.review ? h('a', { class: 'btn sm primary', href: '#/pip/' + r.id, text: 'Review this PiP' })
        : r.mineToFix ? h('a', { class: 'btn sm primary', href: '#/pip/' + r.id + '/edit', text: 'Fix and resubmit' })
          : h('a', { class: 'btn sm', href: '#/pip/' + r.id, text: 'Open' })))))));

  const waiting = data.waiting.filter(keep), recent = data.recent.filter(keep);
  body.append(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Submitted, not yet in Vantagepoint' }), h('p', { text: 'Every PiP still waiting, however old, oldest first. It leaves this list once it is created in Vantagepoint or withdrawn.' })),
    waiting.length ? table(waiting, 'waiting') : h('div', { class: 'empty-row', text: view.only2030 ? 'No AIA 2030 flagged PiPs are waiting.' : 'Nothing is waiting. Every PiP submitted has been dealt with.' })));
  body.append(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: `Last ${data.recentDays} days` }), h('p', { text: 'Created in Vantagepoint or withdrawn, newest first.' })),
    recent.length ? table(recent, 'recent') : h('div', { class: 'empty-row', text: `Nothing was created or withdrawn in the last ${data.recentDays} days.` })));
}
