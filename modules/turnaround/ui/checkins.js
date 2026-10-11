/* Check-in drafts: the admin's queue. Nothing here sends itself. The admin reads a draft, changes it if they like,
   opens it in their own mailbox, sends it there, and comes back to press Mark as sent. PICs never see this page. */
import { Checkins } from '/shared/platform/index.js';
import { fmtCents, fmtDay, initials, plural } from '/shared/ui/format.js';

export async function renderCheckins(ctx, body) {
  const { h } = ctx;
  const holder = h('div', { class: 'stack' });
  body.append(holder);
  let data = await Checkins.list();
  const note = h('div', { role: 'status' });
  const paint = () => {
    holder.textContent = '';
    setBadge(data.waiting.length);
    holder.append(
      h('div', { class: 'ci-top' },
        h('div', { class: 'who' }, h('span', { class: 'lbl', text: 'Who sees this' }), h('span', { class: 'chip blue', text: 'Admin only' }), h('span', { class: 'chip out', text: 'PICs never see the queue or the drafts' }), h('span', { class: 'muted', text: 'You get one email when new drafts are ready.' })),
        h('div', { class: 'ci-count' }, h('div', { class: 'k-label', text: 'In the queue' }), h('div', { class: 'k-big', text: String(data.waiting.length) }))),
      h('div', { class: 'ci-tools' },
        h('button', { class: 'btn sm', type: 'button', text: 'Check for new drafts now', onclick: async () => {
          try { const r = await Checkins.runDaily(); data = await Checkins.list(); paint(); showNote(`Checked. ${r.created} new ${r.created === 1 ? 'draft' : 'drafts'}, ${r.withdrawn} withdrawn, ${r.missed} ${r.missed === 1 ? 'commitment' : 'commitments'} recorded as missed.`); } catch (e) { showNote(e.message, true); }
        } }),
        h('span', { class: 'muted small', text: 'The scheduled job does this every day. Use this to look right now.' })),
      note);
    if (data.escalate.length) holder.append(escalateCard(ctx, data));
    if (!data.waiting.length) holder.append(h('div', { class: 'empty-note', text: 'Nothing is waiting. When a project goes past due, a draft appears here.' }));
    for (const d of data.waiting) holder.append(draftCard(ctx, d, run));
    if (data.sent.length || data.dismissed.length) holder.append(historyCard(ctx, data, run));
    ctx.T.hydrateIcons(holder);
  };
  const showNote = (t, err) => { note.textContent = ''; note.append(ctx.banner(err ? 'circle-alert' : 'info', t, err ? 'err' : '')); };
  const run = async fn => { try { data = await fn(); paint(); } catch (e) { showNote(e.message, true); } };
  paint();
}

function setBadge(n) {
  const b = document.querySelector('[data-badge="checkins"]');
  if (b) { b.textContent = String(n); b.hidden = n === 0; }
}

function mailto(email, subject, text) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

function why(d) {
  const worst = Math.max(...d.items.map(i => i.liveDaysOverdue !== undefined ? i.liveDaysOverdue : i.daysOverdue));
  return d.situation === 'overdue' ? { cls: 'crit', text: `Overdue ${plural(worst, 'day')}` } : { cls: 'crit', text: worst > 0 ? `No plan, ${plural(worst, 'day')} late` : 'No plan yet' };
}

function draftCard(ctx, d, run) {
  const { h } = ctx;
  const subject = h('input', { class: 'txt', type: 'text', value: d.subject, 'aria-label': `Subject for ${d.pic.name}` });
  const message = h('textarea', { class: 'txt', rows: '5', style: 'height:auto;padding:8px 10px', 'aria-label': `Message to ${d.pic.name}` }, d.body);
  message.value = d.body;
  const dirty = () => subject.value !== d.subject || message.value !== d.body;
  const save = async () => { if (dirty()) { await Checkins.edit(d.id, { subject: subject.value, body: message.value }); d.subject = subject.value; d.body = message.value; } };
  const projects = h('div', { class: 'muted' }, ...d.items.flatMap((i, n) => [n ? ', ' : null, h('a', { href: '#/turnaround/p/' + encodeURIComponent(i.wbs1), text: i.name }),
    d.situation === 'overdue' ? ` (${i.nextCommitmentText ? '"' + i.nextCommitmentText + '", ' : ''}due ${fmtDay(i.dueDate)})` : ` (${fmtCents(i.ytdProfit)} YTD, no plan)`]));
  const w = why(d);
  return h('section', { class: 'sec ci-card' },
    h('div', { class: 'ci-head' }, h('span', { class: 'avatar', text: initials(d.pic.name) }), h('div', {}, h('h2', { text: d.pic.name }), projects),
      h('span', { class: 'chip ' + w.cls, text: w.text }), d.step === 2 ? h('span', { class: 'chip warn', text: 'Reminder 2' }) : null),
    h('div', { class: 'sec-body', style: 'padding:10px 20px' }, h('div', { class: 'stack' },
      h('label', { class: 'fl', text: 'Subject' }), subject, h('label', { class: 'fl', text: 'Message' }), message)),
    h('div', { class: 'sec-foot' },
      h('div', { class: 'acts' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => { try { await save(); } catch (e) { /* the mail window still opens with what is on screen */ } window.location.href = mailto(d.pic.email, subject.value, message.value); } }, ctx.icon('file-text'), ' Open in Outlook'),
        h('button', { class: 'btn', type: 'button', text: 'Mark as sent', onclick: async () => { await save(); run(() => Checkins.send(d.id)); } }),
        h('button', { class: 'btn quiet', type: 'button', text: 'Dismiss', onclick: () => run(() => Checkins.dismiss(d.id)) })),
      h('span', { class: 'note', text: 'Opens a draft in your mailbox. You pick when it goes.' })));
}

function escalateCard(ctx, data) {
  const { h } = ctx;
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: `A conversation, not a draft (${data.escalate.length})` }), h('p', { text: `These are ${data.ladder.escalate} days or more past due. Talk in person.` })),
    h('div', { class: 'sec-body' }, ...data.escalate.map(e => h('div', { class: 'set-row' }, h('div', { class: 'what' }, h('div', { class: 'lab' }, h('a', { href: '#/turnaround/p/' + encodeURIComponent(e.wbs1), text: e.name })), h('div', { class: 'help', text: e.picName })),
      h('div', { class: 'ctl' }, h('span', { class: 'chip crit', text: e.situation === 'no_plan' ? `No plan, ${plural(e.daysOverdue, 'day')} late` : `Overdue ${plural(e.daysOverdue, 'day')}` }))))));
}

function historyCard(ctx, data, run) {
  const { h } = ctx;
  const row = (d, label, extra) => h('div', { class: 'set-row' },
    h('div', { class: 'what' }, h('div', { class: 'lab', text: `${d.pic.name}: ${d.subject}` }), h('div', { class: 'help', text: extra })),
    h('div', { class: 'ctl' }, h('span', { class: 'chip ' + (label === 'Sent' ? 'ok' : 'out'), text: label }), h('button', { class: 'btn quiet sm', type: 'button', text: 'Undo', onclick: () => run(() => Checkins.undo(d.id)) })));
  const follow = data.ladder.reminder2;
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Sent and dismissed' }), h('p', { text: `Sent items: if the project is still open ${follow} days after its due date, one follow-up draft appears. A dismissed draft does not come back for that item.` })),
    h('div', { class: 'sec-body' }, ...data.sent.map(d => row(d, 'Sent', 'Marked as sent. Undo puts it back in the queue.')), ...data.dismissed.map(d => row(d, 'Dismissed', 'Will not come back for these projects. Undo puts it back in the queue.'))));
}
