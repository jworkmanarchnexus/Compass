/* One PiP: where it stands, what to do next (for whoever may), the compact review of everything submitted, and its history.
   PiP admins: Start the review, Return with a note, Mark created in Vantagepoint (with the project number), Withdraw.
   The person who submitted it: Edit and resubmit (when returned), Withdraw. */
import { Pip } from '/shared/platform/index.js';
import { statusChip, aiaChip, reviewSections, whenTime } from '/modules/pip/ui/common.js';

export async function renderPipDetail(ctx, body, pipId) {
  const { h, T, banner, actions } = ctx;
  const d = await Pip.get(pipId);
  // draw the new state off-screen, then swap it in, so the page does not flash empty
  const redraw = async () => { const fresh = document.createElement('div'); await renderPipDetail(ctx, fresh, pipId); body.replaceChildren(...fresh.childNodes); };
  const st = d.aia2030;

  const head = h('div', { class: 'pip-head' },
    h('div', {}, h('div', { class: 'pip-title', text: `PiP ${d.seq}: ${d.fields.name}` }),
      h('div', { class: 'muted', text: `Submitted by ${d.submittedBy}, ${whenTime(d.submittedAt)}` })),
    h('div', { class: 'pip-chips' }, statusChip(h, d.status, d.statusLabel), aiaChip(h, st)));
  body.append(head);

  if (d.status === 'returned') {
    const last = d.events.filter(e => e.action === 'return').pop();
    body.append(banner('corner-down-right', `Returned by ${last ? last.by : 'a PiP admin'}: ${last ? last.note : ''}` + (d.mine ? ' Change what is needed and resubmit.' : ''), 'warn'));
  }
  if (d.status === 'created') {
    body.append(banner(d.vpFound ? 'circle-check' : 'info', d.vpFound
      ? `Created in Vantagepoint as ${d.vpNumber} (${d.vpFound.name}).`
      : `Created in Vantagepoint as ${d.vpNumber}. It is not in Compass's copy of Vantagepoint yet; the copy is refreshed every night.`, d.vpFound ? 'ok' : null));
  }

  /* ---- what can be done ---- */
  const msg = h('div');
  const run = async (action, extra) => {
    msg.textContent = '';
    try { await Pip.act(pipId, action, Object.assign({ status: d.status }, extra)); T.toast({ review: 'Review started.', return: 'Returned. The person who submitted it is told.', created: 'Marked created in Vantagepoint.', withdraw: 'Withdrawn.' }[action] || 'Saved.'); await redraw(); }
    catch (e) { msg.replaceChildren(banner('circle-alert', e.message, 'err')); }
  };
  const panel = h('div');
  const openPanel = (title, help, input, button, go) => {
    const btn = h('button', { type: 'button', class: 'btn primary', text: button, onclick: () => go(input.value) });
    panel.replaceChildren(h('div', { class: 'pip-panel' }, h('label', { class: 'lbl', for: input.id, text: title }), input, help ? h('div', { class: 'hint', text: help }) : null,
      h('div', { class: 'pip-bar' }, h('button', { type: 'button', class: 'btn quiet', text: 'Cancel', onclick: () => panel.replaceChildren() }), btn)));
    input.focus();
  };
  const note = id => h('textarea', { class: 'txt', id, rows: '3', maxlength: '2000' });
  const btns = [];
  if (d.actions.includes('review')) btns.push(h('button', { type: 'button', class: 'btn', text: 'Start the review', onclick: () => run('review') }));
  if (d.actions.includes('created')) btns.push(h('button', { type: 'button', class: 'btn primary', text: 'Mark created in Vantagepoint', onclick: () =>
    openPanel('Vantagepoint project number', 'The number it was given in Vantagepoint. Everyone can then see that it was created.', h('input', { class: 'txt', id: 'pip-number', maxlength: '30', autocomplete: 'off', style: 'max-width:240px' }), 'Mark created', v => run('created', { number: v })) }));
  if (d.actions.includes('return')) btns.push(h('button', { type: 'button', class: 'btn', text: 'Return with a note', onclick: () =>
    openPanel('What needs to change', 'The person who submitted it gets this note by email and can change the PiP and resubmit.', note('pip-note'), 'Return', v => run('return', { note: v })) }));
  if (d.actions.includes('resubmit')) btns.push(h('a', { class: 'btn primary', href: `#/pip/${pipId}/edit`, text: 'Edit and resubmit' }));
  if (d.actions.includes('withdraw')) btns.push(h('button', { type: 'button', class: 'btn quiet', text: 'Withdraw', onclick: () =>
    openPanel('Why is it withdrawn?', 'A withdrawn PiP is kept, marked Withdrawn. Nothing is deleted.', note('pip-why'), 'Withdraw', v => run('withdraw', { note: v })) }));
  if (btns.length) body.append(h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Next step' })), h('div', { class: 'sec-body' }, h('div', { class: 'pip-acts' }, ...btns), panel, msg)));

  /* ---- everything submitted ---- */
  body.append(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'The PiP' }), h('p', { text: d.rev > 1 ? `Version ${d.rev}: it was changed and resubmitted.` : 'As it was submitted.' })),
    h('div', { class: 'sec-body' }, reviewSections(h, d.fields, d.resolved))));

  /* ---- history ---- */
  const items = d.events.map(e => ({ at: e.at, node: h('li', {}, h('span', { class: 'muted', text: whenTime(e.at) }), h('span', { class: 'strong', text: `${e.label}` }), h('span', { text: `by ${e.by}` }),
    e.note ? h('div', { class: 'pip-hist-note', text: e.action === 'created' ? `Vantagepoint number ${e.note}` : e.note }) : null) }))
    .concat(d.emails.map(m => ({ at: m.at, node: h('li', { class: 'pip-hist-mail' }, h('span', { class: 'muted', text: whenTime(m.at) }), h('span', { text: 'Email queued to ' + m.to.map(t => `${t.name} (${t.why})`).join(', ') })) })))
    .sort((a, b) => a.at - b.at);
  body.append(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'History' }), h('p', { text: 'Every step, in order. Nothing here can be changed or removed.' })),
    h('div', { class: 'sec-body' }, h('ul', { class: 'pip-hist' }, ...items.map(i => i.node))),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: 'Emails are queued in Compass for now. Sending them is set up when Compass moves to the server.' }))));
  actions(body, h('a', { class: 'btn', href: '#/pip', text: 'All PiPs' }));
  T.hydrateIcons(body);
}
