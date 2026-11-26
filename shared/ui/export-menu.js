/* The Export button at the right of a page's title row: a small menu with Excel and PDF.
   exportMenu(ctx, { excel: () => ({ file, sheets }), pdf: () => void })
     excel  returns the file name and the sheets for window.Xlsx.buildXlsx (shared/export/xlsx.js); the file downloads.
     pdf    opens the page's own PDF export, or window.print() (the browser's "Save as PDF").
   Either may be left out. What is exported is what this person can see on the page; nothing extra is fetched. */

export function downloadBytes(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportMenu(ctx, { excel, pdf }) {
  const { h, icon, T } = ctx;
  const wrap = h('div', { class: 'menu-wrap' });
  const btn = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('download', 16), h('span', { text: 'Export' }));
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true });
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); document.removeEventListener('keydown', esc); };
  const outside = e => { if (!wrap.contains(e.target)) close(); };
  const esc = e => { if (e.key === 'Escape') { close(); btn.focus(); } };
  const item = (title, note, run) => h('button', { type: 'button', role: 'menuitem', onclick: () => { close(); try { run(); } catch (e) { T.toast(e.message || 'The export did not work.'); } } },
    h('span', {}, h('strong', { text: title }), h('small', { text: note })));
  if (excel) menu.append(item('Excel', 'A spreadsheet (.xlsx) of what is on this page', () => {
    const { file, sheets } = excel();
    downloadBytes(file, window.Xlsx.buildXlsx(sheets), window.Xlsx.MIME);
    T.toast('Downloaded ' + file);
  }));
  if (pdf) menu.append(item('PDF', 'Save this page as a PDF', pdf));
  btn.addEventListener('click', () => {
    if (!menu.hidden) return close();
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => { document.addEventListener('click', outside, true); document.addEventListener('keydown', esc); });
    const first = menu.querySelector('button'); if (first) first.focus();
  });
  wrap.append(btn, menu);
  return wrap;
}

/* a safe file name part: "September 2026" -> "September-2026" */
export const fileSafe = s => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
