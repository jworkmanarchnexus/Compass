/* ===== Projects in Pursuit: the form's rules =====
   Pure: no DOM, no network, no clock (today is passed in). Tested from tests/fixtures/form.json.
   The lists and the stage -> probability rule come from the admin's PiP worksheet (PIP Worksheet_V2, "Data Points" tab).
   The AIA 2030 rule comes from the intake concept an employee built (Josh, 2026-11-26: keep his logic as is).

   f, the form: {
     name, stage, prob (whole percent), source, resp, direct ('Yes' | 'No'),
     client (a Vantagepoint client id, or NEW), newClientName, newClientAddr,
     contact (a Vantagepoint contact id, NEW, or ''), ncName, ncEmail, ncPhone, ncAddr,
     ptype, deliv, hvac, env, light, desc, street, city, st, zip, gsf, budget,
     rfpDate, proposalDate, shortlistDate, interviewDate,
     office, principal, pm, pa (employee codes), delivery, comp, fee, mcv (whole dollars), start, end ('YYYY-MM-DD'), notes } */
'use strict';

const NEW = 'new';

/* The Vantagepoint values (Data Points tab). Intake only: the closed stages (No Go, Cancelled, Lost) are never offered. */
const LISTS = {
  stages: ['Research', 'Go NoGo Process', 'Fee Proposal Only (No Marketing)', 'Marketing Proposal', 'Shortlisted', 'Negotiation', 'Awarded', 'Awarded with Interview'],
  sources: ['Association Lead', 'Existing Client', 'Lead Source', 'Marketing Campaign', 'New Business Development', 'Referral'],
  resp: ['Prime', 'Consultant', 'Joint Venture', 'Sub Contractor', 'Undetermined'],
  ptypes: ['Civic', 'Commercial', 'Federal', 'Healthcare', 'Higher Education', 'K-12 Education'],
  delivs: ['New Construction', 'Expansion/Infill', 'Modernization/Renovation/Remodel', 'Tenant Improvement', 'Bridging/Criteria Documents', 'Feasibility Study', 'Master Plan', 'Programming', 'Sustainability'],
  offices: ['Salt Lake', 'Sacramento'],
  methods: ['Design-Bid-Build', 'Design-Build', 'CM at Risk', 'CM Multi Prime', 'Agency CM', 'IPD-LEAN Construction', 'Lease-Leaseback', 'Undetermined'],
  comps: ['Fixed Fee', 'HNTE', 'Hourly'],
  yesNo: ['Yes', 'No'],
  hvac: ['Yes', 'No', 'Not sure'],
  env: ['Minor', 'A quarter or more', 'Not sure'],
  light: ['Yes', 'No', 'Not sure'],
  urgency: ['0-6 Months', '6-12 Months', '12+ Months'],
};

/* The probabilities each stage allows (the Admin setting 'pip.stageProbabilities'; this is its default).
   From the worksheet's probability labels: 10% Research; 20% Fee Proposal / Go-no-go / Marketing Proposal; 30-40% Shortlisted;
   50-70% Negotiation; 80-90% Contracting, which is Awarded in Vantagepoint until the contract is signed (open question PIP1).
   100% (signed) is not a pursuit any more: it gets a project number instead. */
const DEFAULT_STAGE_PROBS = {
  'Research': [10],
  'Go NoGo Process': [20],
  'Fee Proposal Only (No Marketing)': [20],
  'Marketing Proposal': [20],
  'Shortlisted': [30, 40],
  'Negotiation': [50, 60, 70],
  'Awarded': [80, 90],
  'Awarded with Interview': [80, 90],
};
const PROB_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90];

function allowedProbs(stage, table) {
  const t = table || DEFAULT_STAGE_PROBS;
  return stage && Array.isArray(t[stage]) ? t[stage].slice() : [];
}

/* the setting's shape: every intake stage, each a non-empty ascending list of distinct steps from 10 to 90 */
function validStageProbs(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (Object.keys(v).length !== LISTS.stages.length) return false;
  return LISTS.stages.every(s => Array.isArray(v[s]) && v[s].length >= 1 && v[s].every((p, i) => PROB_STEPS.includes(p) && (i === 0 || p > v[s][i - 1])));
}

/* ---- urgency: worked out from the start date and routed to Vantagepoint's three options ---- */
const parseDay = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z'))) ? d : null;
function addMonths(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
/* { value: one of LISTS.urgency or null, note } */
function urgency(start, today) {
  const s = parseDay(start);
  if (!s) return { value: null, note: 'Needs a start date' };
  if (s < today) return { value: '0-6 Months', note: 'The start date has passed' };
  if (s <= addMonths(today, 6)) return { value: '0-6 Months', note: '' };
  if (s <= addMonths(today, 12)) return { value: '6-12 Months', note: '' };
  return { value: '12+ Months', note: '' };
}

/* ---- AIA 2030: is this project reported? (the concept's rule, unchanged) ----
   key: 'pending' (not enough answers yet), 'rep' (reportable), 'review' (the sustainability team confirms), 'not' (not reportable).
   Responsibility (Prime, Consultant...) has no effect for now (Josh, 2026-11-26). */
function aia2030(f) {
  const mk = (key, label, category, construction, reason) => ({ key, label, category, construction, reason });
  const d = f.deliv;
  if (!d) return mk('pending', 'Waiting', 'Not set', 'Not set', 'Select a deliverable in the Project section.');
  if (d === 'New Construction') return mk('rep', 'Reportable', 'Whole building', 'New construction', 'New construction is reportable.');
  if (d === 'Expansion/Infill') return mk('rep', 'Reportable', 'Whole building', 'New construction (addition)', 'Additions are treated as new construction.');
  if (d === 'Modernization/Renovation/Remodel') {
    if (f.hvac === 'Yes' || f.env === 'A quarter or more') return mk('rep', 'Reportable', 'Whole building', 'Major renovation', 'Our scope changes the HVAC systems or a quarter or more of the walls and roof.');
    if (f.hvac === 'Not sure' || f.env === 'Not sure') return mk('review', 'Needs review', 'Whole building', 'Renovation (unconfirmed)', 'The scope is not certain yet. The sustainability team will confirm.');
    if (f.hvac && f.env) return mk('not', 'Not reportable', 'Not applicable', 'Minor renovation', 'Our scope does not change the HVAC systems or a large part of the walls and roof.');
    return mk('pending', 'Waiting', 'Whole building', 'Renovation', 'Waiting for the two scope questions.');
  }
  if (d === 'Tenant Improvement') {
    if (f.light === 'Yes') return mk('rep', 'Reportable', 'Interiors only', 'Interiors', 'An interiors project that includes lighting design.');
    if (f.light === 'Not sure') return mk('review', 'Needs review', 'Interiors only', 'Interiors', 'Lighting design is not certain yet. The sustainability team will confirm.');
    if (f.light === 'No') return mk('not', 'Not reportable', 'Not applicable', 'Interiors', 'An interiors project without lighting design.');
    return mk('pending', 'Waiting', 'Interiors only', 'Interiors', 'Waiting for the lighting question.');
  }
  if (d === 'Sustainability' || d === 'Bridging/Criteria Documents') return mk('review', 'Needs review', 'To confirm', 'To confirm', 'This deliverable needs the sustainability team\'s judgment.');
  return mk('not', 'Not reportable', 'Not applicable', 'Not applicable', 'A planning or study deliverable: no building is designed.');
}
const isFlagged = st => st.key === 'rep' || st.key === 'review';
/* which scope questions are asked */
const scopeQuestions = f => f.deliv === 'Modernization/Renovation/Remodel' ? ['hvac', 'env'] : f.deliv === 'Tenant Improvement' ? ['light'] : [];
/* the site address and gross area were added for AIA 2030: not asked once the project is clearly not reportable */
const asksSite = f => aia2030(f).key !== 'not';
const SITE_FIELDS = ['street', 'city', 'st', 'zip', 'gsf'];

/* ---- required fields. [field, label, section] ; sections: pursuit, client, project, team ---- */
function requiredList(f) {
  const req = [['name', 'Project name', 'pursuit'], ['stage', 'Stage', 'pursuit'], ['prob', 'Probability', 'pursuit'], ['source', 'Source', 'pursuit'], ['resp', 'Responsibility', 'pursuit'], ['direct', 'Direct award', 'pursuit'],
    ['client', 'Primary client', 'client']];
  if (f.client === NEW) req.push(['newClientName', 'Client legal name', 'client']);
  if (f.contact === NEW) req.push(['ncName', 'Contact name', 'client']);
  req.push(['ptype', 'Project type', 'project'], ['deliv', 'Deliverable', 'project']);
  if (f.deliv === 'Modernization/Renovation/Remodel') req.push(['hvac', 'AIA 2030 question: heating, cooling or ventilation', 'project'], ['env', 'AIA 2030 question: walls and roof', 'project']);
  if (f.deliv === 'Tenant Improvement') req.push(['light', 'AIA 2030 question: lighting design', 'project']);
  req.push(['desc', 'Project description', 'project'],
    ['office', 'Office', 'team'], ['principal', 'Principal', 'team'], ['pm', 'Project manager', 'team'], ['delivery', 'Delivery method', 'team'], ['comp', 'Compensation type', 'team'],
    ['fee', 'Estimated fee', 'team'], ['start', 'Estimated start date', 'team'], ['end', 'Estimated completion date', 'team']);
  return req;
}
const filled = v => v !== undefined && v !== null && String(v).trim() !== '';
const missing = f => requiredList(f).filter(([k]) => !filled(f[k]));

/* ---- problems: what stops a submission. lists = { clients: [{ id, contacts: [ids] }], employees: [codes], principals: [codes], architects: [codes] | null } ----
   Returns [{ field, message }]; an empty list means it may be submitted. Used by the form (as you type) and by the server (always). */
function problems(f, opts) {
  const o = opts || {};
  const out = [];
  const add = (field, message) => out.push({ field, message });
  for (const [k, label] of missing(f)) add(k, `${label} is required.`);
  const inList = (k, list, label) => { if (filled(f[k]) && !list.includes(f[k])) add(k, `${label} must be one of the listed choices.`); };
  inList('stage', LISTS.stages, 'Stage');
  if (filled(f.stage) && filled(f.prob) && LISTS.stages.includes(f.stage) && !allowedProbs(f.stage, o.stageProbs).includes(Number(f.prob))) add('prob', `For ${f.stage} the probability must be ${allowedProbs(f.stage, o.stageProbs).map(p => p + '%').join(' or ')}.`);
  inList('source', LISTS.sources, 'Source'); inList('resp', LISTS.resp, 'Responsibility'); inList('direct', LISTS.yesNo, 'Direct award');
  inList('ptype', LISTS.ptypes, 'Project type'); inList('deliv', LISTS.delivs, 'Deliverable');
  inList('hvac', LISTS.hvac, 'The heating and cooling answer'); inList('env', LISTS.env, 'The walls and roof answer'); inList('light', LISTS.light, 'The lighting answer');
  inList('office', LISTS.offices, 'Office'); inList('delivery', LISTS.methods, 'Delivery method'); inList('comp', LISTS.comps, 'Compensation type');
  const lists = o.lists;
  if (lists) {
    const client = (lists.clients || []).find(c => c.id === f.client);
    if (filled(f.client) && f.client !== NEW && !client) add('client', 'Pick the client from the list, or choose a new client.');
    if (filled(f.contact) && f.contact !== NEW && (!client || !client.contacts.includes(f.contact))) add('contact', 'Pick a contact of this client, or choose a new contact.');
    const emp = k => filled(f[k]) && !(lists.employees || []).includes(f[k]);
    if (emp('principal') || (filled(f.principal) && lists.principals && !lists.principals.includes(f.principal))) add('principal', 'Pick the principal from the list.');
    if (emp('pm')) add('pm', 'Pick the project manager from the list.');
    if (emp('pa')) add('pa', 'Pick the project architect from the list.');
    else if (filled(f.pa) && lists.architects && !lists.architects.includes(f.pa)) add('pa', 'The project architect must be a licensed architect.');
  }
  const money = (k, label) => { if (filled(f[k]) && !(Number.isInteger(Number(f[k])) && Number(f[k]) >= 0 && Number(f[k]) <= 1e10)) add(k, `${label} must be a whole dollar amount.`); };
  money('fee', 'Estimated fee'); money('mcv', 'Master contract value'); money('budget', 'Construction budget');
  if (filled(f.fee) && Number(f.fee) === 0) add('fee', 'Estimated fee must be more than zero.');
  if (filled(f.gsf) && !(Number.isInteger(Number(f.gsf)) && Number(f.gsf) > 0 && Number(f.gsf) <= 1e8)) add('gsf', 'Gross area must be a whole number of square feet.');
  for (const [k, label] of [['start', 'Estimated start date'], ['end', 'Estimated completion date'], ['rfpDate', 'RFP release date'], ['proposalDate', 'Proposal due date'], ['shortlistDate', 'Shortlist date'], ['interviewDate', 'Interview date']]) {
    if (filled(f[k]) && !parseDay(f[k])) add(k, `${label} is not a valid date.`);
  }
  if (parseDay(f.start) && parseDay(f.end) && f.end < f.start) add('end', 'The completion date is before the start date.');
  if (filled(f.ncEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.ncEmail).trim())) add('ncEmail', 'The contact email does not look like an email address.');
  return out;
}

/* ---- warnings: shown, never blocking ---- */
function warnings(f, opts) {
  const o = opts || {};
  const out = [];
  const threshold = o.cfoThreshold === undefined ? 1000000 : o.cfoThreshold;
  if (filled(f.fee) && Number(f.fee) >= threshold) out.push({ field: 'fee', key: 'cfo', message: `A fee of $${Number(threshold).toLocaleString('en-US')} or more must be coordinated with the CFO. The CFO is told when you submit, to follow up.` });
  if (o.today && parseDay(f.start) && f.start < o.today) out.push({ field: 'start', key: 'past', message: 'The estimated start date has passed. Urgency is recorded as 0-6 Months.' });
  return out;
}

/* ---- what is stored: known fields only, trimmed, numbers as numbers, the AIA 2030-only site fields dropped when not asked ---- */
const TEXT = ['name', 'stage', 'source', 'resp', 'direct', 'client', 'newClientName', 'newClientAddr', 'contact', 'ncName', 'ncEmail', 'ncPhone', 'ncAddr',
  'ptype', 'deliv', 'hvac', 'env', 'light', 'desc', 'street', 'city', 'st', 'zip', 'rfpDate', 'proposalDate', 'shortlistDate', 'interviewDate',
  'office', 'principal', 'pm', 'pa', 'delivery', 'comp', 'start', 'end', 'notes'];
const NUMS = ['prob', 'fee', 'mcv', 'budget', 'gsf'];
const LIMITS = { desc: 4000, notes: 4000 };
function clean(input) {
  const f = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const k of TEXT) f[k] = typeof src[k] === 'string' ? src[k].trim().slice(0, LIMITS[k] || 300) : '';
  for (const k of NUMS) {
    const v = src[k];
    if (v === '' || v === null || v === undefined) { f[k] = null; continue; }
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    f[k] = Number.isFinite(n) ? n : String(v);
  }
  const qs = scopeQuestions(f);
  for (const k of ['hvac', 'env', 'light']) if (!qs.includes(k)) f[k] = '';
  if (f.client !== NEW) { f.newClientName = ''; f.newClientAddr = ''; }
  if (f.contact !== NEW) { f.ncName = ''; f.ncEmail = ''; f.ncPhone = ''; f.ncAddr = ''; }
  if (!asksSite(f)) for (const k of SITE_FIELDS) f[k] = k === 'gsf' ? null : '';
  return f;
}

const formApi = { NEW, LISTS, DEFAULT_STAGE_PROBS, PROB_STEPS, allowedProbs, validStageProbs, addMonths, urgency, aia2030, isFlagged, scopeQuestions, asksSite, SITE_FIELDS, requiredList, missing, problems, warnings, clean };
if (typeof module !== 'undefined' && module.exports) module.exports = formApi;
else if (typeof window !== 'undefined') window.CompassPip = Object.assign(window.CompassPip || {}, formApi);
