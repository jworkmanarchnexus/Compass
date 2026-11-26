/* A small rich-text box: bold, italic, bulleted list. What it makes is cleaned again on the server (an allowlist of a few tags),
   so this only has to be convenient, never safe. Showing stored text (already cleaned by the server) is done with showRich. */

export function richEditor(h, { html, editable, label }) {
  const box = h('div', { class: 'rich-box', contenteditable: editable ? 'true' : 'false', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label });
  box.innerHTML = html || '';
  const tool = (text, title, cmd) => h('button', { class: 'btn quiet sm', type: 'button', title, 'aria-label': title, text,
    onmousedown: e => e.preventDefault(), // keep the cursor in the box
    onclick: () => { box.focus(); document.execCommand(cmd); } });
  const el = h('div', { class: 'rich' },
    editable ? h('div', { class: 'rich-bar' }, tool('B', 'Bold', 'bold'), tool('I', 'Italic', 'italic'), tool('• List', 'Bulleted list', 'insertUnorderedList')) : null,
    box);
  return { el, html: () => box.innerHTML, text: () => box.textContent || '', box };
}

/* text the server has already cleaned */
export function showRich(h, html) {
  const el = h('div', { class: 'rich-show' });
  el.innerHTML = html || '';
  return el;
}
