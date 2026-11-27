/* One project, opened from a PIC or PM dashboard (#/dashboard/pic/project/<WBS1>). Today: the fee burn, full width, with a
   few figures above it. MADE-UP SAMPLE DATA (burn-sample.js) until the Vantagepoint copy carries the real numbers; then the
   server must also check that the person is PIC or PM on this project (it already checks they have this dashboard). */
import { Dashboard } from '/shared/platform/index.js';
import { sampleProject, SAMPLE_MONTHS } from './burn-sample.js';
import * as BC from './burn-chart.js';

export async function renderDashboardProject(ctx, body, board, wbs1) {
  const { h, T, icon, actions, banner } = ctx;
  const data = await Dashboard.get(board); // refuses a dashboard the person does not have
  const back = h('a', { class: 'btn', href: '#/dashboard/' + board }, icon('arrow-left'), h('span', { text: data.label }));
  actions(body, back);
  const p = sampleProject(board, wbs1);
  if (!p) { body.append(banner('info', `${wbs1} is not one of the projects on your ${data.label}.`)); return; }

  const pct = (data.burn && data.burn.projectedSpendPct) || 85;
  let win = 'full';
  const calc = w => window.CompassDashboard.burn.burn([p], Object.assign({ window: w, projectedSpendPct: pct }, SAMPLE_MONTHS));

  const fig = (label, big, sub) => h('div', { class: 'dproj-fig' }, h('div', { class: 'dpk-l', text: label }), h('div', { class: 'dpk-b', text: big }), h('div', { class: 'dpk-s', text: sub }));
  const full = calc('full');
  const figs = h('div', { class: 'dproj-figs' },
    fig('Fee', BC.money(p.fee), `${BC.monthLabel(p.start)} to ${BC.monthLabel(p.end)}`),
    fig('Billed to date', BC.money(full.toDate.billed), `${Math.round(full.toDate.billed / p.fee * 100)}% of the fee`),
    fig('Spent to date', BC.money(full.toDate.spent), 'Cost with overhead'),
    fig('Projected spent at the end', BC.money(full.atEnd.spent), full.atEnd.spent > p.fee ? `${BC.money(full.atEnd.spent - p.fee)} more than the fee` : `${BC.money(p.fee - full.atEnd.spent)} under the fee`));

  const chartBox = h('div', { class: 'dproj-chart' });
  const legendBox = h('div'), says = h('p', { class: 'burn-says' });
  const sw = h('div');
  const card = h('section', { class: 'dp-in dproj-card', 'aria-label': 'Fee burn' },
    h('header', { class: 'dp-head' }, h('h2', { text: 'Fee burn' }), sw),
    chartBox, legendBox, says);
  body.append(
    h('p', { class: 'muted', style: 'margin:0', text: `${p.wbs1} ${p.name}. Sample data: the numbers are made up until they come from Vantagepoint.` }),
    figs, card);

  function draw() {
    const r = calc(win);
    sw.innerHTML = BC.windowSwitch(win);
    const px = Math.max(280, Math.floor(chartBox.clientWidth || 900));
    chartBox.innerHTML = BC.chart(r, { px, py: px < 600 ? 260 : 360 });
    legendBox.innerHTML = BC.legend(r);
    says.textContent = BC.sentence(r);
  }
  sw.addEventListener('click', e => { const b = e.target.closest('[data-burn-window]'); if (b) { win = b.dataset.burnWindow; draw(); } });
  let lastW = 0;
  new ResizeObserver(() => { const w = Math.floor(chartBox.clientWidth); if (w && w !== lastW) { lastW = w; draw(); } }).observe(chartBox);
  draw();
  T.hydrateIcons(body);
}
