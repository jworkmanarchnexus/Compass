/* Projects in Pursuit: small pieces the home list, the form and the detail page share. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const money = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? '' : '$' + Number(v).toLocaleString('en-US');
export const day = d => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}, ${y}`; };
export const when = ms => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
export const whenTime = ms => { const d = new Date(ms); return `${when(ms)}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`; };

const STATUS_CHIP = { new: 'blue', review: 'blue', returned: 'warn', created: 'ok', withdrawn: '' };
export const statusChip = (h, status, label) => h('span', { class: 'chip ' + (STATUS_CHIP[status] || ''), text: label });

const AIA_CHIP = { rep: 'ok', review: 'warn', not: '', pending: '' };
export const aiaChip = (h, st) => h('span', { class: 'chip ' + AIA_CHIP[st.key], title: 'AIA 2030 Commitment reporting', text: `AIA 2030: ${st.label}` });

/* the compact review: one card with a short two-column list per section. v = values ready to show (strings). */
export function reviewSections(h, f, r, opts) {
  const o = opts || {};
  const P = window.CompassPip;
  const st = P.aia2030(f);
  const urg = f.urgency ? { value: f.urgency } : P.urgency(f.start, o.today || '');
  const scope = [f.hvac && `Heating, cooling or ventilation changes: ${f.hvac}`, f.env && `Walls and roof changed: ${f.env}`, f.light && `We design the lighting: ${f.light}`].filter(Boolean).join('. ');
  const site = [f.street, [f.city, f.st, f.zip].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const sections = [
    ['Pursuit', [['Project name', f.name], ['Stage', f.stage], ['Probability', f.prob === null || f.prob === undefined || f.prob === '' ? '' : f.prob + '%'], ['Source', f.source], ['Responsibility', f.resp], ['Direct award', f.direct]]],
    ['Client', [['Primary client', r.client], ['Client address', r.clientAddress], ['Primary contact', r.contact], ['Contact email', r.contactEmail], ['Contact phone', r.contactPhone], ['Contact address', r.contactAddress]].filter(x => x[0] === 'Primary client' || x[0] === 'Primary contact' || x[1])],
    ['Project', [['Project type', f.ptype], ['Deliverable', f.deliv], scope ? ['AIA 2030 scope', scope] : null, ['Description', f.desc],
      P.asksSite(f) ? ['Project site', site] : null, P.asksSite(f) ? ['Gross area', f.gsf ? Number(f.gsf).toLocaleString('en-US') + ' SF' : ''] : null,
      ['Construction budget', money(f.budget)], ['RFP release', day(f.rfpDate)], ['Proposal due', day(f.proposalDate)], ['Shortlist', day(f.shortlistDate)], ['Interview', day(f.interviewDate)]].filter(Boolean)],
    ['Team and fee', [['Office', f.office], ['Principal', r.principal], ['Project manager', r.pm], ['Project architect', r.pa], ['Delivery method', f.delivery], ['Compensation type', f.comp],
      ['Estimated fee (gross)', money(f.fee)], ['Master contract value', money(f.mcv)], ['Estimated start', day(f.start)], ['Estimated completion', day(f.end)], ['Urgency', urg.value || '']]],
  ];
  const optional = new Set(['Client address', 'Contact email', 'Contact phone', 'Contact address', 'Project architect', 'Master contract value', 'Construction budget', 'RFP release', 'Proposal due', 'Shortlist', 'Interview', 'Project site', 'Gross area', 'Primary contact']);
  return h('div', { class: 'pip-review' }, ...sections.map(([title, rows]) => h('div', { class: 'pip-rev' },
    h('div', { class: 'pip-rev-h', text: title }),
    ...rows.map(([k, v]) => h('div', { class: 'pip-rev-r' }, h('span', { class: 'k', text: k }),
      h('span', { class: 'v' + (v ? '' : ' none'), text: v || (optional.has(k) ? 'Not given' : 'Missing') }))))),
  h('div', { class: 'pip-rev' }, h('div', { class: 'pip-rev-h', text: 'AIA 2030' }),
    h('div', { class: 'pip-rev-r' }, h('span', { class: 'k', text: 'Status' }), h('span', { class: 'v' }, aiaChip(h, st))),
    h('div', { class: 'pip-rev-r' }, h('span', { class: 'k', text: 'Why' }), h('span', { class: 'v', text: st.reason })),
    h('div', { class: 'pip-rev-r' }, h('span', { class: 'k', text: 'Category' }), h('span', { class: 'v', text: st.category })),
    h('div', { class: 'pip-rev-r' }, h('span', { class: 'k', text: 'Construction type' }), h('span', { class: 'v', text: st.construction }))),
  f.notes ? h('div', { class: 'pip-rev' }, h('div', { class: 'pip-rev-h', text: 'Notes for the reviewers' }), h('p', { class: 'pip-note', text: f.notes })) : null);
}

/* the AIA 2030 guide in the form's side panel (the concept's explanation, unchanged in substance) */
export function aiaGuide(h, st) {
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'AIA 2030' }), aiaChip(h, st)),
    h('div', { class: 'sec-body pip-guide' },
      h('p', { class: 'pip-reason', text: st.reason }),
      h('div', { class: 'lbl', text: 'What makes a project reportable' }),
      h('dl', {},
        h('dt', { text: 'New construction and additions' }), h('dd', { text: 'Always reportable as whole building projects.' }),
        h('dt', { text: 'Renovations' }), h('dd', { text: 'Reportable when our scope changes the HVAC systems or a quarter or more of the walls and roof.' }),
        h('dt', { text: 'Interiors and tenant improvements' }), h('dd', { text: 'Reportable when we design the lighting.' }),
        h('dt', { text: 'Studies and plans' }), h('dd', { text: 'Feasibility studies, master plans and programming are not reportable: no building is designed.' }),
        h('dt', { text: 'Not sure?' }), h('dd', { text: 'Choose Not sure. The sustainability team follows up and confirms.' }))));
}
