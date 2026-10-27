const http = require('http');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const cfg = require('./src/config');
const storage = require('./src/storage');
const auth = require('./src/auth');
const bus = require('./src/events');
const { log } = require('./src/logger');
const { handle, sendJson } = require('./src/routes');

const PUBLIC = path.join(__dirname, 'public');
const UPLOAD_ROOT = cfg.UPLOADS_DIR;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// Static files are streamed; only files inside public/ or uploads/ can be served.
function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return sendJson(res, 400, { error: 'Bad request' }); }
  const uploadPath = rel.startsWith('/uploads/') ? path.join(UPLOAD_ROOT, rel.slice('/uploads/'.length)) : null;
  const file = uploadPath ? uploadPath : path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
  const safeRoot = uploadPath ? UPLOAD_ROOT : PUBLIC;
  if (!file.startsWith(safeRoot + path.sep) && file !== safeRoot) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'Not found' });
    const ext = path.extname(file).toLowerCase();
    const contentType = TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    const s = fs.createReadStream(file);
    s.on('error', () => res.destroy());
    s.pipe(res);
  });
}
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) await handle(req, res); else serveStatic(req, res);
    } catch (err) {
      if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.details && { details: err.details }) });
      bus.emit('request:error', `${req.method} ${req.url}: ${err.stack}`);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
}
module.exports = { createServer };
if (require.main === module) {
  storage.init().then(async () => {
    await fsPromises.mkdir(cfg.UPLOADS_DIR, { recursive: true });
    await auth.init();
    createServer().listen(cfg.PORT, () => { console.log(`CivicResolve running at http://localhost:${cfg.PORT}`); log('INFO', `server started on ${cfg.PORT}`); });
  }).catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
}
