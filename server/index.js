'use strict';
const dbmod = require('./db/db');
const { seed } = require('./seed');
const { createServer } = require('./app');

const PORT = Number(process.env.PORT) || 5281; // the Toolbox uses 5280
const HOST = '127.0.0.1'; // local only: never bind to another interface

const db = dbmod.open();
if (!db.get('SELECT 1 AS x FROM users LIMIT 1')) {
  seed(db);
  console.log('Empty database: loaded the made-up seed data.');
}

createServer(db).listen(PORT, HOST, () => {
  console.log(`Compass running at http://localhost:${PORT} (this computer only). Ctrl+C to stop.`);
});
