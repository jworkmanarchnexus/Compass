/* Admin > Projects in Pursuit: who reviews, who is told, who else may look, the CFO threshold, the recent window,
   and the probabilities each stage allows (from the PiP worksheet's Data Points tab). */
export function pipAdminCards(ctx, settings, people, canEdit, rerender) {
  const { h, settingsCard, row } = ctx;
  const active = people.filter(p => p.active);
  const P = window.CompassPip;
  const ROLE = window.CompassRules.ROLE_LABEL;

  const picks = (ed, key, help) => h('div', { class: 'preview-picks' },
    help ? h('div', { class: 'help', text: help }) : null,
    ...active.map(p => {
      const box = h('input', { type: 'checkbox', checked: ed.draft[key].includes(p.id), disabled: !canEdit, onchange: () => {
        ed.draft[key] = box.checked ? ed.draft[key].concat(p.id) : ed.draft[key].filter(x => x !== p.id);
      } });
      return h('label', { class: 'check' }, box, h('span', { text: p.name }), h('span', { class: 'muted small', text: ROLE[p.role] }));
    }));
  const one = (ed, key) => ed.select(key, [['', 'Nobody']].concat(active.map(p => [p.id, p.name])));

  const people1 = settingsCard('Who reviews and who is told', 'The PiP admins review each PiP, return it with a note or mark it created in Vantagepoint. Principals and project managers fill PiPs in.', settings,
    ['pip.admins', 'pip.primaryAdmin', 'pip.cfo', 'pip.cfoThreshold'], canEdit, rerender, ed => [
      row('PiP admins', 'They see every PiP and the "Review this PiP" button. The Admin always can.', picks(ed, 'pip.admins')),
      row('Primary PiP admin', 'Told by email about every PiP submitted or resubmitted, with the PIC and the PM on it.', one(ed, 'pip.primaryAdmin')),
      row('CFO', 'Told about a PiP whose fee is at or over the amount below, to coordinate before it goes into Vantagepoint.', one(ed, 'pip.cfo')),
      row('Coordinate with the CFO at', 'The form shows a warning at this fee or more. It never stops a submission.', ed.num('pip.cfoThreshold', { money: true, narrow: true })),
    ], 'Takes effect the next time someone opens a page.');

  const people2 = settingsCard('Who else may look', 'Principals, project managers and PiP admins always see Projects in Pursuit. Add anyone else who needs to read PiPs, for example the sustainability team. They can read every PiP but not submit or review.', settings,
    ['pip.viewers', 'pip.recentDays'], canEdit, rerender, ed => [
      row('Can also see PiPs', null, picks(ed, 'pip.viewers')),
      row('Recent list covers', 'PiPs still waiting always show. Created and withdrawn ones show for this many days.', ed.num('pip.recentDays', { narrow: true }), h('span', { class: 'muted', text: 'days' })),
    ], 'Takes effect the next time someone opens a page.');

  const probs = settingsCard('Probability by stage', 'The probabilities a PiP may use at each Vantagepoint stage. The form offers only these, and the server refuses anything else. From the PiP worksheet\'s Data Points tab.', settings,
    ['pip.stageProbabilities'], canEdit, rerender, ed => P.LISTS.stages.map(stage => row(stage, null,
      h('div', { class: 'pip-probs' }, ...P.PROB_STEPS.map(p => {
        const box = h('input', { type: 'checkbox', checked: ed.draft['pip.stageProbabilities'][stage].includes(p), disabled: !canEdit, 'aria-label': `${stage}: ${p}%`, onchange: () => {
          const now = ed.draft['pip.stageProbabilities'][stage].filter(x => x !== p);
          if (box.checked) now.push(p);
          ed.draft['pip.stageProbabilities'][stage] = now.sort((a, b) => a - b);
        } });
        return h('label', { class: 'check' }, box, h('span', { text: p + '%' }));
      })))), 'Applies to PiPs submitted after you save. Every stage needs at least one value. 100% is not offered: a signed project gets a project number, not a PiP.');

  return [people1, people2, probs];
}
