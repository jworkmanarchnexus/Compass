/* Number and date wording, in one place so every screen says things the same way.
   Money arrives as whole cents. Negative numbers always carry a minus sign: colour is never the only signal. */

/* -96800.00 dollars shown as whole dollars: -$96,800 */
export const fmtCents = c => (c < 0 ? '-$' : '$') + Math.abs(Math.round(c / 100)).toLocaleString('en-US');
/* a number of dollars (not cents): $58,000 */
export const fmtDollars = d => (d < 0 ? '-$' : '$') + Math.abs(Math.round(d)).toLocaleString('en-US');
/* in thousands, for charts: -$450K */
export const fmtK = c => { const k = Math.round(c / 100000); return k === 0 ? '$0' : (k < 0 ? '-$' : '+$') + Math.abs(k).toLocaleString('en-US') + 'K'; };
/* a percentage that is already a number: -18.5% (or a dash when there is nothing to divide) */
export const fmtPctNum = p => (p === null || p === undefined || Number.isNaN(p) ? '-' : (p < 0 ? '-' : p > 0 ? '+' : '') + Math.abs(p).toFixed(1) + '%');
/* the same, for a loss on a project row: -18.5% (no plus sign) */
export const fmtLoss = p => (p === null || p === undefined ? '-' : (p < 0 ? '-' : '') + Math.abs(p).toFixed(1) + '%');
export const fmtWholePct = p => (p === null || p === undefined ? '-' : Math.round(p) + '%');
/* $2.92M for a big total */
export const fmtM = c => { const d = Math.abs(c) / 100; return d >= 1e6 ? '$' + (d / 1e6).toFixed(2) + 'M' : '$' + Math.round(d).toLocaleString('en-US'); };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/* '2026-10-07' -> 'Oct 7' */
export const fmtDay = d => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}` : '');
/* 202609 -> 'September 2026', and the one-letter month for chart axes */
export const fmtPeriod = p => `${MONTHS_LONG[(p % 100) - 1]} ${Math.floor(p / 100)}`;
export const monthLetter = p => 'JFMAMJJASOND'[(p % 100) - 1];
export const monthName = p => MONTHS_LONG[(p % 100) - 1];
/* ms -> '4:12 p.m.' */
export const fmtClock = ms => {
  const d = new Date(ms); const h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'a.m.' : 'p.m.'}`;
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const wdOf = d => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))).getUTCDay();
/* '2026-10-07' -> 'Wednesday, October 7' and 'Wed Oct 7' */
export const fmtWeekdayLong = d => `${WEEKDAYS[wdOf(d)]}, ${MONTHS_LONG[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
export const fmtDayWd = d => `${WEEKDAYS[wdOf(d)].slice(0, 3)} ${fmtDay(d)}`;
/* '2026-09-30' -> 'Sep 30, 2026' */
export const fmtDayYear = d => `${fmtDay(d)}, ${d.slice(0, 4)}`;
/* ms -> 'Oct 1 at 6:00 a.m.' (the browser's own time zone) */
const msToDay = ms => { const t = new Date(ms); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
export const fmtWhen = ms => `${fmtDay(msToDay(ms))} at ${fmtClock(ms)}`;
export const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
