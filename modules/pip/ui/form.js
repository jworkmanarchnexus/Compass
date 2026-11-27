/* Projects in Pursuit: the form. Four cards on one page (Pursuit, Client, Project, Team and fee), a side panel with the AIA 2030 status
   and what is still missing, then Review: a compact read-only view of everything, and Submit.
   Every rule is in modules/pip/logic/form.js (window.CompassPip); the server checks it all again.
   An unsent new PiP is kept in this browser (per person) so a reload does not lose it. */
import { Pip } from '/shared/platform/index.js';
import { money, aiaGuide, reviewSections } from '/modules/pip/ui/common.js';

const P = () => window.CompassPip;
const BLANK = () => ({ name: '', stage: '', prob: '', source: '', resp: '', direct: '', client: '', newClientName: '', newClientAddr: '', contact: '', ncName: '', ncEmail: '', ncPhone: '', ncAddr: '',
  ptype: '', deliv: '', hvac: '', env: '', light: '', desc: '', street: '', city: '', st: '', zip: '', gsf: '', budget: '', rfpDate: '', proposalDate: '', shortlistDate: '', interviewDate: '',
  office: '', principal: '', pm: '', pa: '', delivery: '', comp: '', fee: '', mcv: '', start: '', end: '', notes: '' });
const SECTION_LABEL = { pursuit: 'Pursuit', client: 'Client', project: 'Project', team: 'Team and fee' };

const draftKey = id => 'compass.pip.draft.' + id;
const loadDraft = id => { try { const t = localStorage.getItem(draftKey(id)); return t ? JSON.parse(t) : null; } catch (e) { return null; } };
const saveDraft = (id, f) => { try { localStorage.setItem(draftKey(id), JSON.stringify(f)); } catch (e) { /* private window: no draft */ } };
const dropDraft = id => { try { localStorage.removeItem(draftKey(id)); } catch (e) { /* nothing to drop */ } };

export async function renderPipForm(ctx, body, pipId) {
  const { h, T, Session, banner, actions } = ctx;
  const me = Session.me();
  const [form, existing] = await Promise.all([Pip.form(), pipId ? Pip.get(pipId) : null]);
  const editing = !!existing;
  if (editing && !existing.actions.includes('resubmit')) {
    body.append(h('div', { class: 'empty-note', text: 'This PiP cannot be changed now. Only a returned PiP can be changed, by the person who submitted it.' }), h('a', { class: 'btn', href: '#/pip/' + pipId, text: 'Open the PiP' }));
    return;
  }
  const lists = form.lists, pk = form.pickers;
  const empName = Object.fromEntries(pk.employees.map(e => [e.code, e.name]));
  // names can repeat: label a repeated one with its code so every label maps to exactly one person
  const nameCount = {}; for (const e of pk.employees) nameCount[e.name] = (nameCount[e.name] || 0) + 1;
  const labelOf = code => code ? (nameCount[empName[code]] > 1 ? `${empName[code]} (${code})` : empName[code] || code) : '';
  const clientById = Object.fromEntries(pk.clients.map(c => [c.id, c]));

  let f = BLANK();
  let restored = false;
  if (editing) Object.assign(f, existing.fields);
  else {
    const d = loadDraft(me.id);
    if (d && Object.keys(d).some(k => d[k] !== '' && k in f)) { Object.assign(f, d); restored = true; }
    else if (form.me.employeeCode) { // a sensible start: the person filling it in is the principal or the PM
      if (pk.principals.includes(form.me.employeeCode) && form.me.picProjects > 0) f.principal = form.me.employeeCode;
      else if (form.me.pmProjects > 0) f.pm = form.me.employeeCode;
    }
  }
  for (const k of Object.keys(f)) if (f[k] === null || f[k] === undefined) f[k] = '';
  delete f.urgency;
  let showErrors = false;
  let mode = 'edit';

  /* ---------- small controls ---------- */
  const errEl = {}, fieldEl = {};
  const changed = () => { if (!editing) saveDraft(me.id, f); refresh(); };
  const fld = (key, label, control, o) => {
    const opt = o || {};
    const err = h('div', { class: 'pip-err', id: 'err-' + key, hidden: true });
    errEl[key] = err;
    const wrap = h('div', { class: 'field' + (opt.wide ? ' wide' : ''), 'data-key': key },
      h('label', { for: 'f-' + key }, label, opt.req ? h('span', { class: 'pip-req', 'aria-hidden': 'true', text: ' *' }) : null),
      control, opt.hint ? h('div', { class: 'hint', text: opt.hint }) : null, err);
    fieldEl[key] = wrap;
    return wrap;
  };
  const text = (key, o) => {
    const opt = o || {};
    const el = h(opt.area ? 'textarea' : 'input', { class: 'txt' + (opt.cls ? ' ' + opt.cls : ''), id: 'f-' + key, type: opt.area ? null : (opt.type || 'text'), inputmode: opt.num ? 'numeric' : null, rows: opt.area ? '4' : null, autocomplete: 'off', maxlength: opt.max ? String(opt.max) : null, 'aria-describedby': 'err-' + key });
    el.value = f[key] === '' ? '' : String(f[key]);
    el.addEventListener('input', () => { f[key] = el.value; changed(); });
    return el;
  };
  /* whole dollars, shown with commas as you type (1,250,000); the form keeps the plain digits */
  const withCommas = digits => digits ? Number(digits).toLocaleString('en-US') : '';
  const dollars = key => {
    const el = h('input', { class: 'txt money-in', id: 'f-' + key, type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': 'err-' + key });
    f[key] = String(f[key]).replace(/\D/g, '');
    el.value = withCommas(f[key]);
    el.addEventListener('input', () => {
      // keep the cursor after the same digit it was after, once the commas move
      const before = el.value.slice(0, el.selectionStart).replace(/\D/g, '').length;
      const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);
      el.value = withCommas(digits);
      let pos = 0, seen = 0;
      while (pos < el.value.length && seen < before) { if (/\d/.test(el.value[pos])) seen++; pos++; }
      el.setSelectionRange(pos, pos);
      f[key] = digits;
      changed();
    });
    return h('span', { class: 'pip-money' }, h('span', { class: 'muted', text: '$' }), el);
  };
  const select = (key, options, prompt) => {
    const el = h('select', { class: 'txt', id: 'f-' + key, 'aria-describedby': 'err-' + key });
    const fill = opts => { el.textContent = ''; el.append(h('option', { value: '', text: prompt || 'Choose one' }), ...opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: String(v), text: l }); })); el.value = String(f[key]); };
    fill(options);
    el.addEventListener('change', () => { f[key] = el.value; changed(); });
    el.refill = fill;
    return el;
  };
  const seg = (key, options) => {
    const g = h('div', { class: 'seg pip-seg', role: 'group', id: 'f-' + key, 'aria-describedby': 'err-' + key });
    const draw = () => { for (const b of g.children) b.setAttribute('aria-pressed', String(b.dataset.v === f[key])); };
    for (const o of options) g.append(h('button', { type: 'button', 'data-v': o, text: o, onclick: () => { f[key] = o; draw(); changed(); } }));
    draw();
    return g;
  };
  /* a person, by typing: the list narrows as you type and only an exact pick from it counts (so it maps to one Vantagepoint employee) */
  const typed = {};
  const person = (key, codes) => {
    const listId = 'dl-' + key;
    const dl = h('datalist', { id: listId }, ...codes.map(c => h('option', { value: labelOf(c) })));
    const el = h('input', { class: 'txt', id: 'f-' + key, list: listId, autocomplete: 'off', placeholder: 'Start typing a name', 'aria-describedby': 'err-' + key });
    el.value = labelOf(f[key]);
    const byLabel = Object.fromEntries(codes.map(c => [labelOf(c), c]));
    el.addEventListener('input', () => { const c = byLabel[el.value.trim()]; f[key] = c || ''; typed[key] = c ? '' : el.value.trim(); changed(); });
    el.addEventListener('change', () => { if (f[key]) el.value = labelOf(f[key]); });
    return h('span', { class: 'pip-person' }, el, dl);
  };

  /* ---------- the four cards ---------- */
  const probSel = select('prob', [], 'Choose a stage first');
  const pursuit = card('Pursuit', 'What it is and where it stands.',
    fld('name', 'In Pursuit project name', text('name', { max: 200 }), { req: true, wide: true }),
    fld('stage', 'Stage', select('stage', lists.stages, 'Choose a stage'), { req: true, hint: 'Vantagepoint\'s stage. Closed stages (No Go, Lost, Cancelled) are not used at intake.' }),
    fld('prob', 'Probability', probSel, { req: true, hint: 'Only the values the stage allows.' }),
    fld('source', 'Source', select('source', lists.sources), { req: true }),
    fld('resp', 'Responsibility', select('resp', lists.resp, 'Choose our role'), { req: true }),
    fld('direct', 'Direct award', seg('direct', lists.yesNo), { req: true }));

  const clientIn = h('input', { class: 'txt', id: 'f-client', list: 'dl-client', autocomplete: 'off', placeholder: 'Start typing a client name', 'aria-describedby': 'err-client' });
  const clientDl = h('datalist', { id: 'dl-client' }, ...pk.clients.map(c => h('option', { value: c.name })));
  const clientByName = Object.fromEntries(pk.clients.map(c => [c.name, c.id]));
  clientIn.value = f.client && f.client !== P().NEW ? (clientById[f.client] || {}).name || '' : '';
  clientIn.addEventListener('input', () => { const id = clientByName[clientIn.value.trim()]; if (f.client !== P().NEW) { f.client = id || ''; typed.client = id ? '' : clientIn.value.trim(); } if (!id) f.contact = f.contact === P().NEW ? P().NEW : ''; changed(); });
  const newClientBtn = h('button', { type: 'button', class: 'linkbtn' });
  newClientBtn.addEventListener('click', () => {
    if (f.client === P().NEW) { f.client = ''; f.contact = ''; } else { f.client = P().NEW; f.contact = ''; typed.client = ''; clientIn.value = ''; }
    changed();
  });
  const contactSel = h('select', { class: 'txt', id: 'f-contact', 'aria-describedby': 'err-contact' });
  contactSel.addEventListener('change', () => { f.contact = contactSel.value; changed(); });
  const newClientBox = h('div', { class: 'pip-sub' },
    fld('newClientName', 'Client legal name', text('newClientName', { max: 200 }), { req: true }),
    fld('newClientAddr', 'Client main address', text('newClientAddr', { max: 300 })));
  const newContactBox = h('div', { class: 'pip-sub' },
    fld('ncName', 'Contact name', text('ncName', { max: 120 }), { req: true }),
    fld('ncEmail', 'Email', text('ncEmail', { type: 'email', max: 200 })),
    fld('ncPhone', 'Phone', text('ncPhone', { type: 'tel', max: 40 })),
    fld('ncAddr', 'Mailing address', text('ncAddr', { max: 300 })));
  const clientField = fld('client', 'Primary client', h('div', { class: 'pip-client' }, clientIn, clientDl, newClientBtn), { req: true, wide: true, hint: 'From Vantagepoint. Add a new client only if it is not in the list.' });
  const client = card('Client', 'Who the work is for.', clientField, newClientBox, fld('contact', 'Primary client contact', contactSel, { wide: true }), newContactBox);

  const scopeBox = h('div', { class: 'pip-scope wide' },
    h('div', { class: 'pip-scope-h' }, h('span', { class: 'chip blue', text: 'Needed for AIA 2030 reporting' }), h('span', { class: 'hint', text: 'Your best estimate is fine. If you do not know yet, choose Not sure and the sustainability team will follow up.' })),
    fld('hvac', 'Will our scope change the heating, cooling or ventilation systems?', seg('hvac', lists.hvac), { req: true, wide: true }),
    fld('env', 'About how much of the exterior walls and roof will our scope change?', seg('env', lists.env), { req: true, wide: true }),
    fld('light', 'Will we design the lighting?', seg('light', lists.light), { req: true, wide: true }));
  const siteBox = h('div', { class: 'pip-grid wide' },
    h('div', { class: 'wide hint', text: 'The project site: the building location, not the client\'s mailing address. Used for AIA 2030 reporting.' }),
    fld('street', 'Site street address', text('street', { max: 200 })), fld('city', 'City', text('city', { max: 100 })),
    fld('st', 'State', text('st', { max: 40 })), fld('zip', 'ZIP code', text('zip', { num: true, max: 10 })),
    fld('gsf', 'Estimated gross area (SF)', text('gsf', { num: true }), { hint: 'An estimate is fine.' }));
  const project = card('Project', 'What we will design and where.',
    fld('ptype', 'Project type', select('ptype', lists.ptypes), { req: true }),
    fld('deliv', 'Deliverable', select('deliv', lists.delivs), { req: true }),
    scopeBox,
    fld('desc', 'Project description', text('desc', { area: true, max: 4000 }), { req: true, wide: true }),
    siteBox,
    fld('budget', 'Construction budget', dollars('budget')),
    h('div', { class: 'wide lbl pip-dates-h', text: 'Pursuit dates (if known)' }),
    fld('rfpDate', 'RFP release', text('rfpDate', { type: 'date' })), fld('proposalDate', 'Proposal due', text('proposalDate', { type: 'date' })),
    fld('shortlistDate', 'Shortlist', text('shortlistDate', { type: 'date' })), fld('interviewDate', 'Interview', text('interviewDate', { type: 'date' })));

  const urgencyOut = h('span', { class: 'strong' });
  const feeWarn = h('div', { class: 'banner warn wide', hidden: true });
  const team = card('Team and fee', 'People come from Vantagepoint.',
    fld('office', 'Office', select('office', lists.offices), { req: true }),
    fld('principal', 'Principal', person('principal', pk.principals), { req: true }),
    fld('pm', 'Project manager', person('pm', pk.employees.map(e => e.code)), { req: true }),
    fld('pa', 'Project architect', person('pa', pk.architects || pk.employees.map(e => e.code)), { hint: pk.architects ? 'Licensed architects only.' : 'Only a licensed architect may be project architect.' }),
    fld('delivery', 'Delivery method', select('delivery', lists.methods), { req: true }),
    fld('comp', 'Compensation type', select('comp', lists.comps), { req: true }),
    fld('fee', 'Estimated fee (gross)', dollars('fee'), { req: true, hint: 'The whole fee, including consultants.' }),
    fld('mcv', 'Master contract value', dollars('mcv')),
    fld('start', 'Estimated start date', text('start', { type: 'date' }), { req: true }),
    fld('end', 'Estimated completion date', text('end', { type: 'date' }), { req: true }),
    feeWarn,
    h('div', { class: 'wide pip-calc' }, h('span', { class: 'lbl', text: 'Urgency' }), urgencyOut, h('span', { class: 'hint', text: 'Worked out from the start date. Nothing to enter.' })));

  const reviewBtn = h('button', { type: 'button', class: 'btn primary', text: 'Review' });
  const cancelLink = h('a', { class: 'btn quiet', href: editing ? '#/pip/' + pipId : '#/pip', text: 'Cancel' });
  const clearBtn = editing ? null : h('button', { type: 'button', class: 'btn quiet', text: 'Clear the form', onclick: () => { if (!confirm('Clear every answer on this form?')) return; dropDraft(me.id); body.textContent = ''; renderPipForm(ctx, body, null); } });
  const editMain = h('div', { class: 'stack' },
    restored ? banner('history', 'Your unsent PiP from before is back. Clear the form to start over.') : null,
    editing ? banner('corner-down-right', 'Returned: ' + ((existing.events.filter(e => e.action === 'return').pop() || {}).note || 'see the history on the PiP.'), 'warn') : null,
    pursuit, client, project, team,
    h('div', { class: 'pip-bar' }, clearBtn, h('span', { class: 'grow' }), cancelLink, reviewBtn));

  /* the side panel */
  const sideAia = h('div');
  const doneCount = h('span', { class: 'strong' });
  const bar = h('div', { class: 'pip-bar-fill' });
  const todo = h('div', { class: 'pip-todo' });
  const side = h('aside', { class: 'stack pip-side', 'aria-label': 'Where this PiP stands' }, sideAia,
    h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Ready to send' })),
      h('div', { class: 'sec-body' }, h('div', { class: 'pip-kv' }, h('span', { text: 'Required answers' }), doneCount), h('div', { class: 'pip-progress' }, bar), todo)));

  const main = h('div', { class: 'pip-main' }, editMain);
  body.append(h('div', { class: 'pip-layout' }, main, side));

  /* ---------- keeping everything in step ---------- */
  function card(title, sub, ...fields) {
    return h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: title }), h('p', { text: sub })), h('div', { class: 'sec-body pip-grid' }, ...fields));
  }
  const show = (el, on) => { el.hidden = !on; };
  const checkLists = () => ({ clients: pk.clients.map(c => ({ id: c.id, contacts: c.contacts.map(k => k.id) })), employees: pk.employees.map(e => e.code), principals: pk.principals, architects: pk.architects });
  function currentProblems() {
    const c = P().clean(f);
    const out = P().problems(c, { stageProbs: form.stageProbs, lists: checkLists() });
    // typed but not picked from the list: say that, instead of "required"
    const picks = ['client', 'principal', 'pm', 'pa'].filter(k => typed[k] && !(k === 'client' && f.client === P().NEW));
    return out.filter(p => !picks.includes(p.field)).concat(picks.map(k => ({ field: k, message: k === 'client' ? 'Pick the client from the list, or add a new client.' : 'Pick a name from the list.' })));
  }
  function refresh() {
    const pp = P();
    // probability follows the stage
    const allowed = pp.allowedProbs(f.stage, form.stageProbs);
    if (f.prob !== '' && !allowed.includes(Number(f.prob))) f.prob = '';
    if (allowed.length === 1) f.prob = String(allowed[0]);
    probSel.refill(allowed.map(p => [String(p), p + '%']));
    probSel.disabled = !allowed.length;
    probSel.firstChild.textContent = f.stage ? 'Choose a probability' : 'Choose a stage first';
    // client and contact
    const isNew = f.client === pp.NEW;
    clientIn.disabled = isNew;
    if (isNew) clientIn.value = '';
    newClientBtn.textContent = isNew ? 'Pick a client from Vantagepoint instead' : 'Client not in Vantagepoint? Add a new client';
    show(newClientBox, isNew);
    const cl = clientById[f.client];
    const contacts = isNew ? [] : cl ? cl.contacts : [];
    if (f.contact && f.contact !== pp.NEW && !contacts.some(k => k.id === f.contact)) f.contact = ''; // another client: its contacts only
    contactSel.textContent = '';
    contactSel.append(h('option', { value: '', text: isNew || cl ? 'No contact yet' : 'Choose a client first' }), ...contacts.map(k => h('option', { value: k.id, text: k.name })), h('option', { value: pp.NEW, text: 'New contact (not in Vantagepoint)' }));
    contactSel.value = f.contact;
    show(newContactBox, f.contact === pp.NEW);
    // AIA 2030 questions and the site block
    const qs = pp.scopeQuestions(f);
    for (const k of ['hvac', 'env', 'light']) { show(fieldEl[k], qs.includes(k)); if (!qs.includes(k)) f[k] = ''; }
    show(scopeBox, qs.length > 0);
    show(siteBox, pp.asksSite(f));
    // urgency and the CFO warning
    const u = pp.urgency(f.start, form.today);
    urgencyOut.textContent = u.value ? u.value + (u.note ? ` (${u.note.toLowerCase()})` : '') : u.note;
    const warns = pp.warnings(pp.clean(f), { cfoThreshold: form.cfoThreshold, today: form.today });
    const cfo = warns.find(w => w.key === 'cfo');
    feeWarn.textContent = ''; if (cfo) feeWarn.append(h('span', { class: 'bmsg' }, h('span', { html: T.icon('triangle-alert', 16) }), h('span', { text: cfo.message })));
    show(feeWarn, !!cfo);
    // the side panel
    const st = pp.aia2030(f);
    sideAia.replaceChildren(aiaGuide(h, st));
    const req = pp.requiredList(f), miss = pp.missing(pp.clean(f));
    doneCount.textContent = `${req.length - miss.length} of ${req.length}`;
    bar.style.width = Math.round(100 * (req.length - miss.length) / req.length) + '%';
    const probs = currentProblems();
    todo.replaceChildren(...(probs.length ? Object.keys(SECTION_LABEL).map(sec => {
      const mine = probs.filter(p => (req.find(r => r[0] === p.field) || [null, null, fieldSection(p.field)])[2] === sec);
      return mine.length ? h('div', {}, h('div', { class: 'lbl', text: SECTION_LABEL[sec] }), ...mine.map(p => h('button', { type: 'button', class: 'linkbtn pip-todo-item', text: p.message, onclick: () => focusField(p.field) }))) : null;
    }).filter(Boolean) : [h('div', { class: 'pip-ok' }, h('span', { html: T.icon('circle-check', 16) }), h('span', { text: 'Everything required is answered.' }))]));
    // errors under the fields, once someone has tried to review
    for (const [k, el] of Object.entries(errEl)) {
      const p = showErrors && probs.find(x => x.field === k);
      el.hidden = !p; el.textContent = p ? p.message : '';
      const input = fieldEl[k] && fieldEl[k].querySelector('.txt, .seg');
      if (input) input.setAttribute('aria-invalid', p ? 'true' : 'false');
    }
    reviewBtn.textContent = probs.length ? 'Review' : 'Review and submit';
  }
  function fieldSection(k) {
    if (['newClientName', 'newClientAddr', 'contact', 'ncName', 'ncEmail', 'ncPhone', 'ncAddr'].includes(k)) return 'client';
    if (['street', 'city', 'st', 'zip', 'gsf', 'budget', 'rfpDate', 'proposalDate', 'shortlistDate', 'interviewDate'].includes(k)) return 'project';
    if (['pa', 'mcv'].includes(k)) return 'team';
    return 'pursuit';
  }
  function focusField(k) {
    if (mode !== 'edit') toEdit();
    const el = document.getElementById('f-' + k);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); (el.tagName === 'DIV' ? el.querySelector('button') || el : el).focus({ preventScroll: true }); }
  }

  /* ---------- review and submit ---------- */
  function resolved() {
    const pp = P(), cl = clientById[f.client];
    const k = cl && cl.contacts.find(x => x.id === f.contact);
    return {
      client: f.client === pp.NEW ? (f.newClientName ? f.newClientName + ' (new client)' : '') : cl ? cl.name : '',
      clientAddress: f.client === pp.NEW ? f.newClientAddr : cl ? cl.address : '',
      contact: f.contact === pp.NEW ? (f.ncName ? f.ncName + ' (new contact)' : '') : k ? k.name : '',
      contactEmail: f.contact === pp.NEW ? f.ncEmail : k ? k.email : '', contactPhone: f.contact === pp.NEW ? f.ncPhone : k ? k.phone : '', contactAddress: f.contact === pp.NEW ? f.ncAddr : '',
      principal: labelOf(f.principal), pm: labelOf(f.pm), pa: labelOf(f.pa),
    };
  }
  function toEdit() { mode = 'edit'; main.replaceChildren(editMain); refresh(); }
  function toReview() {
    showErrors = true;
    refresh();
    const probs = currentProblems();
    if (probs.length) { focusField(probs[0].field); return; }
    mode = 'review';
    const notes = h('textarea', { class: 'txt', id: 'f-notes', rows: '3', maxlength: '4000' });
    notes.value = f.notes;
    notes.addEventListener('input', () => { f.notes = notes.value; if (!editing) saveDraft(me.id, f); });
    const msg = h('div');
    const send = h('button', { type: 'button', class: 'btn primary', text: editing ? 'Resubmit' : 'Submit' });
    send.addEventListener('click', async () => {
      send.disabled = true; msg.textContent = '';
      try {
        const out = editing ? await Pip.act(pipId, 'resubmit', { status: 'returned', fields: f }) : await Pip.submit(f);
        if (!editing) dropDraft(me.id);
        T.toast(editing ? 'Resubmitted. The PiP admins have it again.' : `PiP ${out.seq} sent. The PiP admins review it and create it in Vantagepoint.`);
        location.hash = '#/pip/' + (editing ? pipId : out.id);
      } catch (e) {
        send.disabled = false;
        if (e.body && e.body.problems) { toEdit(); showErrors = true; refresh(); focusField(e.body.problems[0].field); }
        msg.replaceChildren(banner('circle-alert', e.message, 'err'));
      }
    });
    main.replaceChildren(h('div', { class: 'stack' },
      h('section', { class: 'sec' },
        h('div', { class: 'sec-head' }, h('h2', { text: 'Review' }), h('p', { text: 'Check everything once more. The PiP admins see exactly this.' })),
        h('div', { class: 'sec-body' }, reviewSections(h, P().clean(f), resolved(), { today: form.today }),
          h('div', { class: 'field', style: 'margin-top:16px' }, h('label', { for: 'f-notes', text: 'Notes for the reviewers' }), notes,
            h('div', { class: 'hint', text: 'Anything they should know before creating it in Vantagepoint. Optional.' })))),
      msg,
      h('div', { class: 'pip-bar' }, h('button', { type: 'button', class: 'btn', text: 'Back to the form', onclick: toEdit }), h('span', { class: 'grow' }), send)));
    T.hydrateIcons(main);
    main.scrollIntoView({ block: 'start' });
  }
  reviewBtn.addEventListener('click', toReview);
  actions(body, null);
  refresh();
  T.hydrateIcons(body);
}
