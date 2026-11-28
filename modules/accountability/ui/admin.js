/* Admin > Accountability: each PIC's billed goal for the year, and the project sizes behind "projects to reach goal".
   Built from the Admin shell's own card and row helpers (ctx), so it looks and saves the same way. */
import { Accountability, Admin } from '/shared/platform/index.js';

const dollars = cents => Math.round(cents / 100).toLocaleString('en-US');
const parseDollars = t => { const s = String(t).replace(/[$,\s]/g, ''); return s === '' ? null : Number.isNaN(Number(s)) ? NaN : Math.round(Number(s) * 100); };

export function accountabilityAdminCards(ctx, settings, inputs, canEdit, rerender) {
  const { h } = ctx;
  const cards = [];

  // ---- goals ----
  const known = inputs.years.length ? inputs.years : [new Date().getFullYear()];
  const years = [...new Set(known.concat([Math.max(...known) + 1]))].sort((a, b) => b - a);
  let year = known[0];
  const holder = h('div', {});
  const totalLine = h('p', { class: 'muted', style: 'margin:8px 16px' });
  const paint = () => {
    holder.textContent = '';
    const amountOf = pic => (inputs.goals.find(g => g.year === year && g.pic === pic) || {}).amount;
    const rows = inputs.pics.map(p => {
      const cur = amountOf(p.code);
      const msg = h('span', { class: 'muted small' });
      const input = h('input', { class: 'txt', type: 'text', inputmode: 'numeric', style: 'width:150px;text-align:right', value: cur === undefined ? '' : dollars(cur), disabled: !canEdit, 'aria-label': `${year} billed goal for ${p.name}`, placeholder: 'No goal' });
      input.addEventListener('change', async () => {
        const amount = parseDollars(input.value);
        if (Number.isNaN(amount)) { msg.textContent = 'Enter an amount in dollars, or leave it empty for no goal.'; return; }
        try { Object.assign(inputs, await Accountability.setGoal({ year, pic: p.code, amount })); msg.textContent = amount === null ? 'Removed.' : 'Saved.'; input.value = amount === null ? '' : dollars(amount); total(); } catch (e) { msg.textContent = e.message; }
      });
      return h('tr', {}, h('td', { class: 'strong', text: p.name }), h('td', { class: 'r' }, input), h('td', {}, msg));
    });
    holder.append(h('div', { class: 'tblwrap' }, h('table', { class: 'dt', style: 'min-width:520px' }, h('thead', {}, h('tr', {}, h('th', { text: 'PIC' }), h('th', { class: 'r', text: `${year} billed goal` }), h('th', { text: '' }))), h('tbody', {}, ...rows))), totalLine);
    total();
  };
  const total = () => {
    const g = inputs.goals.filter(x => x.year === year);
    totalLine.textContent = g.length ? `${g.length} ${g.length === 1 ? 'PIC has' : 'PICs have'} a ${year} goal, adding up to $${dollars(g.reduce((a, x) => a + x.amount, 0))}.` : `No ${year} goals yet.`;
  };
  const yearSel = h('select', { class: 'txt', style: 'width:110px', 'aria-label': 'Goal year', onchange: e => { year = Number(e.target.value); paint(); } }, ...years.map(y => h('option', { value: String(y), text: String(y), selected: y === year })));
  cards.push(h('section', { class: 'sec' },
    h('div', { class: 'sec-head home-head' }, h('div', {}, h('h2', { text: 'Billed goals' }), h('p', { text: 'Each PIC\'s goal for gross billings in the year (not the Marketing Report\'s goals, which are net of consultants). A PIC with a goal always has a row, even with nothing billed; leave it empty for no goal. Each report uses the goals as they are when it is built.' })), yearSel),
    holder));
  paint();

  // ---- project sizes ----
  const sizes = settings['acct.projectSizes'].value.map(s => ({ ...s }));
  const list = h('div', { class: 'sec-body' });
  const msg = h('span', { class: 'note' });
  const paintSizes = () => {
    list.textContent = '';
    sizes.forEach((s, i) => {
      const label = h('input', { class: 'txt', type: 'text', style: 'width:200px', value: s.label, disabled: !canEdit, 'aria-label': `Size ${i + 1} name`, oninput: e => { s.label = e.target.value; } });
      const fee = h('input', { class: 'txt', type: 'text', inputmode: 'numeric', style: 'width:130px;text-align:right', value: s.fee.toLocaleString('en-US'), disabled: !canEdit, 'aria-label': `Size ${i + 1} fee in dollars`, oninput: e => { s.fee = Number(e.target.value.replace(/[$,\s]/g, '')); } });
      const del = canEdit && sizes.length > 1 ? h('button', { class: 'btn quiet sm', type: 'button', text: 'Remove', onclick: () => { sizes.splice(i, 1); paintSizes(); } }) : null;
      list.append(ctx.row(`Size ${i + 1}`, null, label, fee, h('span', { class: 'muted', text: 'fee' }), del));
    });
    if (canEdit && sizes.length < 6) list.append(h('div', { style: 'padding:8px 0' }, h('button', { class: 'btn sm', type: 'button', text: 'Add a size', onclick: () => { sizes.push({ label: 'Projects', fee: 100000 }); paintSizes(); } })));
  };
  paintSizes();
  cards.push(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Projects to reach goal' }), h('p', { text: 'For each size: how many projects of that fee it would take to close a PIC\'s shortfall (the goal less billed and backlog), rounded up. The name is the construction size the fee stands for. A report keeps the sizes it was built with.' })),
    list,
    canEdit ? h('div', { class: 'sec-foot' }, msg, h('div', { class: 'acts' },
      h('button', { class: 'btn quiet', type: 'button', text: 'Discard', onclick: rerender }),
      h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: async () => {
        const clean = sizes.map(s => ({ label: s.label.trim(), fee: s.fee }));
        if (clean.some(s => !s.label || !Number.isInteger(s.fee) || s.fee < 1000)) { msg.textContent = 'Each size needs a name and a fee of at least $1,000, in whole dollars.'; return; }
        try { await Admin.saveSettings({ 'acct.projectSizes': clean }); await rerender(); } catch (e) { msg.textContent = e.message; }
      } }))) : null));
  // ---- overhead in YTD profit ----
  cards.push(ctx.settingsCard('Overhead in YTD profit', 'Profit is billed less labor times (1 + overhead) less expenses. A project with no overhead plan in Vantagepoint is not counted. A report records the rule it was built with.', settings, ['acct.overheadRule', 'acct.assignedOverheadPct'], canEdit, rerender, ed => [
    ctx.row('Overhead rate used', 'Decided: 200% for all (the assigned rate on every project with a plan). Each project\'s own plan rate is what Project Turnaround uses.', ed.select('acct.overheadRule', [['assigned', 'The assigned rate, on every project with a plan'], ['project', 'Each project\'s own plan rate']])),
    ctx.row('Assigned overhead rate', 'Also shown in the firm figures under the table.', ed.num('acct.assignedOverheadPct', { narrow: true }), h('span', { class: 'muted', text: '%' })),
  ]));
  return cards;
}
