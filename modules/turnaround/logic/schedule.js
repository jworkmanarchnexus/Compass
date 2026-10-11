/* ===== When the monthly run happens =====
   Pure, and takes plain 'YYYY-MM-DD' strings, so there are no time zones in it.
   The job passes the last CLOSED month (the one that just ended). Public holidays are not modelled:
   "first business day" means the first weekday, which is a simplification Kent can replace. */

/* the month before `date`, as YYYYMM */
function lastClosedPeriod(date) {
  const [y, m] = date.split('-').map(Number);
  return m === 1 ? (y - 1) * 100 + 12 : y * 100 + (m - 1);
}

function weekday(date) { // 0 = Sunday
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isFirstBusinessDay(date) {
  const d = Number(date.split('-')[2]);
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return false;
  if (d === 1) return true;
  return (d === 2 || d === 3) && wd === 1; // the 1st fell on a weekend, so Monday is the first weekday
}

/* 202609 -> 'September 2026' */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function periodLabel(period) { return `${MONTHS[(period % 100) - 1]} ${Math.floor(period / 100)}`; }

const scheduleApi = { lastClosedPeriod, isFirstBusinessDay, periodLabel };
if (typeof module !== 'undefined' && module.exports) module.exports = scheduleApi;
else if (typeof window !== 'undefined') window.CompassTurnaround = Object.assign(window.CompassTurnaround || {}, scheduleApi);
