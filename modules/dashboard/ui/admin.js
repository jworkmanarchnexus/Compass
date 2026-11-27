/* Admin > Dashboards: the settings behind the PIC and PM dashboards. Today one: how the fee burn turns planned hours into
   projected spend (modules/dashboard/logic/burn.js). */
export function dashboardAdminCards(ctx, settings, canEdit, rerender) {
  const { h, settingsCard, row } = ctx;
  return [
    settingsCard('Fee burn', 'The fee burn chart shows billed and spent as running totals. After the last closed month, spent is a projection from the project plan.', settings, ['dashboard.projectedSpendPct'], canEdit, rerender, ed => [
      row('Projected spend', 'Planned hours times each person\'s billing rate, times this percent. It never uses anyone\'s pay or cost rate, so nobody can work out a salary from a plan. Set it so a typical project\'s projection lines up with its actual spent (cost with overhead).',
        ed.num('dashboard.projectedSpendPct', { narrow: true }), h('span', { class: 'muted', text: '% of billing value' })),
    ]),
  ];
}
