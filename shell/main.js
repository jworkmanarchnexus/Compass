/* The Compass shell: sign-in-as picker, side bar, hash routing (#/admin/people), theme and density, and the Admin pages.
   It reaches the server only through shared/platform. The server enforces who may do what; this file only hides controls. */
import * as platform from '/shared/platform/index.js';

import { renderHome, homeSubtitle } from '/shell/home.js';
import { renderOverview } from '/modules/turnaround/ui/overview.js';
import { renderPlan } from '/modules/turnaround/ui/plan.js';
import { renderCheckins } from '/modules/turnaround/ui/checkins.js';
import { remindersCards, patternsCards } from '/modules/turnaround/ui/admin.js';

const { configure, Session, Admin, Turnaround, Checkins, Home, ApiError } = platform;
const T = window.Toolbox;
const R = window.CompassRules;
const h = T.h;
configure({ pref: T.pref });

const root = document.getElementById('app');
const icon = (name, size) => h('span', { html: T.icon(name, size || 16) });
const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const displayChanged = () => window.dispatchEvent(new Event('compass:display'));

/* ---------- side bar. `phase` says when the page gets real content. ---------- */
const NAV = [
  { id: 'home', href: '#/', icon: 'house', label: 'Home' },
  { id: 'turnaround', area: 'turnaround', href: '#/turnaround', icon: 'target', label: 'Project Turnaround', blurb: 'Projects below break-even this year, and what is being done about each one.',
    sub: [{ id: 'checkins', area: 'checkins', href: '#/turnaround/checkins', icon: 'list', label: 'Check-in drafts', blurb: 'Reminder drafts for you to send from your own mailbox.' }] },
  { id: 'bd', area: 'bd', href: '#/bd', icon: 'table-2', label: 'BD report', phase: 5, blurb: 'Revenue against goal, by PIC and by market sector.' },
  { id: 'pipeline', area: 'pipeline', href: '#/pipeline', icon: 'eye', label: 'Pipeline watch', phase: 5, blurb: 'Weekly snapshots of MWIP and forecast, with alerts.' },
  { id: 'admin', area: 'admin', href: '#/admin', icon: 'sliders-horizontal', label: 'Admin', blurb: 'Settings, people, report runs and the audit log.' },
];
const flatNav = NAV.flatMap(n => [n].concat(n.sub || []));

function mount(...nodes) { root.textContent = ''; root.append(...nodes); T.hydrateIcons(root); }

/* ---------- sign in as ---------- */
async function showSignIn(message) {
  const users = await Session.devUsers();
  const cards = users.map(u => h('button', {
    class: 'rcard', type: 'button',
    onclick: async () => { await Session.signInAs(u.id); location.hash = '#/'; location.reload(); },
  },
  h('span', { class: 'pn', text: R.ROLE_LABEL[u.role] }),
  h('span', { class: 'pt', text: u.name })));
  mount(h('main', { class: 'signin' },
    h('img', { class: 'side-logo', alt: 'Arch Nexus', src: '/shared/design-system/arch-nexus-logo.png' }),
    h('h1', { text: 'Compass' }),
    message ? h('div', { class: 'banner warn', style: 'margin-top:16px' }, h('span', { class: 'bmsg' }, icon('triangle-alert'), h('span', { text: message }))) : null,
    h('p', { class: 'hint', text: 'Choose who to sign in as. These are made-up test people; the real Compass will use your network username and password.' }),
    h('div', { class: 'recent' }, ...cards),
    h('p', { class: 'dev-note', text: 'Local test mode: this computer only.' })));
}

/* ---------- frame ---------- */
function navItem(n, on, sub, badge) {
  return h('a', { class: 'nav-item' + (sub ? ' nav-sub' : '') + (on ? ' on' : ''), href: n.href, 'aria-current': on ? 'page' : null }, icon(n.icon, sub ? 16 : 18), h('span', { text: n.label }),
    badge === undefined ? null : h('span', { class: 'cnt warn nav-cnt', 'data-badge': n.id, hidden: badge === 0, text: String(badge) }));
}

/* routeId: which nav item is highlighted. Returns the page body to fill. */
function frame(routeId, crumbs, titleText, sub) {
  const me = Session.me();
  const themeBtn = h('button', { class: 'ib', type: 'button', 'aria-label': 'Theme' });
  const collapseBtn = h('button', { class: 'ib side-collapse', type: 'button' });
  const densityBtn = h('button', { class: 'ib', type: 'button', title: 'Compact rows', 'aria-label': 'Compact rows', 'aria-pressed': 'false' }, icon('rows-3'));
  themeBtn.addEventListener('click', () => { T.cycleTheme(themeBtn); displayChanged(); });
  collapseBtn.addEventListener('click', () => { T.toggleCollapse(collapseBtn); displayChanged(); });
  densityBtn.addEventListener('click', () => { T.pref('density', T.pref('density') === 'compact' ? 'comfortable' : 'compact'); T.applyDensity(densityBtn); displayChanged(); });

  const nav = [h('div', { class: 'navh', text: 'Modules' })];
  for (const n of NAV) {
    if (n.area && !me.areas[n.area]) continue;
    nav.push(navItem(n, routeId === n.id));
    for (const s of n.sub || []) if (me.areas[s.area]) nav.push(navItem(s, routeId === s.id, true, s.id === 'checkins' && me.badges ? me.badges.checkins : undefined));
  }
  const side = h('aside', { class: 'side', 'aria-label': 'Compass navigation' },
    h('div', { class: 'side-brand' },
      h('img', { class: 'side-logo', alt: 'Arch Nexus', src: '/shared/design-system/arch-nexus-logo.png' }),
      h('div', { class: 'side-product' }, h('strong', { text: 'Compass' }), h('span', { text: 'Arch Nexus' })),
      h('span', { class: 'chip warn side-tag', title: 'Everything here is made-up test data', text: 'Sample data' })),
    h('nav', { class: 'side-nav', 'aria-label': 'Modules' }, ...nav),
    h('div', { class: 'side-foot' },
      h('div', { class: 'side-user', title: `${me.name} (${R.ROLE_LABEL[me.role]})` }, h('span', { class: 'avatar', text: initials(me.name) }), h('span', { class: 'nm', text: me.name })),
      h('button', { class: 'ib', type: 'button', title: 'Switch user', 'aria-label': 'Switch user', onclick: () => { Session.signOut(); location.hash = '#/'; location.reload(); } }, icon('arrow-right-left')),
      densityBtn, themeBtn, collapseBtn));
  const scrim = h('div', { class: 'side-scrim', onclick: () => document.body.classList.remove('side-open') });
  const mtop = h('div', { class: 'mtop' },
    h('button', { class: 'ib', type: 'button', 'aria-label': 'Open the menu', onclick: () => document.body.classList.add('side-open') }, icon('menu')),
    h('strong', { text: 'Compass' }));
  const body = h('div', { class: 'pbody stack' });
  const page = h('div', { class: 'page' },
    h('div', { class: 'phead' },
      h('div', { class: 'crumbs' }, ...crumbs),
      titleText ? h('div', { class: 'ptitle' }, h('h1', { class: 'brand', text: titleText }), sub ? h('span', { class: 'sub', text: sub }) : null) : null),
    body);
  mount(h('div', { class: 'shell' }, side, h('div', { class: 'mainwrap' }, mtop, page)), scrim);
  T.applyTheme(themeBtn); T.applyCollapse(collapseBtn); T.applyDensity(densityBtn);
  document.body.classList.remove('side-open');
  return body;
}
const crumb = (label, href) => href ? h('a', { href, text: label }) : h('span', { text: label });
const sep = () => icon('chevron-right', 14);
const banner = (iconName, text, kind) => h('div', { class: 'banner' + (kind ? ' ' + kind : '') }, h('span', { class: 'bmsg' }, icon(iconName), h('span', { text })));

/* ---------- pages ---------- */
async function pageHome() {
  const me = Session.me();
  const data = await Home.get();
  const body = frame('home', [crumb('Compass'), sep(), crumb('Home')], 'Home', homeSubtitle(data));
  renderHome(ctx, body, data);
  // a small "your pages" list for roles whose Home has little else on it
  if (me.role !== 'admin' && me.role !== 'sysadmin') {
    const mine = flatNav.filter(n => n.area && me.areas[n.area]);
    body.append(h('div', { class: 'section-h' }, h('h2', { text: 'Your pages' }), h('span', { class: 'muted', text: R.ROLE_LABEL[me.role] })),
      h('div', { class: 'recent' }, ...mine.map(n => h('a', { class: 'rcard', href: n.href },
        h('span', { class: 'pn', text: n.phase ? `Arrives in phase ${n.phase}` : 'Ready' }), h('span', { class: 'pt', text: n.label }), h('span', { class: 'pm', text: n.blurb })))));
  }
  T.hydrateIcons(body);
}

function pagePlaceholder(n) {
  const crumbs = [crumb('Compass', '#/'), sep(), crumb(n.label)];
  const body = frame(n.id, crumbs, n.label);
  body.append(banner('info', `${n.label} arrives in phase ${n.phase}. ${n.blurb}`));
}

async function pageTurnaround() {
  const me = Session.me();
  const body = frame('turnaround', [crumb('Compass', '#/'), sep(), crumb('Project Turnaround')], 'Project Turnaround', 'Projects below break-even this year, and what is being done about each one.');
  const data = await Turnaround.current();
  if (!data.run) {
    body.append(h('div', { class: 'empty-note', text: me.role === 'admin' ? 'No run has been published yet. Build one in Admin > Report runs.' : 'Nothing has been published yet. The first monthly run will show up here.' }));
    return;
  }
  body.append(h('p', { class: 'muted', style: 'margin:0', text: `${data.run.label} run, published ${fmtTime(data.run.publishedAt)}. Plan status is as of today.` }));
  renderOverview(ctx, body, data);
}

async function pageCheckins() {
  const body = frame('checkins', [crumb('Compass', '#/'), sep(), crumb('Project Turnaround', '#/turnaround'), sep(), crumb('Check-in drafts')], 'Check-in drafts', 'Short drafts for PICs who are overdue or have no plan. Nothing sends itself. You read each one, change it if you like, and send it from your own mailbox.');
  await renderCheckins(ctx, body);
}

async function pagePlan(wbs1, cycle) {
  const body = frame('turnaround', [crumb('Compass', '#/'), sep(), crumb('Project Turnaround', '#/turnaround'), sep(), crumb(wbs1)], null);
  try { await renderPlan(ctx, body, wbs1, cycle); } catch (e) {
    body.append(e.status === 404 ? h('div', { class: 'empty-note', text: 'That project does not exist.' }) : banner('circle-alert', e.message, 'err'));
  }
}

function pageNoAccess() {
  const body = frame('', [crumb('Compass', '#/')], 'No access');
  body.append(h('div', { class: 'empty-note', text: 'You do not have access to this page. If you think you should, ask the Admin.' }));
}

/* ---- Admin ---- */
const TAB_LABEL = { turnaround: 'Project Turnaround', reminders: 'Reminders and standing', bd: 'BD reports', pipeline: 'Pipeline alerts', people: 'People', runs: 'Report runs', patterns: 'Commitment patterns', audit: 'Audit log' };
const TAB_PHASE = { bd: 5, pipeline: 5 };
const SETTING_LABEL = {
  'run.day': 'Monthly run day', 'run.time': 'Monthly run time', 'run.emailAdmin': 'Email when the draft is ready', 'run.showOnHome': 'Show the draft on Home',
  'run.createCheckinDrafts': 'Create check-in drafts', 'include.status': 'Project status included',
  'include.ytdProfitBelow': 'YTD profit is below', 'include.ignoreBilledUnder': 'Ignore projects billed under', 'include.noPic': 'Projects with no PIC',
  'due.newProjectDays': 'Days to a first plan', 'due.afterEntryDays': 'Days to the next update', 'due.graceUntil': 'January grace period ends', 'due.soonDays': 'Update-due window', 'due.missedAfterDays': 'Days until a commitment is recorded as missed', 'ladder.reminder1Days': 'Reminder 1 day', 'ladder.reminder2Days': 'Reminder 2 day', 'ladder.escalateDays': 'Escalate day', 'drafts.emailAdmin': 'Email when drafts are waiting', 'drafts.skipIfEntryDays': 'Skip a PIC who just added an entry', 'drafts.skipIfSentDays': 'Skip a PIC who was just sent a reminder', 'standing.goodOnTime': 'Good standing: on time', 'standing.goodKept': 'Good standing: kept', 'standing.escalatedOnTime': 'Escalated below: on time', 'standing.escalatedKept': 'Escalated below: kept', 'standing.minSample': 'Items needed before a measure counts', 'visibility.picRecords': 'Who sees PIC records', 'access': 'What narrower roles can see',
};

const fmtTime = ms => {
  const d = new Date(ms);
  return d.toLocaleString('en-US', Object.assign({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }));
};
const fmtClock = v => { const [hh, mm] = v.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'a.m.' : 'p.m.'}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const showValue = v => typeof v === 'boolean' ? (v ? 'on' : 'off') : (v && typeof v === 'object') ? JSON.stringify(v) : String(v);

async function pageAdmin(tab) {
  const me = Session.me();
  const visible = R.ADMIN_TABS.filter(t => me.adminTabs[t]);
  if (!tab || !me.adminTabs[tab]) tab = visible[0];
  const canEdit = me.adminTabs[tab] === 'edit';
  const body = frame('admin', [crumb('Compass', '#/'), sep(), crumb('Admin')], 'Admin', 'Settings apply to the next run');
  body.append(
    h('div', { class: 'who' }, h('span', { class: 'lbl', text: 'Who sees this' }), h('span', { class: 'chip blue', text: 'Admin edit' }), h('span', { class: 'chip', text: 'System admin view' }), h('span', { class: 'chip out', text: 'Everyone else no access' })),
    h('div', { class: 'tabs' }, h('div', { class: 'seg wrap', role: 'tablist', 'aria-label': 'Admin sections' },
      ...visible.map(t => h('button', { type: 'button', role: 'tab', 'aria-pressed': String(t === tab), 'aria-selected': String(t === tab), text: TAB_LABEL[t], onclick: () => { location.hash = '#/admin/' + t; } })))));
  const slot = h('div', { class: 'stack' });
  body.append(slot);
  const rerender = () => renderTab(tab, slot, canEdit, rerender, body);
  await rerender();
}

async function renderTab(tab, slot, canEdit, rerender, body) {
  const fail = e => { slot.textContent = ''; slot.append(banner('circle-alert', e.message || 'Something went wrong. Nothing was changed.', 'err')); };
  try {
    if (tab === 'turnaround') {
      const s = await Admin.settings();
      slot.textContent = '';
      slot.append(...turnaroundCards(s, canEdit, rerender));
    } else if (tab === 'people') {
      const [people, s] = await Promise.all([Admin.people(), Admin.settings()]);
      slot.textContent = '';
      slot.append(peopleCard(people, canEdit, rerender, e => { fail(e); }), accessCard(s, canEdit, rerender), rolesCard());
    } else if (tab === 'reminders') {
      const s = await Admin.settings();
      slot.textContent = '';
      slot.append(...remindersCards(ctx, s, canEdit, rerender));
    } else if (tab === 'patterns') {
      const draw = async year => { const d = await Checkins.patterns(year); slot.textContent = ''; slot.append(...patternsCards(ctx, d, draw)); T.hydrateIcons(slot); };
      await draw();
    } else if (tab === 'runs') {
      const runs = await Admin.runs();
      slot.textContent = '';
      slot.append(runsCard(runs, canEdit, rerender, fail), h('section', { class: 'sec' },
        h('div', { class: 'sec-head' }, h('h2', { text: 'If a published run is wrong' })),
        h('div', { class: 'sec-body' }, h('div', { class: 'stack', style: 'padding:12px 0;max-width:84ch' },
          h('p', {}, 'The only way to change a published run is to archive it and build a new version. The system makes you give a reason and type ', h('b', { text: 'RERUN' }), ' first, because PICs and Finance have already seen it. The archived version stays on file, clearly marked, so nobody wonders why a number moved.'),
          h('p', { class: 'muted', text: 'Archiving a Project Turnaround run does not touch any plan logs. Those are never edited or deleted.' })))));
    } else if (tab === 'audit') {
      slot.textContent = '';
      slot.append(auditCard(await Admin.audit(200)));
    } else {
      slot.textContent = '';
      slot.append(banner('info', `${TAB_LABEL[tab]} arrives in phase ${TAB_PHASE[tab]}.`));
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return boot('Your sign-in is no longer valid. Choose who to sign in as.');
    fail(e);
  }
  T.hydrateIcons(slot);
}

/* ---- settings cards ----
   A card edits a draft copy of the settings it shows. Save sends only what changed; the server validates again and records
   who changed what in the audit log. */
function card(titleText, sub, rows, { canEdit, onSave, onDiscard, footNote }) {
  const msg = h('span', { class: 'saved', role: 'status' });
  const save = h('button', { class: 'btn primary', type: 'button', text: 'Save changes' });
  save.addEventListener('click', async () => { msg.textContent = ''; msg.className = 'saved'; const out = await onSave(); if (out) { msg.textContent = out.error || out.ok; msg.className = out.error ? 'note err' : 'saved'; } });
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: titleText }), sub ? h('p', { text: sub }) : null),
    h('div', { class: 'sec-body' }, ...rows),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: footNote || 'Changes apply to the next run. Published runs never change.' }),
      canEdit ? h('div', { class: 'acts' }, msg, h('button', { class: 'btn quiet', type: 'button', text: 'Discard', onclick: onDiscard }), save) : h('span', { class: 'chip', text: 'View only' })));
}
const row = (label, help, ...controls) => h('div', { class: 'set-row' },
  h('div', { class: 'what' }, h('div', { class: 'lab', text: label }), help ? h('div', { class: 'help', text: help }) : null),
  h('div', { class: 'ctl' }, ...controls));

function makeEditor(settings, keys, canEdit) {
  const draft = Object.fromEntries(keys.map(k => [k, JSON.parse(JSON.stringify(settings[k].value))]));
  let n = 0;
  const id = () => 'f' + (++n) + Math.random().toString(36).slice(2, 6);
  const ed = {
    draft,
    select(key, options) {
      const el = h('select', { class: 'txt', disabled: !canEdit, onchange: () => { draft[key] = el.value; } },
        ...options.map(([v, l]) => h('option', { value: v, text: l, selected: v === draft[key] })));
      if (!options.some(([v]) => v === draft[key])) el.append(h('option', { value: draft[key], text: String(draft[key]), selected: true }));
      return el;
    },
    time(key) {
      const opts = [];
      for (let m = 5 * 60; m <= 9 * 60; m += 30) { const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; opts.push([v, fmtClock(v)]); }
      if (!opts.some(([v]) => v === draft[key])) opts.push([draft[key], fmtClock(draft[key])]);
      return ed.select(key, opts);
    },
    num(key, { money, narrow } = {}) {
      const el = h('input', { class: 'txt' + (narrow ? ' narrow' : ''), type: 'text', inputmode: 'numeric', disabled: !canEdit, 'aria-label': SETTING_LABEL[key], value: money ? fmtMoney(draft[key]) : String(draft[key]) });
      el.addEventListener('input', () => { const t = el.value.replace(/[$,\s]/g, ''); draft[key] = t === '' || t === '-' ? NaN : Number(t); });
      return el;
    },
    check(key, text, flag) {
      const get = () => flag ? draft[key][flag] : draft[key];
      const el = h('input', { type: 'checkbox', id: id(), checked: get(), disabled: !canEdit, onchange: () => { if (flag) draft[key][flag] = el.checked; else draft[key] = el.checked; } });
      return h('label', { class: 'check' }, el, h('span', { text }));
    },
    monthDay(key) {
      const [mm, dd] = draft[key].split('-').map(Number);
      const set = () => { draft[key] = `${String(month.value).padStart(2, '0')}-${String(day.value).padStart(2, '0')}`; };
      const month = h('select', { class: 'txt', style: 'width:90px', disabled: !canEdit, 'aria-label': 'Month', onchange: set }, ...MONTHS.map((m, i) => h('option', { value: String(i + 1), text: m, selected: i + 1 === mm })));
      const day = h('select', { class: 'txt', style: 'width:70px', disabled: !canEdit, 'aria-label': 'Day', onchange: set }, ...Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1), text: String(i + 1), selected: i + 1 === dd })));
      return h('span', { class: 'ctl', style: 'flex:none' }, month, day);
    },
    /* what changed, or an error message */
    diff(settingsNow) {
      const changes = {};
      for (const k of keys) {
        if (!R.isValid(k, draft[k])) return { error: `Check the value for "${SETTING_LABEL[k]}". It is not allowed.` };
        if (JSON.stringify(draft[k]) !== JSON.stringify(settingsNow[k].value)) changes[k] = draft[k];
      }
      return { changes };
    },
  };
  return ed;
}
const fmtMoney = v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');

function settingsCard(titleText, sub, settings, keys, canEdit, rerender, build, footNote) {
  const ed = makeEditor(settings, keys, canEdit);
  return card(titleText, sub, build(ed), {
    canEdit, footNote, onDiscard: rerender,
    async onSave() {
      const d = ed.diff(settings);
      if (d.error) return { error: d.error };
      if (!Object.keys(d.changes).length) return { ok: 'Nothing changed.' };
      try { await Admin.saveSettings(d.changes); } catch (e) { return { error: e.message }; }
      await rerender();
    },
  });
}

function turnaroundCards(s, canEdit, rerender) {
  return [
    settingsCard('Monthly run', 'When the system builds the draft and who hears about it.', s, ['run.day', 'run.time', 'run.emailAdmin', 'run.showOnHome', 'run.createCheckinDrafts'], canEdit, rerender, ed => [
      row('Run day', 'It pulls from Vantagepoint, builds the draft and stops. Nothing is visible to PICs. The schedule itself is set up on the server by Kent; these two boxes record what it should be.', ed.select('run.day', [['first-business-day', 'First business day of the month']]), h('span', { text: 'at' }), ed.time('run.time')),
      row('When the draft is ready', null, ed.check('run.emailAdmin', 'Email Josh that the draft is ready'), ed.check('run.showOnHome', 'Show it in "Needs your attention" on Home')),
      row('After you publish', 'Reminders are drafts for Josh to send. The system never emails a PIC; the only automatic email goes to you.', ed.check('run.createCheckinDrafts', 'Create check-in drafts for overdue and missing plans')),
    ]),
    settingsCard('Which projects are included', 'The rule that decides who lands on the Project Turnaround page.', s, ['include.status', 'include.ytdProfitBelow', 'include.ignoreBilledUnder', 'include.noPic'], canEdit, rerender, ed => [
      row('Project status', 'Status comes from Vantagepoint. Inactive projects are left out because nobody can fix them.', ed.select('include.status', [['active', 'Active only']])),
      row('YTD profit is below', 'Year to date, in dollars.', ed.num('include.ytdProfitBelow', { money: true, narrow: true })),
      row('Ignore projects billed under', 'Leave at $0 to include everything. Raise it to hide tiny jobs.', ed.num('include.ignoreBilledUnder', { money: true, narrow: true })),
      row('Projects with no PIC', 'Projects whose Vantagepoint record has no principal in charge.', ed.select('include.noPic', [['leave-out-warn', 'Leave out and warn me on Home'], ['unassigned', 'Show them as "Unassigned"']])),
    ]),
    settingsCard('Plan due dates', 'The dates the accountability ladder counts from.', s, ['due.newProjectDays', 'due.afterEntryDays', 'due.soonDays', 'due.missedAfterDays', 'due.graceUntil'], canEdit, rerender, ed => [
      row('A new turnaround project needs a plan within', null, ed.num('due.newProjectDays', { narrow: true }), h('span', { class: 'muted', text: 'days of first appearing' })),
      row('After any entry, the next update is due in', 'Every update, explanation or commitment resets the clock for that project.', ed.num('due.afterEntryDays', { narrow: true }), h('span', { class: 'muted', text: 'days' })),
      row('Show "Update due" when the next update is within', 'The yellow label on a plan. Past the date, it turns to Overdue.', ed.num('due.soonDays', { narrow: true }), h('span', { class: 'muted', text: 'days' })),
      row('Record a commitment as missed', 'When its date has passed by this many days and nobody pressed Done or moved the date. The system writes it in the log.', ed.num('due.missedAfterDays', { narrow: true }), h('span', { class: 'muted', text: 'days after its date' })),
      row('January grace period', 'On January 1 every project starts clean. Plans opened last year stay readable.', ed.monthDay('due.graceUntil'), h('span', { class: 'muted', text: 'no plans are due until this date each year' })),
    ]),
  ];
}

function accessCard(s, canEdit, rerender) {
  return settingsCard('What narrower roles can see', 'Not everything in the spec is settled. These start at the safest answer; turn one on to widen it.', s, ['access'], canEdit, rerender, ed => [
    row('Marketing director', 'The decided rule is BD report and Pipeline watch. The mockup also mentions Project Turnaround.', ed.check('access', 'Can also see Project Turnaround', 'marketingTurnaround')),
    row('PICs', 'PICs always see Project Turnaround. BD report and Pipeline watch are off until you decide.', ed.check('access', 'Can see the BD report', 'picBd'), ed.check('access', 'Can see Pipeline watch', 'picPipeline')),
  ], 'Takes effect the next time the person opens a page.');
}

function peopleCard(people, canEdit, rerender, onError) {
  const change = async (id, c) => { try { await Admin.changePerson(id, c); await rerender(); } catch (e) { onError(e); } };
  const trs = people.map(p => h('tr', {},
    h('td', { class: 'strong', text: p.name }),
    h('td', { class: 'muted', text: p.email || p.username }),
    h('td', {}, canEdit
      ? h('select', { class: 'txt', 'aria-label': 'Role for ' + p.name, onchange: ev => change(p.id, { role: ev.target.value }) }, ...R.ROLES.map(r => h('option', { value: r, text: R.ROLE_LABEL[r], selected: r === p.role })))
      : h('span', { text: R.ROLE_LABEL[p.role] })),
    h('td', {}, canEdit
      ? h('input', { class: 'txt', type: 'text', maxlength: '40', value: p.draftName, 'aria-label': 'Name used in drafts for ' + p.name, onchange: ev => change(p.id, { draftName: ev.target.value }) })
      : h('span', { text: p.draftName })),
    h('td', { class: 'nowrap' }, h('span', { class: 'chip ' + (p.active ? 'ok' : 'out'), text: p.active ? 'Active' : 'Inactive' }),
      canEdit ? h('button', { class: 'btn quiet sm', type: 'button', style: 'margin-left:8px', text: p.active ? 'Deactivate' : 'Reactivate', onclick: () => change(p.id, { active: !p.active }) }) : null),
    h('td', { class: 'r', text: p.activeProjects === null ? '-' : String(p.activeProjects) })));
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'People and roles' }), h('p', { text: 'Logins come from the company sign-in. Roles decide who can edit and who can only look. People who leave keep their history.' })),
    h('div', { class: 'tblwrap' }, h('table', { class: 'dt', style: 'min-width:1040px' },
      h('thead', {}, h('tr', {}, ...['Name', 'Login', 'Role', 'Name used in drafts', 'Status'].map(x => h('th', { text: x })), h('th', { class: 'r', text: 'Active projects as PIC' }))),
      h('tbody', {}, ...trs))));
}

function rolesCard() {
  const rows = [
    ['Admin', 'Runs and publishes reports, edits every setting, adds admin notes. Cannot write in a PIC\'s plan voice.'],
    ['PIC', 'Writes entries on projects they lead. Reads everyone else\'s.'],
    ['Finance and Marketing director', 'View only. Read what they have been given. Marketing director sees BD report and Pipeline watch.'],
    ['System admin', 'Keeps the site running. Reads settings, people, report runs and the audit log. Never sees what PICs promised.'],
  ];
  return h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Roles' })),
    h('div', { class: 'sec-body' }, ...rows.map(([a, b]) => row(a, null, h('span', { class: 'muted', text: b })))));
}

/* ---- report runs ---- */
const STATUS_CHIP = { draft: ['warn', 'Draft'], published: ['ok', 'Published, locked'], archived: ['out', 'Archived'] };
const statusChip = s => h('span', { class: 'chip ' + STATUS_CHIP[s][0], text: STATUS_CHIP[s][1] });
const KIND_LABEL = { turnaround: 'Project Turnaround', bd: 'BD report' };
const fmtCents = c => (c < 0 ? '-$' : '$') + Math.abs(Math.round(c / 100)).toLocaleString('en-US'); // whole dollars; the minus sign carries the meaning, not only the colour
const fmtPct = (profit, billed) => billed ? (profit < 0 ? '-' : '') + Math.abs(100 * profit / billed).toFixed(1) + '%' : '-';

/* the last 12 closed months, newest first, for the "Build a run" picker */
function closedPeriods() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let p = window.CompassTurnaround.lastClosedPeriod(today);
  const out = [];
  for (let i = 0; i < 12; i++) { out.push(p); p = p % 100 === 1 ? (Math.floor(p / 100) - 1) * 100 + 12 : p - 1; }
  return out;
}

function runsCard(runs, canEdit, onBuilt, onError) {
  const live = new Set(runs.filter(r => r.status !== 'archived').map(r => r.period));
  const periods = closedPeriods();
  const sel = h('select', { class: 'txt', style: 'width:200px', 'aria-label': 'Month to build' },
    ...periods.map(p => h('option', { value: String(p), text: window.CompassTurnaround.periodLabel(p) + (live.has(p) ? ' (already built)' : ''), disabled: live.has(p) })));
  const first = periods.find(p => !live.has(p));
  if (first) sel.value = String(first);
  const build = h('button', { class: 'btn primary', type: 'button', text: 'Build a run', disabled: !first, onclick: async () => {
    try { const r = await Admin.buildRun(Number(sel.value)); location.hash = '#/admin/runs/' + r.run.id; } catch (e) { onError(e); }
  } });
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Report runs' }), h('p', { text: 'Every run the system has built. A published run is locked.' })),
    canEdit ? h('div', { class: 'set-row', style: 'padding:12px 20px;align-items:center' },
      h('div', { class: 'what' }, h('div', { class: 'lab', text: 'Build a run now' }), h('div', { class: 'help', text: 'The scheduled job does this on the first business day. Use this to build one by hand. It builds a draft only; nothing is visible to PICs.' })),
      h('div', { class: 'ctl' }, sel, build)) : null,
    runs.length ? h('div', { class: 'tblwrap' }, h('table', { class: 'dt' },
      h('thead', {}, h('tr', {}, ...['Report', 'Period', 'Version', 'Status', 'Projects', 'Created', 'Published', ''].map(x => h('th', { text: x })))),
      h('tbody', {}, ...runs.map(r => h('tr', {},
        h('td', { class: 'strong', text: KIND_LABEL[r.kind] || r.kind }), h('td', { text: r.label }), h('td', { text: 'v' + r.version }), h('td', {}, statusChip(r.status)),
        h('td', { class: 'r', text: String(r.projectCount) }), h('td', { class: 'muted', text: fmtTime(r.createdAt) }),
        h('td', { class: 'muted', text: r.publishedAt ? `${fmtTime(r.publishedAt)}${r.publishedByName ? ' by ' + r.publishedByName.split(' ')[0] : ''}` : '-' }),
        h('td', {}, r.status === 'archived' ? h('span', { class: 'muted', text: 'Reason: ' + r.archiveReason }) : canEdit ? h('a', { href: '#/admin/runs/' + r.id, text: r.status === 'draft' ? 'Review' : 'View' }) : null))))))
      : h('div', { class: 'empty-row', text: 'No runs yet.' }));
}

/* one run: review it exactly as the page will look, then publish, rebuild, or archive and rerun */
async function pageRun(id) {
  const me = Session.me();
  if (me.adminTabs.runs !== 'edit') return pageNoAccess();
  let data;
  try { data = await Admin.run(id); } catch (e) {
    const body = frame('admin', [crumb('Compass', '#/'), sep(), crumb('Admin', '#/admin/runs'), sep(), crumb('Report runs')], 'Report run');
    body.append(banner('circle-alert', e.status === 404 ? 'That run does not exist.' : e.message, 'err'));
    return;
  }
  const { run, warnings } = data;
  const body = frame('admin', [crumb('Compass', '#/'), sep(), crumb('Admin', '#/admin/runs'), sep(), crumb('Report runs', '#/admin/runs'), sep(), crumb(`${run.label}, version ${run.version}`)],
    KIND_LABEL[run.kind], `${run.label}, version ${run.version}`);
  const slot = h('div', { class: 'stack' });
  const reload = () => { body.textContent = ''; return pageRun(id); };
  const act = async (fn) => { try { const r = await fn(); if (r && r.run && r.run.id !== id) location.hash = '#/admin/runs/' + r.run.id; else { slot.textContent = ''; await pageRun(id); } } catch (e) { slot.prepend(banner('circle-alert', e.message, 'err')); } };

  const note = run.status === 'draft'
    ? `Draft. PICs still see the previous published run until you publish. A published run is locked.`
    : run.status === 'published'
      ? `Published ${fmtTime(run.publishedAt)}. This run is locked: it can never be edited. If a number is wrong, archive it and build a new version.`
      : `Archived ${fmtTime(run.archivedAt)}. Reason: ${run.archiveReason}`;
  const buttons = [];
  if (run.status === 'draft') {
    buttons.push(h('button', { class: 'btn', type: 'button', text: 'Rebuild draft', onclick: () => act(() => Admin.rebuildRun(id)) }));
    buttons.push(h('button', { class: 'btn primary', type: 'button', text: 'Publish for viewing', onclick: () => act(() => Admin.publishRun(id)) }));
  } else if (run.status === 'published') {
    buttons.push(h('button', { class: 'btn danger', type: 'button', text: 'Archive and rerun…', onclick: () => { slot.prepend(archivePanel(run, act)); T.hydrateIcons(slot); } }));
  }
  body.append(h('div', { class: 'banner' + (run.status === 'draft' ? ' warn' : '') }, h('span', { class: 'bmsg' }, icon(run.status === 'draft' ? 'info' : run.status === 'published' ? 'lock' : 'archive'), h('span', { text: note }))),
    ...(buttons.length ? [h('div', { class: 'run-acts' }, ...buttons)] : []), slot);

  if (warnings.length) {
    const label = { cant_evaluate: 'Could not be evaluated', no_pic: 'No PIC' };
    slot.append(h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('h2', { text: `Warnings (${warnings.length})` }), h('p', { text: 'Left off the run, with the reason. Fix them in Vantagepoint; the next run picks them up.' })),
      h('div', { class: 'tblwrap' }, h('table', { class: 'dt' },
        h('thead', {}, h('tr', {}, ...['Project', 'Problem', 'Detail'].map(x => h('th', { text: x })), h('th', { class: 'r', text: 'YTD billed' }))),
        h('tbody', {}, ...warnings.map(w => h('tr', {}, h('td', { class: 'strong', text: `${w.wbs1} ${w.name}` }), h('td', { text: label[w.kind] || w.kind }), h('td', { class: 'muted', text: w.detail }), h('td', { class: 'r', text: w.ytdBilled === null ? '-' : fmtCents(w.ytdBilled) }))))))));
  }

  renderOverview(ctx, slot, await Turnaround.runOverview(id));
  T.hydrateIcons(body);
  void reload;
}

/* typing RERUN is deliberate friction: PICs and Finance have already seen a published run */
function archivePanel(run, act) {
  const reason = h('textarea', { class: 'txt', rows: '2', style: 'height:auto;padding:8px 10px', 'aria-label': 'Reason for archiving', placeholder: 'For example: the billing cutoff was set to the wrong date' });
  const word = h('input', { class: 'txt', type: 'text', style: 'width:120px', 'aria-label': 'Type RERUN to confirm', placeholder: 'RERUN', autocomplete: 'off' });
  const go = h('button', { class: 'btn danger', type: 'button', text: 'Archive and build a new draft', disabled: true });
  const ready = () => { go.disabled = !(reason.value.trim() && word.value.trim() === 'RERUN'); };
  reason.addEventListener('input', ready); word.addEventListener('input', ready);
  const panel = h('section', { class: 'sec', style: 'border-color:var(--crit)' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Archive and rerun' }),
      h('p', { text: 'The archived version stays on file, clearly marked. PICs go on seeing the last published run until you publish the new one. Plan logs are not touched.' })),
    h('div', { class: 'sec-body' },
      row('Reason', 'Required. It stays with the archived run.', reason),
      row('Type RERUN to confirm', 'PICs and Finance have already seen this run.', word)),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: `${run.label}, version ${run.version} will be archived.` }),
      h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => panel.remove() }), go)));
  go.addEventListener('click', () => act(() => Admin.archiveRun(run.id, reason.value, word.value)));
  return panel;
}

function auditText(e) {
  if (e.action === 'setting.change') return [`Changed setting: ${SETTING_LABEL[e.object] || e.object}`, `${showValue(e.detail.from)} to ${showValue(e.detail.to)}`];
  if (e.action === 'user.change') {
    const parts = Object.keys(e.detail.to).filter(k => JSON.stringify(e.detail.to[k]) !== JSON.stringify(e.detail.from[k]))
      .map(k => `${{ role: 'role', active: 'status', draftName: 'name in drafts' }[k] || k}: ${k === 'active' ? (e.detail.from[k] ? 'active' : 'inactive') : showValue(e.detail.from[k])} to ${k === 'active' ? (e.detail.to[k] ? 'active' : 'inactive') : showValue(e.detail.to[k])}`);
    return [`Changed person: ${e.object}`, parts.join('; ')];
  }
  if (e.action === 'checkin.send') return ['Marked a check-in draft as sent', ''];
  if (e.action === 'checkin.dismiss') return ['Dismissed a check-in draft', ''];
  if (e.action === 'checkin.undo') return ['Put a check-in draft back in the queue', ''];
  if (e.action === 'daily.run') return ['Ran the daily checks', `${e.detail.created} new drafts, ${e.detail.withdrawn} withdrawn, ${e.detail.missed} commitments recorded as missed`];
  const runVerb = { 'run.build': 'Built', 'run.rebuild': 'Rebuilt the draft of', 'run.publish': 'Published', 'run.archive': 'Archived' }[e.action];
  if (runVerb) return [`${runVerb}: ${e.object}`, e.action === 'run.archive' ? `Reason: ${e.detail.reason}` : e.detail.by ? `by the ${e.detail.by}` : ''];
  return [e.action, e.object];
}
function auditCard(entries) {
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Audit log' }), h('p', { text: 'Every setting change and role change. Entries cannot be edited or removed.' })),
    entries.length ? h('div', { class: 'tblwrap' }, h('table', { class: 'dt' },
      h('thead', {}, h('tr', {}, ...['When', 'Who', 'What', 'Detail'].map(x => h('th', { text: x })))),
      h('tbody', {}, ...entries.map(e => { const [what, detail] = auditText(e); return h('tr', {}, h('td', { class: 'muted', text: fmtTime(e.at) }), h('td', { text: e.by }), h('td', { class: 'strong', text: what }), h('td', { text: detail })); }))))
      : h('div', { class: 'empty-row', text: 'Nothing has been changed yet.' }));
}

/* what the Turnaround screens (modules/turnaround/ui) borrow from the shell */
const ctx = { h, T, icon, frame, crumb, sep, banner, row, settingsCard, Session, ApiError };

/* ---------- routing ---------- */
function route() {
  const me = Session.me();
  const hash = location.hash || '#/';
  let m;
  if (/^#\/?$/.test(hash)) return pageHome();
  if ((m = /^#\/admin\/runs\/([0-9a-f-]+)$/.exec(hash))) return me.areas.admin ? pageRun(m[1]) : pageNoAccess();
  if ((m = /^#\/admin(?:\/([a-z]+))?$/.exec(hash))) return me.areas.admin ? pageAdmin(m[1]) : pageNoAccess();
  if ((m = /^#\/turnaround\/p\/([^/?]+)(?:\?cycle=(\d{4}))?$/.exec(hash))) return me.areas.turnaround ? pagePlan(decodeURIComponent(m[1]), m[2] ? Number(m[2]) : undefined) : pageNoAccess();
  if (hash === '#/turnaround') return me.areas.turnaround ? pageTurnaround() : pageNoAccess();
  if (hash === '#/turnaround/checkins') return me.areas.checkins ? pageCheckins() : pageNoAccess();
  const n = flatNav.find(x => x.phase && x.href === hash);
  if (n) return me.areas[n.area] ? pagePlaceholder(n) : pageNoAccess();
  location.hash = '#/';
}

async function boot(message) {
  T.applyTheme(); T.applyDensity();
  let me = null;
  try { me = await Session.load(); } catch (e) { message = 'The Compass server is not reachable.'; }
  if (!me) return showSignIn(message);
  try { await route(); } catch (e) {
    console.error(e);
    frame('', [crumb('Compass', '#/')], 'Compass').append(banner('circle-alert', 'Something went wrong loading this page. Nothing was changed.', 'err'));
  }
}
window.addEventListener('hashchange', () => { if (Session.me()) boot(); });
boot();
