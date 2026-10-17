/* Admin > BD reports: the annual goals, the MWIP factor history, the market sectors, the report rules and the thresholds.
   Built from the Admin shell's own card and row helpers (ctx), so it looks and saves the same way. */
import { Bd } from '/shared/platform/index.js';
import { fmtDay } from '/shared/ui/format.js';

const dollars = cents => Math.round(cents / 100).toLocaleString('en-US');

export function bdAdminCards(ctx, settings, inputs, canEdit, rerender) {
  const { h, settingsCard, row } = ctx;
  const cards = [];

  // ---- annual goals ----
  const yearsKnown = inputs.years.length ? inputs.years : [new Date().getFullYear()];
  const years = [...new Set(yearsKnown.concat([Math.max(...yearsKnown) + 1]))].sort((a, b) => b - a);
  let year = yearsKnown[0];
  const goalsHolder = h('div', {});
  const paintGoals = () => {
    goalsHolder.textContent = '';
    const keysOf = scope => { const seen = new Map(); for (const g of inputs.goals.filter(x => x.scope === scope)) if (!seen.has(g.key)) seen.set(g.key, g.name); return [...seen]; };
    const amountOf = (scope, key) => (inputs.goals.find(g => g.year === year && g.scope === scope && g.key === key) || {}).amount;
    const table = (scope, title) => {
      const rows = keysOf(scope).map(([key, name]) => {
        const cur = amountOf(scope, key);
        const msg = h('span', { class: 'muted small' });
        const input = h('input', { class: 'txt', type: 'text', inputmode: 'numeric', style: 'width:150px;text-align:right', value: cur === undefined ? '' : dollars(cur), disabled: !canEdit, 'aria-label': `${year} goal for ${name}`, placeholder: 'No goal yet' });
        input.addEventListener('change', async () => {
          const t = input.value.replace(/[$,\s]/g, '');
          if (t === '' || Number.isNaN(Number(t))) { msg.textContent = 'Enter an amount in dollars.'; return; }
          try { const next = await Bd.setGoal({ year, scope, key, amount: Math.round(Number(t) * 100) }); Object.assign(inputs, next); msg.textContent = 'Saved.'; input.value = dollars(Math.round(Number(t) * 100)); paintTotals(); } catch (e) { msg.textContent = e.message; }
        });
        return h('tr', {}, h('td', { class: 'strong', text: name }), h('td', { class: 'r' }, input), h('td', {}, msg));
      });
      return h('div', { class: 'tblwrap' }, h('table', { class: 'dt', style: 'min-width:520px' }, h('thead', {}, h('tr', {}, h('th', { text: title }), h('th', { class: 'r', text: `${year} goal` }), h('th', { text: '' }))), h('tbody', {}, ...rows)));
    };
    goalsHolder.append(table('pic', 'PIC'), totals(), table('sector', 'Market sector'));
  };
  const totals = () => { const t = h('div', { class: 'sec-body', id: 'bd-goal-total' }); t.append(totalLine()); return t; };
  const totalLine = () => {
    const sum = scope => inputs.goals.filter(g => g.year === year && g.scope === scope).reduce((a, g) => a + g.amount, 0);
    const a = sum('pic'), b = sum('sector');
    return h('p', { class: a === b ? 'muted' : 'warn-text', style: 'margin:8px 0', text: `PIC goals add up to $${dollars(a)}; sector goals add up to $${dollars(b)}.${a === b ? '' : ' They should match.'}` });
  };
  const paintTotals = () => { const t = document.getElementById('bd-goal-total'); if (t) { t.textContent = ''; t.append(totalLine()); } };
  const yearSel = h('select', { class: 'txt', style: 'width:110px', 'aria-label': 'Goal year', onchange: e => { year = Number(e.target.value); paintGoals(); } }, ...years.map(y => h('option', { value: String(y), text: String(y), selected: y === year })));
  cards.push(h('section', { class: 'sec' },
    h('div', { class: 'sec-head home-head' }, h('div', {}, h('h2', { text: 'Annual goals' }), h('p', { text: 'Architectural revenue, net of consultants. Pace is the goal times months elapsed over twelve. The firm goal is the PIC goals added up. Each report uses the goals as they are when it is built.' })), yearSel),
    goalsHolder));
  paintGoals();

  // ---- MWIP factor ----
  const date = h('input', { class: 'txt', type: 'date', style: 'width:170px', 'aria-label': 'Effective from', disabled: !canEdit });
  const factor = h('input', { class: 'txt', type: 'text', inputmode: 'decimal', style: 'width:90px', 'aria-label': 'New factor', placeholder: '0.67', disabled: !canEdit });
  const fmsg = h('span', { class: 'muted small' });
  const add = h('button', { class: 'btn primary sm', type: 'button', text: 'Add', disabled: !canEdit, onclick: async () => {
    const f = Number(factor.value);
    if (!date.value || !(f > 0)) { fmsg.textContent = 'Enter the date it takes effect and the factor, for example 0.67.'; return; }
    try { await Bd.addFactor({ effectiveFrom: date.value, factorBp: Math.round(f * 10000) }); await rerender(); } catch (e) { fmsg.textContent = e.message; }
  } });
  // the day before the next factor takes effect: when each factor stops
  const dayBefore = iso => { const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - 86400000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; };
  const factorRows = inputs.factors.map((f, i) => h('tr', {},
    h('td', { class: 'strong', text: (f.factorBp / 10000).toString() }),
    h('td', { text: fmtDay(f.effectiveFrom) + ', ' + f.effectiveFrom.slice(0, 4) }),
    h('td', { class: 'muted', text: i === 0 ? 'Current' : (d => fmtDay(d) + ', ' + d.slice(0, 4))(dayBefore(inputs.factors[i - 1].effectiveFrom)) })));
  const factorTable = h('div', { class: 'tblwrap' }, h('table', { class: 'dt', style: 'min-width:520px' },
    h('thead', {}, h('tr', {}, h('th', { text: 'MWIP factor' }), h('th', { text: 'Effective from' }), h('th', { text: 'Until' }))),
    h('tbody', {}, ...factorRows)));
  const factorFoot = canEdit
    ? h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: 'Old reports keep the factor they were built with. A past factor is never changed.' }), h('div', { class: 'acts' }, fmsg, factor, date, add))
    : null;
  cards.push(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'MWIP weighting factor' }), h('p', { text: 'Pursuits that are not contracted yet are counted at face value times this factor. It is effective-dated, so last year\'s reports never move when it changes. It is never shown on PIC pages.' })),
    factorTable, factorFoot));

  // ---- sectors ----
  cards.push(h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Market sectors' }), h('p', { text: 'Each project carries its sector from Vantagepoint. One sector can count in another until a date.' })),
    h('div', { class: 'sec-body' }, ...inputs.sectors.map(s => row(s.name, s.rollsInto ? `Counted in ${s.rollsInto} through ${fmtDay(s.rollsUntil)}, ${s.rollsUntil.slice(0, 4)}. From the next day it is its own sector.` : null, h('span', { class: 'muted', text: s.rollsInto ? `Rolls into ${s.rollsInto}` : 'Own sector' }))),
      inputs.overrides.length ? row('Sectors you assigned', 'For projects that had none in Vantagepoint. They apply to every later report.', h('span', { class: 'muted', text: inputs.overrides.map(o => `${o.wbs1} → ${o.sector}`).join(', ') })) : null)));

  // ---- the rules and the settings ----
  cards.push(settingsCard('Report rules and status labels', 'Fixed for every report so numbers can be compared month to month. The numbers below are settings; a report records the ones it was built with.', settings, ['bd.noSector', 'bd.onPacePct', 'bd.onTrackPct'], canEdit, rerender, ed => [
    row('Billing cutoff', 'Revenue billed through the cutoff counts as YTD.', h('span', { class: 'muted', text: 'Last day of the previous month' })),
    row('Revenue is shown', null, h('span', { class: 'muted', text: 'Net of consultants' })),
    row('Revenue with no market sector', 'Pick one answer. Keeping it in Unassigned shows it on its own row, as Vantagepoint does, so totals still tie and publishing is not held up.', ed.select('bd.noSector', [['keep', 'Keep it in an Unassigned row, like Vantagepoint'], ['ask', 'Stop and ask me before I publish'], ['other', 'Put it in Other and say so']])),
    row('On Track', 'YTD plus forecast plus MWIP reaches this share of the annual goal.', ed.num('bd.onTrackPct', { narrow: true }), h('span', { class: 'muted', text: '% of goal' })),
    row('On Pace', 'Otherwise, YTD billings are at least this share of pace, but need more planned revenue. Below it: Behind Pace.', ed.num('bd.onPacePct', { narrow: true }), h('span', { class: 'muted', text: '% of pace' })),
  ]));
  return cards;
}
