/* ===== Which projects land on a Project Turnaround run =====
   Pure. Takes the output of profit.computeProjects and the Admin settings in force when the run is built.
   Every number here is a setting (CLAUDE.md: thresholds are not constants).

   Settings used (dollars, as the Admin page shows them):
     include.ytdProfitBelow     a project is listed when its YTD profit is BELOW this (default 0)
     include.ignoreBilledUnder  projects whose YTD billed is under this are ignored (default 0 = ignore nothing)
     include.noPic              'leave-out-warn' (default) or 'unassigned'

   Returns { included, warnings }. Warning kinds match the run_warnings table:
     cant_evaluate  no overhead plan, or more than one overhead rate (the validated SQL's result set 2)
     no_pic         an active project with no principal in charge in Vantagepoint (result set 3) */

function selectForRun(computed, settings) {
  const below = Math.round(settings['include.ytdProfitBelow'] * 100);
  const minBilled = Math.round(settings['include.ignoreBilledUnder'] * 100);
  const keepUnassigned = settings['include.noPic'] === 'unassigned';
  const included = []; const warnings = [];

  for (const p of computed) {
    const noPic = !p.principal;
    const leftOut = noPic && !keepUnassigned;
    const qualifies = p.evaluable && p.profit.ytd < below && p.billed.ytd >= minBilled;
    // a project with no PIC is always reported (the SQL's result set 3), whether or not it could be evaluated
    if (noPic) warnings.push({ kind: 'no_pic', wbs1: p.wbs1, detail: leftOut && qualifies ? 'No PIC in Vantagepoint; left out of the run' : 'No PIC in Vantagepoint', ytdBilled: p.billed.ytd });
    if (!p.evaluable) {
      warnings.push({ kind: 'cant_evaluate', wbs1: p.wbs1, detail: p.reason === 'no-overhead-plan' ? 'No overhead plan' : 'Mixed overhead rates', ytdBilled: p.billed.ytd });
      continue;
    }
    if (leftOut) continue;
    if (qualifies) included.push(p);
  }
  // the SQL's order: PIC, then worst YTD profit first, then project number
  included.sort((a, b) => a.principal.localeCompare(b.principal) || a.profit.ytd - b.profit.ytd || a.wbs1.localeCompare(b.wbs1));
  return { included, warnings };
}

module.exports = { selectForRun };
