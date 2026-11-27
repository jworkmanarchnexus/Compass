/* Admin > Dashboards: the settings behind the PIC and PM dashboards. Today one: how the fee burn turns planned hours into
   projected spend (modules/dashboard/logic/burn.js). */
export function dashboardAdminCards(ctx, settings, canEdit, rerender) {
  const { h, settingsCard, row } = ctx;
  return [
    settingsCard('Project status on the tabs', 'Each project on the Profit, Revenue forecast, Hours and Billing tabs carries one of three plain labels, from its year-to-date profit.', settings, ['dashboard.watchProfitPct', 'dashboard.endingSoonDays'], canEdit, rerender, ed => [
      row('Needs a look', 'Year-to-date profit is below zero. Always.', h('span', { class: 'muted', text: 'Below $0' })),
      row('Watch', 'Profit is $0 or more, but less than this share of what was billed this year. Above it: On track.', ed.num('dashboard.watchProfitPct', { narrow: true }), h('span', { class: 'muted', text: '% of billed' })),
      row('Ending soon', 'The chip that lists projects whose end date is this close, or already past.', ed.num('dashboard.endingSoonDays', { narrow: true }), h('span', { class: 'muted', text: 'days' })),
    ]),
    settingsCard('Fee burn', 'The fee burn chart shows billed and spent as running totals. After the last closed month, spent is a projection from the project plan.', settings, ['dashboard.projectedSpendPct'], canEdit, rerender, ed => [
      row('Projected spend', 'Planned hours times each person\'s billing rate, times this percent. It never uses anyone\'s pay or cost rate, so nobody can work out a salary from a plan. Set it so a typical project\'s projection lines up with its actual spent (cost with overhead).',
        ed.num('dashboard.projectedSpendPct', { narrow: true }), h('span', { class: 'muted', text: '% of billing value' })),
    ]),
  ];
}
