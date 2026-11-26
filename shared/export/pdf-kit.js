/* What every Compass PDF export needs: the fonts loaded in the browser, the logo as an image, the PDF library, and text helpers.
   Same approach as the Marketing Report's export (modules/bd/ui/export-draw.js, which still has its own copy of these):
   pages are painted through a 2D-context interface, on a canvas for the preview and on jsPDF's context2d for the PDF. */
import { LOGO, PDF_FONTS } from '/shared/export/assets.js';

export { LOGO, PDF_FONTS };
export const FONTS_CANVAS = { ui: 'Lato, Arial, sans-serif', cond: '"Roboto Condensed", "Arial Narrow", Arial, sans-serif' };
export const FONTS_PDF = { ui: 'Lato', cond: 'RobotoCondensed' };
export const fnt = (F, kind, size, bold) => (bold ? 'bold ' : '') + size + 'px ' + F[kind];

let fontsP = null;
export function fontsReady() {
  if (!fontsP) {
    const fs = document.fonts;
    fontsP = fs && fs.load ? Promise.all(['12px Lato', 'bold 12px Lato', '12px "Roboto Condensed"', 'bold 12px "Roboto Condensed"'].map(f => fs.load(f).catch(() => null))).catch(() => null) : Promise.resolve();
  }
  return fontsP;
}

let logoImg = null;
export const logo = () => logoImg;
export function loadLogo() {
  if (logoImg) return Promise.resolve(logoImg);
  return new Promise(res => {
    const im = new Image();
    im.onload = () => { logoImg = im; res(im); };
    im.onerror = () => res(null);
    im.src = LOGO.src;
    setTimeout(() => res(logoImg), 4000);
  });
}

let libP = null;
export function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
  if (!libP) libP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/shared/vendor/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf); s.onerror = () => { libP = null; rej(new Error('The PDF library did not load.')); };
    document.head.append(s);
  });
  return libP;
}

/* shorten to fit a width, with an ellipsis */
export function fitText(c, text, maxW) {
  text = String(text);
  if (maxW <= 0) return '';
  if (c.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s.length > 1 ? s + '…' : '';
}
/* wrap text to a width; a word longer than the width is cut to fit. maxLines 0 = no limit */
export function wrap(c, text, maxW, maxLines) {
  const lines = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? cur + ' ' + w : w;
      if (c.measureText(t).width <= maxW) cur = t;
      else { if (cur) lines.push(cur); cur = c.measureText(w).width <= maxW ? w : fitText(c, w, maxW); }
    }
    if (cur) lines.push(cur);
  }
  if (maxLines && lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = fitText(c, lines[maxLines - 1] + '…', maxW); }
  return lines;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDay = ymd => { const [y, m, dd] = String(ymd).slice(0, 10).split('-').map(Number); return MONTHS[m - 1] + ' ' + dd + ', ' + y; };

/* a canvas for measuring text before anything is painted (wrapping decides row heights, and so the page breaks) */
let mc = null;
export function measurer() { if (!mc) mc = document.createElement('canvas').getContext('2d'); return mc; }
