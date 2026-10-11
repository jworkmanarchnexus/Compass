/* Calendar-date helpers on plain 'YYYY-MM-DD' strings, so no rule in Compass depends on a time zone. */
function parse(date) { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function fmt(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }

function addDays(date, n) { return fmt(parse(date) + n * 86400000); }
/* whole days from a to b (positive when b is later) */
function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
function isWeekday(date) { const wd = new Date(parse(date)).getUTCDay(); return wd !== 0 && wd !== 6; }
function year(date) { return Number(date.slice(0, 4)); }
function isValid(date) { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && fmt(parse(date)) === date; }
const max = (a, b) => (a > b ? a : b);
const min = (a, b) => (a < b ? a : b);

const datesApi = { addDays, daysBetween, isWeekday, year, isValid, max, min };
if (typeof module !== 'undefined' && module.exports) module.exports = datesApi;
else if (typeof window !== 'undefined') window.CompassTurnaround = Object.assign(window.CompassTurnaround || {}, { dates: datesApi });
