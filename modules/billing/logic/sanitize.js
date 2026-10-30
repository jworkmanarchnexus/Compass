/* ===== Billing: rich-text notes are cleaned on the server before they are stored =====
   Pure. Tested from tests/fixtures/sanitize.json. Only a few formatting tags survive, with every attribute removed; everything else
   (scripts, styles, links, images, event handlers, comments) is dropped, and plain text is escaped. Tags are balanced. */
'use strict';

const ALLOWED = ['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'ul', 'ol', 'li'];
const VOID = ['br'];
const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'title'];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* text typed as "&amp;" must not be escaped a second time; only the handful of entities we write ourselves are kept */
const unesc = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

function sanitize(html, maxLength) {
  const src = String(html == null ? '' : html).slice(0, maxLength || 20000);
  const parts = src.replace(/<!--[\s\S]*?-->/g, '').split(/(<\/?[a-zA-Z!?][^>]*>)/); // "1 < 2" is text, not a tag
  const out = [], stack = [];
  let skipping = null;
  for (const part of parts) {
    const tag = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>$/.exec(part);
    if (!tag) {
      if (skipping || /^<[^>]*>$/.test(part)) continue; // stray or malformed tag: dropped
      out.push(esc(unesc(part)));
      continue;
    }
    const closing = !!tag[1], name = tag[2].toLowerCase();
    if (skipping) { if (closing && name === skipping) skipping = null; continue; }
    if (DROP_WITH_CONTENT.includes(name)) { if (!closing) skipping = name; continue; }
    if (!ALLOWED.includes(name)) continue; // an unknown tag is removed but its text stays
    if (VOID.includes(name)) { if (!closing) out.push('<br>'); continue; }
    if (!closing) { stack.push(name); out.push('<' + name + '>'); continue; }
    const at = stack.lastIndexOf(name);
    if (at === -1) continue;
    while (stack.length > at) out.push('</' + stack.pop() + '>');
  }
  while (stack.length) out.push('</' + stack.pop() + '>');
  return out.join('');
}

/* the words of a note, for "is there anything written?" */
function plainText(html) {
  return unesc(String(html == null ? '' : html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const api = { sanitize, plainText };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBilling = Object.assign(window.CompassBilling || {}, api);
