'use strict';
/* The Home page's data, shaped by role. What each role gets:
     admin     needs your attention, recently published, data checks, next scheduled runs
     sysadmin  data checks and next scheduled runs (keeps the site running; no run contents)
     pic       their own projects that need an update, and recently published runs
     finance, marketing   recently published runs, if they may see Turnaround
   Only what really exists is shown. BD report, Pipeline watch and the firm snapshot have no data source yet, so they
   are not here (the firm snapshot's utilization and net profit are handoff open question 5). */
const roles = require('../shared/rules/roles');
const lifecycle = require('../modules/turnaround/logic/lifecycle');
const schedule = require('../modules/turnaround/logic/schedule');
const { daysBetween } = require('../modules/turnaround/logic/dates');
const runsDb = require('./runs');
const tdb = require('./turnaround');

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

function buildHome(db, user, { today, settings }) {
  const out = { today, role: user.role };
  const runs = runsDb.allRuns(db);
  const canTurnaround = roles.canView(user.role, 'turnaround', settings.access);
  const isAdmin = user.role === 'admin';
  const sees = isAdmin || user.role === 'sysadmin';
  const dir = tdb.directory(db);

  // ---- needs your attention (admin only) ----
  if (isAdmin) {
    const items = [];
    const draft = runs.find(r => r.kind === runsDb.KIND && r.status === 'draft');
    if (draft && settings['run.showOnHome']) {
      const n = db.get('SELECT COUNT(*) AS n, COUNT(DISTINCT pic_code) AS pics FROM run_projects WHERE run_id = ?', draft.id);
      items.push({ kind: 'draft', badge: 'Draft', tone: 'warn', title: `Project Turnaround: ${schedule.periodLabel(draft.period)} run is ready to review`,
        text: `${plural(n.n, 'turnaround project')} across ${plural(n.pics, 'PIC')}. Generated ${'{createdAt}'}. PICs can't see it until you publish.`, createdAt: draft.created_at, href: `#/admin/runs/${draft.id}`, action: 'Review draft', primary: true });
    }
    const waiting = db.all("SELECT items_json, situation FROM checkin_drafts WHERE status = 'waiting'");
    if (waiting.length) {
      const count = s => waiting.filter(d => d.situation === s).reduce((n, d) => n + JSON.parse(d.items_json).length, 0);
      const od = count('overdue'), np = count('no_plan');
      items.push({ kind: 'checkins', badge: plural(waiting.length, 'draft'), tone: 'blue', title: 'Check-in drafts are ready for you to send',
        text: `${[od ? plural(od, 'overdue plan update') : null, np ? `${plural(np, 'project')} with no plan yet` : null].filter(Boolean).join(' and ')}. Each note goes out from your own mailbox.`, href: '#/turnaround/checkins', action: 'Open queue' });
    }
    const esc = tdb.listCheckins(db, { today, settings }).escalate;
    if (esc.length) items.push({ kind: 'escalate', badge: plural(esc.length, 'conversation'), tone: 'crit', title: `${esc.length === 1 ? 'A project is' : esc.length + ' projects are'} ${settings['ladder.escalateDays']} days or more past due`,
      text: 'Worth talking in person rather than sending another note.', href: '#/turnaround/checkins', action: 'See which' });
    out.attention = items;
  }

  // ---- a PIC's own projects ----
  if (user.role === 'pic' && canTurnaround) {
    const cur = lifecycle.currentPublished(runs, runsDb.KIND);
    out.yours = null;
    if (cur) {
      const o = tdb.buildOverview(db, cur.id, { role: user.role, userId: user.id, employeeCode: user.employee_code }, { today, settings });
      const mine = o.pics.find(p => p.code === user.employee_code);
      out.yours = mine ? { runLabel: o.run.label, projects: mine.projects.map(p => ({ wbs1: p.wbs1, name: p.name, plan: p.plan, profitYtd: p.profit.ytd })) } : { runLabel: o.run.label, projects: [] };
    }
  }

  // ---- recently published ----
  if (canTurnaround) {
    const names = Object.fromEntries(db.all('SELECT id, display_name FROM users').map(u => [u.id, u.display_name]));
    const who = ['PICs', 'Finance'].concat(settings.access.marketingTurnaround ? ['Marketing'] : []);
    out.published = runs.filter(r => r.status === 'published').slice(0, 5).map(r => {
      const n = db.get('SELECT COUNT(*) AS n FROM run_projects WHERE run_id = ?', r.id).n;
      return { id: r.id, label: `Project Turnaround, ${schedule.periodLabel(r.period)}`, version: r.version, publishedAt: r.published_at, by: names[r.published_by] ? names[r.published_by].split(' ')[0] : null,
        text: `${plural(n, 'turnaround project')}.${isAdmin ? ` Visible to ${who.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : ''}`, href: '#/turnaround' };
    });
  }

  // ---- data checks and what runs next (admin and system admin) ----
  if (sees) {
    const latestClosed = schedule.lastClosedPeriod(today);
    const live = runs.filter(r => r.kind === runsDb.KIND && r.status !== 'archived').sort((a, b) => b.period - a.period || b.version - a.version);
    const last = live[0];
    const checks = [];
    if (!last) checks.push({ status: 'fix', title: 'No run has been built yet', text: `The monthly job builds ${schedule.periodLabel(latestClosed)} on the first business day. You can build it now in Admin > Report runs.`, href: '#/admin/runs' });
    else if (last.period < latestClosed) checks.push({ status: 'fix', title: `The ${schedule.periodLabel(latestClosed)} run has not been built`, text: `The latest is ${schedule.periodLabel(last.period)}. Check that the monthly job ran, or build it in Admin > Report runs.`, href: '#/admin/runs' });
    else checks.push({ status: 'ok', title: 'Monthly Vantagepoint pull', text: `${schedule.periodLabel(last.period)} data, read-only source.`, createdAt: last.created_at });

    const noPic = db.get("SELECT COUNT(*) AS n FROM projects WHERE status = 'A' AND principal = ''").n;
    checks.push(noPic ? { status: 'fix', title: `${plural(noPic, 'active project')} ${noPic === 1 ? 'has' : 'have'} no PIC`, text: 'They are left out of every PIC group until assigned in Vantagepoint.' } : { status: 'ok', title: 'Every active project has a PIC', text: '' });

    const unmapped = db.all("SELECT p.wbs1 FROM projects p WHERE p.status = 'A' AND p.principal <> '' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.role = 'pic' AND u.active = 1 AND u.employee_code = p.principal)").length;
    checks.push(unmapped ? { status: 'fix', title: `${plural(unmapped, 'active project')} ${unmapped === 1 ? 'has' : 'have'} a PIC with no Compass login`, text: 'They appear on the page but nobody can write their plan or get a reminder. Add the person in Admin > People.', href: '#/admin/people' } : { status: 'ok', title: 'Every PIC has a Compass login', text: '' });

    const warnRun = last;
    if (warnRun) {
      const w = db.get("SELECT COUNT(*) AS n FROM run_warnings WHERE run_id = ? AND kind = 'cant_evaluate'", warnRun.id).n;
      if (w) checks.push({ status: 'fix', title: `${plural(w, 'project')} could not be evaluated`, text: 'No overhead plan, or more than one overhead rate. Fix in Vantagepoint; the next run picks them up.', href: warnRun.status === 'draft' || isAdmin ? `#/admin/runs/${warnRun.id}` : undefined });
    }

    const daily = db.get("SELECT at FROM audit_log WHERE action = 'daily.run' ORDER BY id DESC LIMIT 1");
    const ageDays = daily ? daysBetween(require('./plan').localDate(daily.at), today) : null;
    checks.push(daily && ageDays <= 2
      ? { status: 'ok', title: 'Daily checks', text: 'Missed commitments are recorded and check-in drafts prepared.', createdAt: daily.at }
      : { status: 'fix', title: daily ? `Daily checks last ran ${plural(ageDays, 'day')} ago` : 'Daily checks have not run yet', text: 'The daily job records missed commitments and prepares check-in drafts. It should run every day (npm run daily, or a scheduled task).' });
    out.checks = checks;

    out.next = [
      { title: 'Project Turnaround run', text: 'First business day. Creates a draft and emails you.', date: schedule.nextFirstBusinessDay(today, !!(!last || last.period < latestClosed)) },
      { title: 'Daily checks', text: 'Every day. Records missed commitments and prepares check-in drafts.', date: null },
    ];
    const latest = last || null;
    out.pull = latest ? { period: latest.period, label: schedule.periodLabel(latest.period), dataAsOf: schedule.lastDayOfPeriod(latest.period), builtAt: latest.created_at } : null;
  }

  out.areas = roles.describe(user.role, settings.access).areas;
  void dir;
  return out;
}

module.exports = { buildHome };
