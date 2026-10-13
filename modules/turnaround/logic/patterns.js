/* ===== Commitment patterns: what PICs commit to, and what comes of it =====
   Pure analysis of the plan log, for the ADMIN only (the analysis; each commitment's own action and amount are visible on its plan page).
   Nothing is recorded separately: the append-only log already holds every commitment, every date change and every
   outcome, so this is worked out from it on demand and can never drift or be lost.

   Plain definitions (the numbers answer "do they follow through?" and "is cutting cost or adding revenue working better?"):
     made       commitments written in the year
     kept       done on or before the (current) date          late  done after it          missed  recorded Missed by the system
     resolved   kept + late + missed                           open  still waiting
     keptRate   kept / resolved (blank until something resolves)
     improved   done commitments the PIC said improved the project's finances in the period (yes), and notImproved (no)
     improvedRate  improved / (improved + notImproved); blank until a done commitment has been answered
     lead       days from writing the commitment to its promised date      moved  how often a date was changed
   There are no amounts: a commitment is a kind of action and some words, so the numbers count actions and outcomes.

   input: { year, entries, listed, cameOff, stillOn, picOf }
     entries   plan entries dated in the year: { id, wbs1, kind, date, commitmentId, data }
     listed    projects that were on a published run this year: [{ wbs1, pic, appeared }]   (appeared = 'YYYY-MM-DD')
     cameOff   listed projects no longer on the latest published run;  stillOn  those still on it
     picOf     { wbs1: PIC code } */
const plan = require('./plan');
const { daysBetween } = require('./dates');

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = xs => xs.reduce((a, b) => a + b, 0);

function metrics(list) {
  const kept = list.filter(c => c.status === 'done' && c.kept).length;
  const late = list.filter(c => c.status === 'done' && !c.kept).length;
  const missed = list.filter(c => c.status === 'missed').length;
  const open = list.filter(c => c.status === 'open').length;
  const resolved = kept + late + missed;
  const done = list.filter(c => c.status === 'done');
  const improved = done.filter(c => c.improved === true).length, notImproved = done.filter(c => c.improved === false).length;
  return {
    made: list.length, open, kept, late, missed, resolved,
    keptRate: resolved ? kept / resolved : null,
    moved: list.filter(c => c.moves > 0).length,
    avgMoves: list.length ? sum(list.map(c => c.moves)) / list.length : null,
    avgLead: mean(list.map(c => c.lead)),
    avgEarly: mean(done.map(c => c.early)), // positive = finished early, negative = late
    improved, notImproved, improvedRate: improved + notImproved ? improved / (improved + notImproved) : null,
  };
}

function analyze({ year, entries, listed, cameOff, stillOn, picOf }) {
  const byProject = new Map();
  for (const e of entries) { if (!byProject.has(e.wbs1)) byProject.set(e.wbs1, []); byProject.get(e.wbs1).push(e); }

  const commits = [];
  for (const [wbs1, list] of byProject) {
    for (const s of plan.commitmentStates(list)) {
      const made = list.find(e => e.id === s.id);
      const lever = made.data.lever, L = plan.LEVERS[lever];
      if (!L) continue;
      const doneE = list.find(e => e.kind === 'done' && e.commitmentId === s.id);
      commits.push({
        id: s.id, wbs1, pic: picOf[wbs1] || '', lever, group: L.group, otherText: made.data.otherText || null,
        madeDate: made.date, promisedBy: s.promisedBy, dueDate: s.dueDate, moves: s.revisions.length, status: s.status, kept: s.kept, closedDate: s.closedDate,
        improved: doneE && typeof doneE.data.improved === 'boolean' ? doneE.data.improved : null, lead: daysBetween(made.date, s.promisedBy), early: s.status === 'done' ? daysBetween(s.closedDate, s.dueDate) : null,
      });
    }
  }

  const groups = { money: metrics(commits.filter(c => c.group === 'money')), spend: metrics(commits.filter(c => c.group === 'spend')) };
  const actions = Object.entries(plan.LEVERS).map(([lever, L]) => {
    const mine = commits.filter(c => c.lever === lever);
    return Object.assign({ lever, label: L.label, group: L.group }, metrics(mine));
  });
  const pics = [...new Set(commits.map(c => c.pic))].map(pic => {
    const mine = commits.filter(c => c.pic === pic); const m = metrics(mine);
    return { pic, made: m.made, resolved: m.resolved, kept: m.kept, keptRate: m.keptRate, avgLead: m.avgLead, movedShare: m.made ? m.moved / m.made : null, moneyShare: m.made ? mine.filter(c => c.group === 'money').length / m.made : null };
  });
  const months = Array.from({ length: 12 }, (_, i) => {
    const inMonth = d => d && Number(d.slice(5, 7)) === i + 1 && Number(d.slice(0, 4)) === year;
    return {
      month: i + 1,
      madeMoney: commits.filter(c => c.group === 'money' && inMonth(c.madeDate)).length, madeSpend: commits.filter(c => c.group === 'spend' && inMonth(c.madeDate)).length,
      keptMoney: commits.filter(c => c.group === 'money' && c.kept && inMonth(c.closedDate)).length, keptSpend: commits.filter(c => c.group === 'spend' && c.kept && inMonth(c.closedDate)).length,
    };
  });

  // how quickly projects are answered: appearing on the list -> explanation -> first commitment
  const toExplain = [], toCommit = [];
  let withExplanation = 0, withCommitment = 0, updates = 0;
  for (const p of listed) {
    const list = byProject.get(p.wbs1) || [];
    const ex = list.filter(e => e.kind === 'explanation').map(e => e.date).sort()[0];
    const co = list.filter(e => e.kind === 'commitment').map(e => e.date).sort()[0];
    updates += list.filter(e => e.kind === 'update').length;
    if (ex) { withExplanation++; toExplain.push(Math.max(0, daysBetween(p.appeared, ex))); }
    if (co) withCommitment++;
    if (ex && co) toCommit.push(Math.max(0, daysBetween(ex, co)));
  }
  const responsiveness = { listed: listed.length, withExplanation, withCommitment, avgDaysToExplain: mean(toExplain), avgDaysExplainToCommit: mean(toCommit), updatesPerProject: listed.length ? updates / listed.length : null };

  const keptOn = (wbs1, group) => commits.some(c => c.wbs1 === wbs1 && c.kept && (!group || c.group === group));
  const offList = {
    cameOff: cameOff.length, cameOffWithKept: cameOff.filter(w => keptOn(w)).length, cameOffWithKeptMoney: cameOff.filter(w => keptOn(w, 'money')).length, cameOffWithKeptSpend: cameOff.filter(w => keptOn(w, 'spend')).length,
    stillOn: stillOn.length, stillOnWithKept: stillOn.filter(w => keptOn(w)).length, stillOnWithKeptMoney: stillOn.filter(w => keptOn(w, 'money')).length, stillOnWithKeptSpend: stillOn.filter(w => keptOn(w, 'spend')).length,
  };

  // the words PICs typed under "Other", so the Admin can see what is missing from the list of actions
  const others = commits.filter(c => c.otherText).sort((a, b) => a.madeDate.localeCompare(b.madeDate)).map(c => ({ text: c.otherText, group: c.group, wbs1: c.wbs1, date: c.madeDate, status: c.status, kept: c.kept }));

  return { year, total: commits.length, groups, actions, pics, months, responsiveness, offList, others };
}

module.exports = { analyze };
