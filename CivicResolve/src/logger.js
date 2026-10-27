const fs = require('fs');
const path = require('path');
const cfg = require('./config');
fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
// Writable stream in append mode: one shared stream for all log lines.
const stream = fs.createWriteStream(path.join(cfg.DATA_DIR, 'app.log'), { flags: 'a' });
stream.on('error', (err) => console.error('Log stream error:', err.message));
function log(level, message) {
  stream.write(`${new Date().toISOString()} [${level}] ${message}\n`);
}
module.exports = { log };
