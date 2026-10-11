'use strict';
/* LOCAL stand-in for the one automatic email. Instead of sending, it writes a text file to outbox/ (git-ignored).
   Production (how it sends is handoff open question 9) implements the same one method:
     sendToAdmin({ to: [addresses], subject, body })
   Rule: the only automatic email goes to the admin, and it holds a count and a link, never PIC or project data. */
const fs = require('node:fs');
const path = require('node:path');

function createFileMailer(dir) {
  const outDir = dir || path.join(__dirname, '..', 'outbox');
  return {
    sendToAdmin({ to, subject, body }) {
      fs.mkdirSync(outDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(outDir, `${stamp}.txt`);
      fs.writeFileSync(file, `To: ${to.join(', ')}\nSubject: ${subject}\n\n${body}\n`);
      return file;
    },
  };
}

module.exports = { createFileMailer };
