const fs = require('fs/promises');
const path = require('path');
const cfg = require('./config');
const file = path.join(cfg.DATA_DIR, 'complaints.json');
let queue = Promise.resolve();

async function init() {
  await fs.mkdir(cfg.DATA_DIR, { recursive: true });
  try { await fs.access(file); } catch { await fs.writeFile(file, '[]'); }
}
async function readAll() { return JSON.parse(await fs.readFile(file, 'utf8')); }
// Updates run one after another so two requests cannot overwrite each other.
function update(fn) {
  const run = queue.then(async () => {
    const data = await readAll();
    const result = await fn(data);
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}
module.exports = { init, readAll, update };
