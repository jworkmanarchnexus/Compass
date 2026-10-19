/* ===== How the PIC and market sector charts show the goal =====
   Pure. Used by the page and the PDF so both draw the same thing (from Dave's reports):

   By PIC, when every PIC has the same goal: ONE "Goal" bar at the top (dark = where each should be by this month, light = the rest of the
   year's goal) with a dashed line down the whole chart at the pace and at the full goal, so any PIC's bar can be read against them.
   By PIC when the goals differ, and always By market sector: each row is a pair, the actual bar and its own goal bar underneath.
   Rows are biggest total first. Every PIC or sector with a row is shown, even with nothing yet; "Unassigned" only if it has something.

   rows: the report's rows [{ key, label, goal, ytdGoal, ytd, forecast, mwip, total }]   scope: 'pic' | 'sector'
   -> { mode: 'single' | 'paired', rows: [...in order], goal: { goal, ytdGoal } | null } */
'use strict';

function layout(rows, scope) {
  const shown = rows.filter(r => r.key !== '' || r.total > 0).slice().sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label)));
  const real = shown.filter(r => r.key !== '');
  const same = scope === 'pic' && real.length > 0 && real.every(r => r.goal > 0 && r.goal === real[0].goal && r.ytdGoal === real[0].ytdGoal);
  return { mode: same ? 'single' : 'paired', rows: shown, goal: same ? { goal: real[0].goal, ytdGoal: real[0].ytdGoal } : null };
}

/* the number of bar rows and of gaps between groups a chart of this layout needs (for sizing the PDF page) */
function size(lay) {
  const n = lay.rows.length;
  return lay.mode === 'single' ? { rows: n + 1, groups: 1 } : { rows: 2 * n, groups: n };
}

const api = { layout, size };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.BdGoalChart = api;
