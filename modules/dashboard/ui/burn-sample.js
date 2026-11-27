/* Fee burn: MADE-UP SAMPLE PROJECTS, in the input shape of ../logic/burn.js, until the Vantagepoint copy carries the real
   ones (open question D2: monthly billed, labor and expenses; the overhead plan; the revenue forecast; planned hours and
   billing rates by month). Built the same way every time, so the page looks the same on every load. Money is cents. */

export const SAMPLE_MONTHS = { lastClosed: '2026-10', current: '2026-11' };

// wbs1, name, fee ($), start, end, spent per dollar billed (cost with overhead; above 1 means spending ahead of billing)
const DEFS = [
  ['2024-0207', 'Riverside Library Renovation', 1240000, '2024-03', '2027-06', 0.88],
  ['2024-0231', 'Mesa Ridge Elementary', 2150000, '2024-04', '2027-03', 1.08],
  ['2025-0104', 'Harbor Point Clinic', 860000, '2025-06', '2027-11', 0.90],
  ['2025-0119', 'Oak Hollow Senior Living', 1780000, '2025-05', '2028-02', 0.87],
  ['2025-0133', 'Canyon Road Housing', 1460000, '2025-03', '2028-05', 1.12],
  ['2026-0102', 'Lakeview Rec Center', 930000, '2026-08', '2028-01', 0.82],
];
const PM_ONES = ['2024-0207', '2024-0231', '2025-0133', '2026-0102'];
const PMS = ['Ana Ruiz', 'Alex Moreno', 'Jo Nakamura', 'Ravi Shah', 'Ana Ruiz', 'Jo Nakamura']; // made-up names, one per project
export const SAMPLE_PEOPLE = ['Lee Park', 'Jordan Cruz', 'Avery Kim', 'Sam Ortiz']; // who charged hours, for one project's Hours tab

const idx = m => { const [y, mm] = m.split('-').map(Number); return y * 12 + mm - 1; };
const mon = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const OVERHEAD = 150, SAMPLE_PCT = 85, RATES = [16500, 11000]; // billing rates in cents per hour: senior, staff

function build([wbs1, name, feeDollars, start, end, k], n) {
  const fee = feeDollars * 100, a = idx(start), b = idx(end), last = idx(SAMPLE_MONTHS.lastClosed), len = b - a + 1;
  const wob = i => 1 + 0.25 * Math.sin(i * 1.9 + n * 2.3);
  const curve = i => Math.sin(Math.PI * (i + 0.5) / len) * 0.8 + 0.4; // billing rises through the middle of the job
  const w = Array.from({ length: len }, (_, i) => curve(i) * wob(i)), tw = w.reduce((s, x) => s + x, 0);
  const actuals = [], forecast = [], plannedHours = [];
  let billedSoFar = 0;
  for (let i = 0; i < len && a + i <= last; i++) {
    const billed = Math.round(fee * w[i] / tw * 0.96);
    const spent = billed * k * (1 + 0.12 * Math.cos(i + n)), expenses = Math.round(billed * 0.04);
    actuals.push({ month: mon(a + i), billed, labor: Math.max(0, Math.round((spent - expenses) * 100 / (100 + OVERHEAD))), expenses });
    billedSoFar += billed;
  }
  const from = Math.max(a, last + 1) - a, rest = w.slice(from).reduce((s, x) => s + x, 0), left = Math.max(0, fee - billedSoFar);
  for (let i = from; i < len; i++) {
    const billed = Math.round(left * w[i] / rest);
    forecast.push({ month: mon(a + i), billed });
    const value = billed * k / (SAMPLE_PCT / 100) * (1 + 0.05 * Math.sin(i + n)); // billing value of the planned hours
    plannedHours.push({ month: mon(a + i), hours: Math.round(value * 0.4 / RATES[0] * 2) / 2, billRate: RATES[0] });
    plannedHours.push({ month: mon(a + i), hours: Math.round(value * 0.6 / RATES[1] * 2) / 2, billRate: RATES[1] });
  }
  // hours and receivables, also made up: hours from this year's labor at a flat made-up rate; AR from the last months billed
  const y0 = idx('2026-01'), yearLabor = actuals.filter(x => idx(x.month) >= y0).reduce((s, x) => s + x.labor, 0);
  const actualYtd = Math.round(yearLabor / 5200), planYtd = Math.round(actualYtd * (0.88 + 0.07 * ((n * 3) % 5)));
  const billedIn = m => (actuals.find(x => x.month === m) || { billed: 0 }).billed;
  const ar = { current: Math.round(billedIn('2026-10') * 0.85), d31: Math.round(billedIn('2026-09') * 0.3), d61: n % 2 ? Math.round(billedIn('2026-08') * 0.12) : 0, d91: n === 1 || n === 4 ? Math.round(billedIn('2026-07') * 0.08) : 0 };
  return { wbs1, name, pic: 'Dana Whitfield', pm: PMS[n], fee, start, end, overheadPct: OVERHEAD, actuals, forecast, plannedHours, hours: { planYtd, actualYtd }, ar };
}

const ALL = DEFS.map(build);
/* the sample projects on a dashboard: every one on the PIC dashboard, four on the PM dashboard */
export function sampleProjects(board) { return board === 'pm' ? ALL.filter(p => PM_ONES.includes(p.wbs1)) : ALL.slice(); }
export function sampleProject(board, wbs1) { return sampleProjects(board).find(p => p.wbs1 === wbs1) || null; }
