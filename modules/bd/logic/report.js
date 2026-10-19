/* ===== The BD report: revenue against goal, by PIC and by market sector =====
   Pure: no database, clock or network. Money is whole cents. Mirrors the handoff spec (docs/01-product-spec.md, "BD report").

   Columns for each row:
     goal          annual revenue goal (architectural revenue, net of consultants)
     ytdGoal       the PACE: goal x months elapsed / 12 (rounded to the cent)
     ytd           revenue billed through the billing cutoff (last day of the previous month), this year
     forecast      contracted revenue still to be billed through Dec 31
     mwipRaw       pursuits not yet contracted, through Dec 31, at face value
     mwip          mwipRaw weighted by the MWIP factor in force (each pursuit weighted, rounded to the cent, then added)
     total         ytd + forecast + mwip      ("total projected")
   and, worked out when shown (never stored): % of pace billed = ytd / ytdGoal; % of goal = (ytd + forecast) / goal; and
   (ytd + forecast + mwip) / goal.

   Status (three labels, thresholds are Admin settings):
     On Track    (ytd + forecast + mwip) / goal  >=  onTrack%  (100)
     On Pace     otherwise, ytd >= onPace% (99) of pace, "but need more planned revenue"
     Behind Pace otherwise
   A row with no goal has no status. */

const { architecturalAmount } = require('./architectural');
const BP = 10000;

function pace(goal, months) { return Math.round(goal * months / 12); }

function statusOf({ goal, ytdGoal, ytd, total }, th) {
  if (!(goal > 0)) return null;
  if (total * 100 >= goal * th.onTrack) return 'on_track';
  if (ytd * 100 >= ytdGoal * th.onPace) return 'on_pace';
  return 'behind';
}

/* input:
     period       YYYYMM of the report; months elapsed = its month
     goals        { pic: { code: cents }, sector: { name: cents }, picOrder: [codes], sectorOrder: [names] }
     projects     { wbs1: { pic, sector } }   sector as the source gives it (may be blank or unknown)
     revenue      [{ wbs1, period, amount }]  net of consultants; only periods up to `period` of the same year count
     forecast     [{ wbs1, amount }]  or, when the source supplies the entered gross, [{ wbs1, gross, fee, consultFee, reimbAllow }]: the architectural share is then worked out here (logic/architectural.js)
     contractAmount  'feeConsult' (default) or 'feeConsultReimb': what "full contract amount" means for that share
     mwip         [{ id, pic, sector, amount }]   at face value
   output also has `lines`: [{ kind: 'ytd'|'forecast'|'mwip', id, pic, sector, amount }], every amount counted and where (for the drill-downs, logic/drill.js)
     factorBp     the MWIP factor in basis points (6700 = 0.67)
     thresholds   { onPace: 99, onTrack: 100 }
     sectors      [{ name, rollsInto, rollsUntil }]  a sector may roll into another until a date ('YYYY-MM-DD')
     overrides    { wbs1: sectorName }  the Admin's answer for a project whose sector is missing
     unknownTo    optional sector name: where revenue with no sector goes, instead of being held back as unassigned */
function computeBd(input) {
  const { period, goals, projects, revenue, mwip, factorBp, thresholds, sectors } = input;
  const overrides = input.overrides || {};
  // a forecast row with a gross amount and fees is scaled to its architectural share; a row with only an amount is already architectural
  const forecastNotes = [];
  const forecast = input.forecast.map(f => {
    if (f.gross === undefined) return f;
    const r = architecturalAmount(f, input.contractAmount || 'feeConsult');
    if (r.issue) forecastNotes.push({ wbs1: f.wbs1, issue: r.issue, amount: f.gross });
    return { wbs1: f.wbs1, amount: r.amount };
  });
  const months = period % 100, year = Math.floor(period / 100);
  const asOf = `${year}-${String(months).padStart(2, '0')}-28`; // a day inside the report month, for "until" dates
  const known = new Map(sectors.map(s => [s.name, s]));

  /* a project's market sector, after the Admin's choice and any roll-up; null = none */
  const rolled = new Map(); // "Labs>Healthcare" -> { from, into, ytd, forecast, mwip }
  const note = (from, into, field, amount) => {
    const k = `${from}>${into}`;
    if (!rolled.has(k)) rolled.set(k, { from, into, ytd: 0, forecast: 0, mwip: 0 });
    rolled.get(k)[field] += amount;
  };
  const resolve = (raw, wbs1) => {
    const name = overrides[wbs1] || raw;
    const s = known.get(name);
    if (!s) return input.unknownTo && known.has(input.unknownTo) ? { sector: input.unknownTo, from: null, defaulted: true } : { sector: null, from: null };
    if (s.rollsInto && s.rollsUntil && asOf <= s.rollsUntil) return { sector: s.rollsInto, from: s.name };
    return { sector: s.name, from: null };
  };

  const cell = () => ({ ytd: 0, forecast: 0, mwipRaw: 0, mwip: 0 });
  const byPic = new Map(), bySector = new Map();
  const get = (map, key) => { if (!map.has(key)) map.set(key, cell()); return map.get(key); };
  const unassigned = { sector: new Map(), pic: new Map() }; // wbs1 -> amount, for the Admin to resolve
  const assigned = new Map(), defaulted = new Map();         // wbs1 -> amount: what the Admin assigned, and what went to the default

  const lines = []; // everything counted, with the PIC and (rolled-up) sector it was counted under: the drill-downs are built from these
  const add = (wbs1, pic, rawSector, field, amount, mwipRaw) => {
    const { sector, from, defaulted: dflt } = resolve(rawSector, wbs1);
    lines.push({ kind: field, id: wbs1, pic: pic || '', sector: sector || '', amount });
    if (overrides[wbs1] && sector) assigned.set(wbs1, (assigned.get(wbs1) || 0) + amount);
    if (dflt) defaulted.set(wbs1, (defaulted.get(wbs1) || 0) + amount);
    const picKey = pic || '';
    const secKey = sector || '';
    for (const [map, key] of [[byPic, picKey], [bySector, secKey]]) {
      const c = get(map, key);
      if (field === 'mwip') { c.mwipRaw += mwipRaw; c.mwip += amount; } else c[field] += amount;
    }
    if (from) note(from, sector, field === 'mwip' ? 'mwip' : field, amount);
    if (!sector) unassigned.sector.set(wbs1, (unassigned.sector.get(wbs1) || 0) + amount);
    if (!picKey) unassigned.pic.set(wbs1, (unassigned.pic.get(wbs1) || 0) + amount);
  };

  for (const r of revenue) {
    if (Math.floor(r.period / 100) !== year || r.period > period) continue; // through the billing cutoff, this year only
    const p = projects[r.wbs1] || { pic: '', sector: '' };
    add(r.wbs1, p.pic, p.sector, 'ytd', r.amount);
  }
  for (const f of forecast) { const p = projects[f.wbs1] || { pic: '', sector: '' }; add(f.wbs1, p.pic, p.sector, 'forecast', f.amount); }
  for (const m of mwip) add(m.id, m.pic, m.sector, 'mwip', Math.round(m.amount * factorBp / BP), m.amount);

  const row = (key, label, c, goal) => {
    const ytdGoal = pace(goal, months);
    const total = c.ytd + c.forecast + c.mwip;
    return { key, label, goal, ytdGoal, ytd: c.ytd, forecast: c.forecast, mwipRaw: c.mwipRaw, mwip: c.mwip, total, status: statusOf({ goal, ytdGoal, ytd: c.ytd, total }, thresholds) };
  };

  const picKeys = (goals.picOrder || Object.keys(goals.pic)).concat([...byPic.keys()].filter(k => !(goals.picOrder || Object.keys(goals.pic)).includes(k) && k !== ''));
  const secKeys = (goals.sectorOrder || Object.keys(goals.sector)).concat([...bySector.keys()].filter(k => !(goals.sectorOrder || Object.keys(goals.sector)).includes(k) && k !== ''));
  const pics = picKeys.map(k => row(k, k, byPic.get(k) || cell(), goals.pic[k] || 0));
  const secs = secKeys.map(k => row(k, k, bySector.get(k) || cell(), goals.sector[k] || 0));
  if (byPic.has('')) pics.push(row('', 'Unassigned', byPic.get(''), 0));
  if (bySector.has('')) secs.push(row('', 'Unassigned', bySector.get(''), 0));

  const firmCell = cell();
  for (const c of byPic.values()) { firmCell.ytd += c.ytd; firmCell.forecast += c.forecast; firmCell.mwipRaw += c.mwipRaw; firmCell.mwip += c.mwip; }
  const firmGoal = Object.values(goals.pic).reduce((a, b) => a + b, 0);
  const firm = row('firm', 'Total firm', firmCell, firmGoal);

  return {
    months, firm, pic: pics, sector: secs,
    unassignedSector: [...unassigned.sector].map(([wbs1, amount]) => ({ wbs1, amount })),
    unassignedPic: [...unassigned.pic].map(([wbs1, amount]) => ({ wbs1, amount })),
    assigned: [...assigned].map(([wbs1, amount]) => ({ wbs1, sector: overrides[wbs1], amount })),
    defaulted: [...defaulted].map(([wbs1, amount]) => ({ wbs1, amount })),
    rolled: [...rolled.values()],
    forecastNotes, lines,
  };
}

module.exports = { pace, statusOf, computeBd };
