/* Admin > Staffing: the settings behind Staffing projections. Built from the Admin shell's own card and row helpers (ctx), so it
   looks and saves the same way, and every change is a new effective-dated settings row with an audit entry.
   There is deliberately no screen for a project's own staffing mix (Josh, 2026-11-27): docs/SPEC-staffing.md. */
const perHour = c => Math.round(c / 100).toLocaleString('en-US');

export function staffingAdminCards(ctx, settings, inputs, people, canEdit, rerender) {
  const { h, settingsCard, row } = ctx;
  const cards = [];

  // ---- the mix and the targets ----
  cards.push(settingsCard('Staffing mix and utilization targets', 'The standard mix is each role\'s share of the hours on a typical project; it must add up to 100%. The utilization target is the share of a full month one person in the role bills.', settings, ['staffing.levels', 'staffing.hoursPerMonth'], canEdit, rerender, ed => {
    const levels = ed.draft['staffing.levels'];
    const sum = h('span', { class: 'st-mixsum' });
    const total = () => { const t = levels.reduce((a, l) => a + (Number.isInteger(l.mix) ? l.mix : 0), 0); sum.textContent = t + '%'; sum.className = 'st-mixsum' + (t === 100 ? '' : ' bad'); };
    const pctInput = (l, key, label) => {
      const el = h('input', { class: 'txt', type: 'text', inputmode: 'numeric', value: String(l[key]), disabled: !canEdit, 'aria-label': `${label} for ${l.label}` });
      el.addEventListener('input', () => { const t = el.value.trim(); l[key] = t === '' ? NaN : Number(t); total(); });
      return el;
    };
    const table = h('div', { class: 'tblwrap' }, h('table', { class: 'dt st-admin', style: 'min-width:560px' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Role' }), h('th', { class: 'r', text: 'Share of hours (%)' }), h('th', { class: 'r', text: 'Utilization target (%)' }))),
      h('tbody', {}, ...levels.map(l => h('tr', {}, h('td', { class: 'strong', text: l.label }), h('td', { class: 'r' }, pctInput(l, 'mix', 'Share of hours')), h('td', { class: 'r' }, pctInput(l, 'target', 'Utilization target')))),
        h('tr', { class: 'st-total' }, h('td', { class: 'strong', text: 'Total' }), h('td', { class: 'r' }, sum), h('td', {})))));
    total();
    return [
      table,
      row('Hours in a month', 'A full-time month. Hours one person bills = this times the role\'s utilization target.', ed.num('staffing.hoursPerMonth', { narrow: true }), h('span', { class: 'muted', text: 'hours' })),
    ];
  }, 'Takes effect the next time the page is opened. Earlier changes stay on file.'));

  if (inputs.available) {
    // ---- which category counts where ----
    cards.push(settingsCard('Which Vantagepoint categories count', 'Each billing labor category goes into one role, or is not counted (neither work nor people). A category with people in it and no place is flagged on the page, never dropped quietly.', settings, ['staffing.levels', 'staffing.untracked'], canEdit, rerender, ed => {
      const levels = ed.draft['staffing.levels'];
      const placeOf = code => { const l = levels.find(x => x.categories.includes(code)); return l ? l.id : ed.draft['staffing.untracked'].includes(code) ? 'untracked' : ''; };
      const move = (code, to) => {
        for (const l of levels) l.categories = l.categories.filter(c => c !== code);
        ed.draft['staffing.untracked'] = ed.draft['staffing.untracked'].filter(c => c !== code);
        if (to === 'untracked') ed.draft['staffing.untracked'].push(code);
        else if (to) levels.find(l => l.id === to).categories.push(code);
      };
      const cats = inputs.categories.slice().sort((a, b) => (b.staff > 0) - (a.staff > 0) || Number(a.code) - Number(b.code));
      return [h('div', { class: 'tblwrap' }, h('table', { class: 'dt st-admin', style: 'min-width:620px' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Code' }), h('th', { text: 'Category' }), h('th', { class: 'r', text: 'On staff' }), h('th', { text: 'Counts as' }))),
        h('tbody', {}, ...cats.map(c => {
          const sel = h('select', { class: 'txt', disabled: !canEdit, 'aria-label': `Where ${c.title} counts`, onchange: e => move(c.code, e.target.value) },
            ...levels.map(l => h('option', { value: l.id, text: l.label, selected: placeOf(c.code) === l.id })),
            h('option', { value: 'untracked', text: 'Not counted', selected: placeOf(c.code) === 'untracked' }),
            h('option', { value: '', text: 'No place yet', selected: placeOf(c.code) === '' }));
          return h('tr', {}, h('td', { class: 'muted', text: c.code }), h('td', { class: c.staff ? 'strong' : 'muted', text: c.title }), h('td', { class: 'r', text: String(c.staff) }), h('td', {}, sel));
        }))))];
    }));

    // ---- billing rates ----
    cards.push(settingsCard('Billing rates', `From Vantagepoint's "${inputs.rateTable}" table, the rate in effect today. Type a rate only to use a different one; leave it empty to follow Vantagepoint. A role's rate is the average of its categories, weighted by people on staff.`, settings, ['staffing.rateOverrides'], canEdit, rerender, ed => {
      const ov = ed.draft['staffing.rateOverrides'];
      const counted = new Set(settings['staffing.levels'].value.flatMap(l => l.categories));
      const cats = inputs.categories.filter(c => counted.has(c.code));
      return [h('div', { class: 'tblwrap' }, h('table', { class: 'dt st-admin', style: 'min-width:560px' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Category' }), h('th', { class: 'r', text: 'Vantagepoint ($/h)' }), h('th', { class: 'r', text: 'Use instead ($/h)' }))),
        h('tbody', {}, ...cats.map(c => {
          const el = h('input', { class: 'txt', type: 'text', inputmode: 'numeric', value: ov[c.code] === undefined ? '' : perHour(ov[c.code]), placeholder: '', disabled: !canEdit, 'aria-label': `Rate to use for ${c.title}` });
          el.addEventListener('input', () => { const t = el.value.replace(/[$,\s]/g, ''); if (t === '') delete ov[c.code]; else ov[c.code] = Math.round(Number(t) * 100); });
          return h('tr', {}, h('td', { class: 'strong', text: c.title }), h('td', { class: 'r', text: c.vpRate === null ? 'none' : perHour(c.vpRate) }), h('td', { class: 'r' }, el));
        }))))];
    }));
  }

  // ---- the months ----
  cards.push(settingsCard('Months shown', 'The page shows the months after this one. PMs plan the near months in detail and later ones thinly, so the later months are marked as less certain.', settings, ['staffing.monthsShown', 'staffing.firmMonths'], canEdit, rerender, ed => [
    row('Months shown', null, ed.num('staffing.monthsShown', { narrow: true }), h('span', { class: 'muted', text: 'months' })),
    row('Less certain after', 'Months after this many are shaded on the chart and greyed in the table.', ed.num('staffing.firmMonths', { narrow: true }), h('span', { class: 'muted', text: 'months' })),
  ]));

  // ---- neighborhood leaders ----
  cards.push(settingsCard('Neighborhood leaders', 'Principals and you always see Staffing projections. Pick the neighborhood leaders here (a principal or associate who leads a neighborhood); they see it too, whatever their role.', settings, ['staffing.leaders'], canEdit, rerender, ed => {
    const who = people.filter(p => p.active && p.role !== 'admin' && p.role !== 'pic');
    const picks = who.map(p => {
      const box = h('input', { type: 'checkbox', checked: ed.draft['staffing.leaders'].includes(p.id), disabled: !canEdit, onchange: () => {
        const l = ed.draft['staffing.leaders'];
        ed.draft['staffing.leaders'] = box.checked ? l.concat(p.id) : l.filter(x => x !== p.id);
      } });
      return h('label', { class: 'check' }, box, h('span', { text: p.name }), h('span', { class: 'muted small', text: window.CompassRules.ROLE_LABEL[p.role] }));
    });
    return [row('Leaders', who.length ? 'Everyone else who is active in People.' : 'Nobody else is active in People.', h('div', { class: 'preview-picks' }, ...picks))];
  }, 'Takes effect the next time the person opens a page.'));

  return cards;
}
