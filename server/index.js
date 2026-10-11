'use strict';
const { createServer } = require('./app');

const PORT = Number(process.env.PORT) || 5281; // the Toolbox uses 5280
const HOST = '127.0.0.1'; // local only: never bind to another interface

createServer().listen(PORT, HOST, () => {
  console.log(`Compass running at http://localhost:${PORT} (this computer only). Ctrl+C to stop.`);
});
