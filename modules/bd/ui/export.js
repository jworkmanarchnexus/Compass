/* The BD report's Export PDF window: settings on the left, the real pages on the right, Download at the bottom.
   Same pattern as the Scheduler's export. The preview and the PDF are painted by the same code (export-draw.js). */
import { buildJob, pageCanvas, buildPdf, fontsReady, loadLogo } from './export-draw.js';

const X = window.BdExportPlan;
const DEFAULTS = { paper: 'letter', orientation: 'portrait', logo: 'all', printed: true };

function load(pref) {
  try {
    const o = JSON.parse(pref('bd.xo3') || '{}');
    return { ...DEFAULTS, ...o, desc: '' };
  } catch (e) { return { ...DEFAULTS, desc: '' }; }
}

export function openExport(ctx, d) {
  const { h, icon } = ctx;
  const pref = ctx.T.pref;
  const O = load(pref);
  const today = ctx.today ? ctx.today() : new Date().toISOString().slice(0, 10);
  const save = () => { const { desc, ...rest } = O; pref('bd.xo3', JSON.stringify(rest)); };

  const prev = h('div', { class: 'xw-prev', 'aria-live': 'polite' });
  const sum = h('span', { class: 'xw-sum' });
  const dl = h('button', { class: 'btn primary', type: 'button', text: 'Download PDF' });
  const msg = h('span', { class: 'xw-sum', role: 'alert' });
  let timer = null, gen = 0;

  async function draw() {
    const mine = ++gen;
    await fontsReady();
    if (O.logo !== 'none') await loadLogo();
    if (mine !== gen) return;
    const job = buildJob(d, O, today);
    prev.textContent = '';
    dl.disabled = false;
    const pxW = Math.min(1100, 760 * Math.max(1, window.devicePixelRatio || 1));
    for (let k = 0; k < job.count; k++) {
      const cv = pageCanvas(job, k, pxW);
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `Page ${k + 1} of ${job.count} of the exported report`);
      prev.append(h('div', { class: 'sheet' }, cv), h('p', { class: 'pnote', text: `Page ${k + 1} of ${job.count}${job.pages[k].s < 1 ? ' (shrunk to fit)' : ''}` }));
    }
    const small = job.pages.some(p => p.small);
    sum.textContent = `${job.count} page${job.count === 1 ? '' : 's'} · ${X.PAPER[O.paper].label}, ${O.orientation}` + (small ? ' · small print: try a bigger paper' : '');
  }
  const redraw = () => { save(); clearTimeout(timer); timer = setTimeout(draw, 80); };

  const seg = (key, items) => h('div', { class: 'seg', role: 'group' }, ...items.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(O[key] === v), text: t, onclick: e => { O[key] = v; [...e.currentTarget.parentNode.children].forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); redraw(); } })));
  const select = (key, items, label) => h('select', { class: 'txt', 'aria-label': label, onchange: e => { O[key] = e.target.value; redraw(); } }, ...items.map(([v, t]) => h('option', { value: v, text: t, selected: O[key] === v })));
  const check = (get, set, text) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: get(), onchange: e => { set(e.target.checked); redraw(); } }), h('span', { text }));

  const desc = h('textarea', { class: 'txt', rows: '3', style: 'height:auto;padding:8px 10px', 'aria-label': 'Description under the title', placeholder: 'Optional: a line or two under the title, for example who this is for', oninput: e => { O.desc = e.target.value; redraw(); } });

  const opts = h('div', { class: 'xw-opts' }, h('div', { class: 'xo-form' },
    h('fieldset', {}, h('legend', { text: 'Pages' }),
      h('p', { class: 'xo-note', text: 'Always two pages. Page 1: the PIC table and charts. Page 2: the market sector table and charts.' }),
      h('div', { class: 'xo-field' }, h('label', { text: 'Paper' }), select('paper', Object.entries(X.PAPER).map(([k, p]) => [k, p.label]), 'Paper')),
      h('div', { class: 'xo-field' }, h('label', { text: 'Orientation' }), seg('orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']]))),
    h('fieldset', {}, h('legend', { text: 'Heading and footer' }),
      h('div', { class: 'xo-field' }, h('label', { text: 'Arch Nexus logo, top right' }), select('logo', [['first', 'First page only'], ['all', 'Every page'], ['none', 'Not shown']], 'Logo')),
      check(() => O.printed, v => { O.printed = v; }, 'Print date in the footer'),
      h('div', { class: 'xo-field' }, h('label', { text: 'Description' }), desc))));

  const close = () => { gen++; root.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  const onKey = e => { if (e.key === 'Escape') close(); };
  dl.addEventListener('click', async () => {
    dl.disabled = true; msg.textContent = 'Building the PDF…';
    try {
      const { bytes } = await buildPdf(d, O, today);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = h('a', { href: url, download: `Marketing-report-${d.run.period}-v${d.run.version}.pdf` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      msg.textContent = 'Downloaded.';
    } catch (e) { msg.textContent = 'The PDF could not be built: ' + e.message; }
    dl.disabled = false;
  });

  const root = h('div', { class: 'xw', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export the Marketing Report as a PDF' },
    h('div', { class: 'xw-top' }, h('h2', { text: 'Export PDF' }), h('span', { class: 'xw-sum', text: d.run.label }), h('span', { class: 'grow' }),
      h('button', { class: 'btn quiet', type: 'button', text: 'Close', onclick: close })),
    h('div', { class: 'xw-main' }, opts, prev),
    h('div', { class: 'xw-foot' }, sum, h('span', { class: 'grow' }), msg, dl));
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  void icon;
  draw();
}
