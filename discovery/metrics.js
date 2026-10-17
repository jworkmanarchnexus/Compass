'use strict';
/* Versioned registry of financial metric definitions, and the one calculation the owner has already fixed:
   whole-project consultant ratio.

     consultantRatio      = project ConsultFee / project contract fee        (from the PARENT record only; never parent + children)
     architecturalRevenue = gross recognized revenue x (1 - consultantRatio)  (the same ratio for every phase)
     computed per project BEFORE rolling up to PIC or market sector, one row per WBS1.

   What "contract fee" means is the one open question: discovery 002 says Fee + ConsultFee + ReimbAllow reproduced
   total contract fees on four benchmark projects, while the owner's note names only Fee and ConsultFee. The definition
   is therefore a named option, defaulted to the verified discovery, and the reconciliation against the Office Earnings
   "Consultants %" column decides it. It is never switched silently. */
const Dec = require('./lib/decimal');

const CONTRACT_FEE_DEFINITIONS = {
  'fee+consult+reimb': { fields: ['fee', 'consultFee', 'reimbAllow'], note: 'discovery 002: Fee + ConsultFee + ReimbAllow = total contract fee (4 benchmark projects)' },
  'fee+consult': { fields: ['fee', 'consultFee'], note: 'owner brief: Fee and ConsultFee only' },
  'fee': { fields: ['fee'], note: 'only valid if PR.Fee already includes consultants; unverified' },
  'total-contract-value': { fields: ['totalContractValue'], note: 'PR.TotalContractValue as stored by Vantagepoint; relation to Fee untested' },
};

/* project: { project, pic, sector, gross, fee, consultFee, reimbAllow }  amounts are Dec (BigInt) or null (missing).
   returns { rows, exceptions }. Nothing is dropped silently: every project lands in rows or exceptions. */
function architecturalRevenue(projects, { contractFee = 'fee+consult+reimb', onZeroFee = 'gross-flagged', rounding = 'none' } = {}) {
  const def = CONTRACT_FEE_DEFINITIONS[contractFee];
  if (!def) throw new Error('metrics: unknown contract fee definition');
  const rows = [], exceptions = [], seen = new Set();
  for (const p of projects) {
    if (seen.has(p.project)) { exceptions.push({ project: p.project, type: 'duplicate-project-row' }); continue; } // would double count
    seen.add(p.project);
    if (p.gross === null || p.gross === undefined) { exceptions.push({ project: p.project, type: 'missing-gross' }); continue; }
    if (def.fields.some(f => f !== 'reimbAllow' && (p[f] === null || p[f] === undefined))) { exceptions.push({ project: p.project, type: 'missing-fee-field' }); continue; }
    const fee = def.fields.reduce((s, f) => s + (p[f] ?? 0n), 0n); // reimbAllow may legitimately be null = 0
    const consult = p.consultFee ?? 0n;
    let arch, ratioNum, ratioDen;
    if (fee === 0n) {
      exceptions.push({ project: p.project, type: 'zero-contract-fee' });
      if (onZeroFee === 'exclude') continue;
      ratioNum = 0n; ratioDen = 1n; arch = p.gross; // cannot compute a ratio; revenue kept whole and flagged
    } else {
      if (fee < 0n || consult < 0n || consult > fee) exceptions.push({ project: p.project, type: 'ratio-out-of-range' });
      ratioNum = consult; ratioDen = fee;
      arch = Dec.mulDiv(p.gross, fee - consult, fee);
    }
    if (rounding === 'project-cents') arch = Dec.roundTo(arch, 2);
    rows.push({ project: p.project, pic: p.pic, sector: p.sector, gross: p.gross, consultant: p.gross - arch, amount: arch, ratioNum, ratioDen });
  }
  return { rows, exceptions };
}

function save(store, def) {
  const prev = store.knowledge.prepare('SELECT MAX(version) AS v FROM metrics WHERE name = ?').get(def.name).v || 0;
  const version = prev + 1;
  store.knowledge.prepare('INSERT INTO metrics (name, version, definition, status, last_validated) VALUES (?,?,?,?,?)').run(def.name, version, JSON.stringify(def), def.status || 'draft', null);
  store.audit('agent', 'metric.save', { name: def.name, version });
  return version;
}

/* a metric becomes 'reconciled' only through here, with the reconciliation result that earned it */
function markReconciled(store, name, version, evidence) {
  if (!evidence?.reconciled) throw new Error('metrics: cannot mark reconciled without a passing reconciliation');
  const row = store.knowledge.prepare('SELECT definition FROM metrics WHERE name = ? AND version = ?').get(name, version);
  if (!row) throw new Error('metrics: unknown metric version');
  const def = JSON.parse(row.definition);
  def.validationEvidence = { at: new Date(store.now()).toISOString(), requiredLevels: evidence.requiredLevels, referenceId: evidence.referenceId, referenceChecksum: evidence.referenceChecksum };
  store.knowledge.prepare("UPDATE metrics SET definition = ?, status = 'reconciled', last_validated = ? WHERE name = ? AND version = ?").run(JSON.stringify(def), store.now(), name, version);
  store.audit('agent', 'metric.reconciled', { name, version });
}

function approve(store, name, version) {
  const r = store.knowledge.prepare('SELECT status FROM metrics WHERE name = ? AND version = ?').get(name, version);
  if (r?.status !== 'reconciled') throw new Error('metrics: only a reconciled metric can be approved');
  store.knowledge.prepare("UPDATE metrics SET status = 'approved' WHERE name = ? AND version = ?").run(name, version);
  store.audit('owner', 'metric.approve', { name, version });
}

const get = (store, name, version = null) => {
  const r = version ? store.knowledge.prepare('SELECT * FROM metrics WHERE name = ? AND version = ?').get(name, version) : store.knowledge.prepare('SELECT * FROM metrics WHERE name = ? ORDER BY version DESC').get(name);
  return r && { name: r.name, version: r.version, status: r.status, lastValidated: r.last_validated ? new Date(r.last_validated).toISOString() : null, definition: JSON.parse(r.definition) };
};

/* the first metric: written down as a draft. It becomes reconciled only when a run proves it. */
const WHOLE_PROJECT_CONSULTANT_RATIO = {
  name: 'architectural-revenue-whole-project-ratio',
  businessDefinition: 'Gross recognized revenue less the consultant share, using one whole-project consultant ratio for every phase. Computed per project, then rolled up.',
  sourceTables: ['PR'], requiredFields: ['PR.WBS1', 'PR.WBS2', 'PR.WBS3', 'PR.Fee', 'PR.ConsultFee', 'PR.ReimbAllow', 'PR.Principal', 'PR.ProjectType'],
  relationships: [], calculation: 'archArev = gross x (fee_total - consultFee) / fee_total, fee and consultFee read from the parent PR row (WBS2 and WBS3 empty)',
  parameters: { contractFee: 'fee+consult+reimb', onZeroFee: 'gross-flagged', rounding: 'none' },
  openQuestions: ['Contract fee denominator: Fee+ConsultFee+ReimbAllow (discovery 002) or Fee+ConsultFee (owner brief)? Decided by reconciliation against Consultants % in Office Earnings.', 'Gross recognized revenue source not yet identified (LedgerAR section F, billInvSums I and PR.Revenue are unverified or failed).'],
  supportedDimensions: ['project', 'pic', 'sector'], cutoffLogic: 'report period YYYYMM, year-to-date from January', classificationBasis: 'unresolved: current vs as-of PIC and project type',
  knownExclusions: [], status: 'draft',
};

/* The method that reproduced the VP Office Earnings exports (July 2026). Draft until a run proves it; approved only by the owner. */
const OFFICE_EARNINGS_LEDGER_METHOD = {
  name: 'office-earnings-ledger-method',
  businessDefinition: 'Gross billed revenue, Direct Consultant and architectural revenue as the Vantagepoint Office Earnings report produces them, rebuilt from the ledgers: per parent project, year to date by posting period, then rolled up to PIC or market sector.',
  sourceTables: ['LedgerAR', 'LedgerAP', 'LedgerEX', 'LedgerMisc', 'CA', 'PR', 'EMMain', 'CFGProjectTypeDescriptions'],
  requiredFields: ['LedgerAR.TransType', 'LedgerAR.SubType', 'LedgerAR.Amount', 'LedgerAR.Period', 'LedgerAR.WBS1', 'LedgerAP/EX/Misc.Account, Amount, Period, WBS1', 'CA.Account, CA.Type', 'PR.WBS1, WBS2, WBS3, Principal, ProjectType', 'EMMain.Employee, LastName, FirstName'],
  relationships: ['LedgerAR.WBS1 = PR.WBS1 only on the parent row (WBS2 and WBS3 empty); aggregate the ledger by WBS1 first, never join ledger rows to all PR rows (fan-out)', 'ledger Account = CA.Account (unique)', 'PR.Principal = EMMain.Employee'],
  calculation: 'gross = -SUM(Amount) of LedgerAR rows with TransType IN and SubType not R, Period from January of the report year to the report period; consultant = SUM(Amount) of LedgerAP, LedgerEX and LedgerMisc rows on accounts with CA.Type 8 in the same periods; architectural = gross - consultant; all per project, then summed to PIC or sector',
  parameters: { period: 'YYYYMM report period', yearStart: 'January of the same year' },
  supportedDimensions: ['project', 'pic', 'sector'], cutoffLogic: 'posting Period (not transaction date); a report is only reproducible against the ledger as it stood when it was run, plus later postings to the same periods',
  classificationBasis: 'current PR.Principal and PR.ProjectType (as-of history not tested)',
  knownExclusions: ['retainage lines (SubType R)', 'projects that appear in the ledger but have no PR row (the report omits them)', 'account type 6 Reimbursable Consultant (including it breaks the match)'],
  openQuestions: ['Validated for one period (202607) and two exports; repeat for another period before approval.', 'Whole-project consultant ratio (owner rule) does not reproduce Direct Consultant; the ledger accrual is what VP reports.', 'Healthcare architectural cell in the BD workbook is hand edited; compared using the value the owner confirmed.'],
  status: 'draft',
};

module.exports = { OFFICE_EARNINGS_LEDGER_METHOD, CONTRACT_FEE_DEFINITIONS, architecturalRevenue, save, get, markReconciled, approve, WHOLE_PROJECT_CONSULTANT_RATIO };
