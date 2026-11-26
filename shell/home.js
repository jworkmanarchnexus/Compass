/* The Home page. Everything on it comes from the server already shaped for the signed-in role (server/home.js);
   this file only draws it. It shows only what exists: no BD, pipeline or firm-snapshot tiles until those have a source. */
import { fmtWeekdayLong, fmtDay, fmtDayWd, fmtDayYear, fmtWhen, plural } from '/shared/ui/format.js';
import { planChip } from '/modules/turnaround/ui/overview.js';

/* "September 2026 data." + "Oct 1 at 6:00 a.m." -> "September 2026 data. Last run Oct 1 at 6:00 a.m." (one period, never "a.m..") */
export const lastRun = (text, when) => `${text.replace(/\.$/, '')}. Last run ${when}${when.endsWith('.') ? '' : '.'}`;

const ORDER = { overdue: 0, no_plan: 1, update_due: 2, current: 3 };

/* Home's header: a greeting instead of a page title (the side bar already says where you are), a one-line summary
   of what the cards below hold, and tags for how fresh the data is. hour is the browser's local hour (0-23). */
export function greeting(name, hour) {
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return `Good ${part}, ${String(name || '').trim().split(/\s+/)[0]}`;
}

export function homeSummary(data) {
  const bits = [];
  if (data.attention) bits.push(data.attention.length ? `${plural(data.attention.length, 'thing')} need${data.attention.length === 1 ? 's' : ''} you` : 'Nothing needs you right now');
  if (data.checks) {
    const fix = data.checks.filter(c => c.status !== 'ok').length;
    bits.push(fix ? `${plural(fix, 'data check')} to look at` : 'All data checks pass');
  }
  if (data.yours && data.yours.runLabel) {
    const n = data.yours.projects.filter(p => p.plan.status !== 'current').length;
    bits.push(n ? `${n} of your projects ${n === 1 ? 'needs' : 'need'} a check-in` : 'Your projects are done for this round');
  }
  return bits.join(' · ');
}

export function homeHeader(ctx, data, me, hour) {
  const { h } = ctx;
  const summary = homeSummary(data);
  const tags = [];
  if (data.pull) {
    tags.push(h('span', { class: 'chip ' + (data.pull.current ? 'ok' : 'warn'), title: `Data as of ${fmtDayYear(data.pull.dataAsOf)} (built ${fmtWhen(data.pull.builtAt)})`, text: `Data through ${fmtDay(data.pull.dataAsOf)}` }));
    tags.push(h('span', { class: 'chip', text: `Period: ${data.pull.label}` }));
  }
  if (data.role === 'admin') tags.push(h('span', { class: 'chip blue', title: 'Nothing is visible to PICs until you publish it.', text: 'PICs see published runs only' }));
  return h('div', { class: 'home-hero' },
    h('div', { class: 'hello' },
      h('h1', { text: greeting(me.name, hour) }),
      h('p', { text: fmtWeekdayLong(data.today) + (summary ? ' · ' + summary : '') })),
    tags.length ? h('div', { class: 'hero-tags' }, ...tags) : null);
}

export function renderHome(ctx, body, data) {
  const { h } = ctx;
  const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' });
  if (data.attention) left.append(attention(ctx, data));
  if (data.yours) left.append(yours(ctx, data.yours));
  if (data.published && data.published.length) left.append(published(ctx, data.published));
  if (data.checks) right.append(checks(ctx, data.checks));
  if (data.next) right.append(next(ctx, data.next));
  const cols = [left, right].filter(c => c.childNodes.length);
  if (cols.length) body.append(h('div', { class: 'home-grid' + (cols.length === 1 ? ' one' : '') }, ...cols));
}

const card = ({ h }, title, aside, ...rows) => h('section', { class: 'sec' },
  h('div', { class: 'sec-head home-head' }, h('h2', { text: title }), aside ? h('span', { class: 'muted', text: aside }) : null), ...rows);

function attention(ctx, data) {
  const { h } = ctx;
  const items = data.attention;
  return card(ctx, 'Needs your attention', items.length ? plural(items.length, 'item') : '',
    ...(items.length ? items.map(i => h('div', { class: 'att' },
      h('span', { class: 'chip ' + ({ warn: 'warn', blue: 'blue', crit: 'crit' }[i.tone] || ''), text: i.badge }),
      h('div', { class: 'att-body' }, h('div', { class: 'strong', text: i.title }), h('div', { class: 'muted', text: i.createdAt ? i.text.replace('{createdAt}', fmtWhen(i.createdAt)) : i.text })),
      h('a', { class: 'btn' + (i.primary ? ' primary' : ''), href: i.href, text: i.action })))
      : [h('div', { class: 'empty-row', text: 'Nothing needs you right now.' })]));
}

function yours(ctx, y) {
  const { h } = ctx;
  const rows = y.projects.slice().sort((a, b) => ORDER[a.plan.status] - ORDER[b.plan.status]);
  return card(ctx, 'Your projects', y.runLabel ? `${y.runLabel} run` : '',
    ...(rows.length ? rows.map(p => h('div', { class: 'att' },
      planChip(ctx, p.plan), h('div', { class: 'att-body' }, h('div', { class: 'strong', text: p.name })),
      h('a', { class: 'btn', href: '#/turnaround/p/' + encodeURIComponent(p.wbs1), text: p.plan.status === 'current' ? 'Open project' : 'Check in' })))
      : [h('div', { class: 'empty-row', text: y.runLabel ? 'None of your projects are below break-even.' : 'Nothing has been published yet.' })]));
}

function published(ctx, list) {
  const { h } = ctx;
  return card(ctx, 'Recently published', '', ...list.map(r => h('div', { class: 'att' },
    h('span', { class: 'chip ok', text: 'Published' }),
    h('div', { class: 'att-body' }, h('div', { class: 'strong', text: r.label + (r.version > 1 ? `, version ${r.version}` : '') }), h('div', { class: 'muted', text: `Published ${fmtWhen(r.publishedAt)}${r.by ? ' by ' + r.by : ''}. ${r.text}` })),
    h('a', { href: r.href, text: 'View' }))));
}

function checks(ctx, list) {
  const { h } = ctx;
  return card(ctx, 'Data checks', '', h('div', { class: 'sec-body' }, ...list.map(c => h('div', { class: 'chk' },
    h('span', { class: 'chip ' + (c.status === 'ok' ? 'ok' : 'warn'), text: c.status === 'ok' ? 'OK' : 'Fix' }),
    h('div', {}, h('div', { class: 'strong' }, c.href ? h('a', { href: c.href, text: c.title }) : c.title), h('div', { class: 'muted small', text: c.createdAt ? lastRun(c.text, fmtWhen(c.createdAt)) : c.text }))))));
}

function next(ctx, list) {
  const { h } = ctx;
  return card(ctx, 'Next scheduled runs', '', h('div', { class: 'sec-body' }, ...list.map(n => h('div', { class: 'nx' },
    h('div', {}, h('div', { class: 'strong', text: n.title }), h('div', { class: 'muted small', text: n.text })),
    h('span', { class: 'muted', text: n.date ? fmtDayWd(n.date) : 'Daily' })))));
}
