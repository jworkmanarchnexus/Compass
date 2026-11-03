/* Admin > Billing: the monthly deadlines, the reset-clock day, the variance threshold, business hours, and per-project adjustments.
   Money in the settings is whole cents; this screen shows and takes dollars. */
import { Billing } from '/shared/platform/index.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthLabel = m => { const [y, mm] = m.split('-').map(Number); return `${MONTHS[mm - 1]} ${y}`; };
const addMonth = (m, n) => { const [y, mm] = m.split('-').map(Number); const t = y * 12 + (mm - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const longDate = d => { const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${dd}, ${y}`; };

export function billingAdminCards(ctx, settings, state, canEdit, rerender) {
  const { h, settingsCard, row } = ctx;

  /* ---- the rules: reset day, threshold, business hours ---- */
  const dollars = (ed, key, label) => {
    const el = h('input', { class: 'txt narrow', type: 'text', inputmode: 'numeric', disabled: !canEdit, 'aria-label': label, value: String(Math.round(ed.draft[key] / 100)) });
    el.addEventListener('input', () => { const t = el.value.replace(/[$,\s]/g, ''); ed.draft[key] = /^\d+$/.test(t) ? Number(t) * 100 : NaN; });
    return h('span', { class: 'ctl', style: 'flex:none' }, h('span', { text: '$' }), el);
  };
  const resetDay = (ed) => {
    const el = h('select', { class: 'txt', style: 'width:90px', disabled: !canEdit, 'aria-label': 'Reset day', onchange: () => { ed.draft['billing.rolloverDay'] = Number(el.value); } },
      ...Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1), text: String(i + 1), selected: i + 1 === ed.draft['billing.rolloverDay'] })));
    return el;
  };
  const hours = (ed) => {
    const bh = ed.draft['billing.businessHours'];
    const time = (key, label) => {
      const opts = [];
      for (let m = 0; m < 24 * 60; m += 30) { const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; opts.push(v); }
      const el = h('select', { class: 'txt', style: 'width:110px', disabled: !canEdit, 'aria-label': label, onchange: () => { bh[key] = el.value; } },
        ...opts.map(v => { const [hh, mm] = v.split(':').map(Number); return h('option', { value: v, text: `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'a.m.' : 'p.m.'}`, selected: v === bh[key] }); }));
      return el;
    };
    const days = DAYS.map((d, i) => {
      const el = h('input', { type: 'checkbox', checked: bh.days.includes(i), disabled: !canEdit, onchange: () => { bh.days = bh.days.filter(x => x !== i); if (el.checked) bh.days.push(i); bh.days.sort(); } });
      return h('label', { class: 'check' }, el, h('span', { text: d }));
    });
    return [time('start', 'Business hours start'), h('span', { text: 'to' }), time('end', 'Business hours end'), ...days];
  };
  const rules = settingsCard('Rules', 'How the billing month turns over, and when a request needs a written reason.', settings,
    ['billing.rolloverDay', 'billing.varianceThreshold', 'billing.businessHours'], canEdit, rerender, ed => [
      row('Clock reset day', 'On this day of the month, billing moves on to the next month and every project is unbilled again. A month below can set its own date instead, and a project can have its own day under "Per-project adjustments".', resetDay(ed), h('span', { class: 'muted', text: 'of each month' })),
      row('A note is required when the total differs from the projection by more than', 'Compared with the monthly projection in Vantagepoint. Exactly this amount does not need a note; one cent more does. A change applies to requests submitted after you save.', dollars(ed, 'billing.varianceThreshold', 'Variance threshold in dollars')),
      row('Business hours', 'Routine instant emails to invoice processors wait for these hours. Only a change to the Vantagepoint data comes through at any time.', ...hours(ed)),
    ], 'Takes effect the next time someone opens a page. Requests already submitted are not changed.');

  /* a System admin reads the rules but is not a Billing user: the project data is refused, so say so rather than show empty lists */
  if (!state) return [rules, ctx.banner('info', 'Monthly deadlines and per-project adjustments are for the Billing team and the Admin.')];
  const { calendar, rows, today } = state;
  const thisMonth = today.slice(0, 7);

  /* ---- the deadline calendar ---- */
  const months = [];
  for (let i = -1; i <= 4; i++) months.push(addMonth(thisMonth, i));
  const known = new Map(calendar.map(c => [c.month, c]));
  for (const c of calendar) if (!months.includes(c.month)) months.push(c.month);
  months.sort();
  const msg = h('span', { class: 'saved', role: 'status' });
  const calRows = months.map(m => {
    const c = known.get(m) || {};
    let deadline = c.deadline || '', startsOn = c.startsOn || '';
    const dl = h('input', { class: 'txt', type: 'date', style: 'width:160px', disabled: !canEdit, 'aria-label': `Deadline for ${monthLabel(m)}`, value: deadline });
    const st = h('input', { class: 'txt', type: 'date', style: 'width:160px', disabled: !canEdit, 'aria-label': `Start date for ${monthLabel(m)}`, value: startsOn });
    dl.addEventListener('input', () => { deadline = dl.value; });
    st.addEventListener('input', () => { startsOn = st.value; });
    const save = h('button', { class: 'btn', type: 'button', text: 'Save', disabled: !canEdit, onclick: async () => {
      msg.textContent = ''; msg.className = 'saved';
      try { await Billing.saveCalendar(m, deadline, startsOn); await rerender(); } catch (e) { msg.textContent = e.message; msg.className = 'note err'; }
    } });
    return row(monthLabel(m) + (m === thisMonth ? ' (this month)' : ''), c.deadline ? `Deadline ${longDate(c.deadline)}.` : 'No deadline entered yet.',
      h('label', { class: 'pair' }, h('span', { class: 'muted', text: 'Deadline' }), dl), h('label', { class: 'pair' }, h('span', { class: 'muted', text: 'Starts on' }), st), save);
  });
  const cal = h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Monthly deadlines' }), h('p', { text: 'The date accounting needs billing requests by. Nothing is locked after it: a request can always be sent, and the list just shows it as late.' })),
    h('div', { class: 'sec-body' }, ...calRows),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: '"Starts on" is optional. Leave it empty to use the clock reset day above. Clear both boxes and save to remove a month\'s entry.' }), h('div', { class: 'acts' }, msg)));

  /* ---- per-project adjustments ---- */
  const adjMsg = h('span', { class: 'saved', role: 'status' });
  const doAdjust = async (wbs1, body) => {
    adjMsg.textContent = ''; adjMsg.className = 'saved';
    try { await Billing.adjust(wbs1, body); await rerender(); } catch (e) { adjMsg.textContent = e.message; adjMsg.className = 'note err'; }
  };
  const projRows = rows.map(r => {
    const a = r.adjustments || { rolloverDay: null, excluded: [] };
    const day = h('select', { class: 'txt', style: 'width:120px', disabled: !canEdit, 'aria-label': `Reset day for ${r.name}`, onchange: () => doAdjust(r.wbs1, { rolloverDay: day.value === '' ? null : Number(day.value) }) },
      h('option', { value: '', text: 'Firm default', selected: a.rolloverDay === null }),
      ...Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1), text: 'Day ' + (i + 1), selected: a.rolloverDay === i + 1 })));
    const reason = h('input', { class: 'txt', type: 'text', maxlength: '200', placeholder: 'Reason (required)', style: 'width:200px', disabled: !canEdit, 'aria-label': `Reason for leaving ${r.name} out of ${monthLabel(r.month)}` });
    const leave = h('button', { class: 'btn quiet sm', type: 'button', disabled: !canEdit, text: `Leave out of ${monthLabel(r.month)}`, onclick: () => {
      if (!reason.value.trim()) { adjMsg.textContent = 'Say why the project is left out.'; adjMsg.className = 'note err'; reason.focus(); return; }
      doAdjust(r.wbs1, { exclude: { month: r.month, reason: reason.value } });
    } });
    const outNow = a.excluded.map(x => h('span', { class: 'ctl', style: 'flex:none;gap:6px' }, h('span', { class: 'chip out', text: `Left out of ${monthLabel(x.month)}` }), h('span', { class: 'muted', text: x.reason }),
      canEdit ? h('button', { class: 'btn quiet sm', type: 'button', text: 'Put back', onclick: () => doAdjust(r.wbs1, { include: x.month }) }) : null));
    const isOut = a.excluded.some(x => x.month === r.month);
    return h('tr', {},
      h('td', { class: 'strong', text: r.name }), h('td', { class: 'muted nowrap', text: r.wbs1 }), h('td', { text: r.pm || '-' }),
      h('td', {}, day),
      h('td', {}, h('div', { class: 'stack', style: 'gap:6px' }, ...outNow, isOut || !canEdit ? null : h('span', { class: 'ctl', style: 'flex:none;gap:6px' }, reason, leave))));
  });
  const adjust = h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Per-project adjustments' }), h('p', { text: 'A project with its own reset day, or one left out of a month because there is nothing to bill. Every change is kept in the history with who made it. PMs and PICs can do this on their own projects, too.' })),
    rows.length ? h('div', { class: 'tblwrap' }, h('table', { class: 'dt', style: 'min-width:900px' },
      h('thead', {}, h('tr', {}, ...['Project', 'Number', 'PM', 'Reset day', 'Left out of a month'].map(x => h('th', { text: x })))),
      h('tbody', {}, ...projRows))) : h('div', { class: 'empty-row', text: 'No projects with billing data yet.' }),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: 'A left-out month stays out until someone puts it back.' }), h('div', { class: 'acts' }, adjMsg)));

  return [rules, cal, adjust];
}
