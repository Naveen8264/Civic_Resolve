const crypto = require('crypto');
const cfg = require('./config');
const storage = require('./storage');
const bus = require('./events');

class AppError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const DONE = ['Resolved', 'Closed'];

function validate(body) {
  const errors = [];
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = { title: s(body.title), description: s(body.description), category: s(body.category), location: s(body.location), contact: s(body.contact) };
  if (out.title.length < 3 || out.title.length > 120) errors.push('title must be 3-120 characters');
  if (out.description.length < 10 || out.description.length > 1000) errors.push('description must be 10-1000 characters');
  if (!cfg.CATEGORIES[out.category]) errors.push('category is not supported');
  if (out.location.length < 3 || out.location.length > 200) errors.push('location must be 3-200 characters');
  if (out.contact.length > 100) errors.push('contact must be at most 100 characters');
  if (errors.length) throw new AppError(400, 'Validation failed', errors);
  return out;
}
// SLA state is computed from real timestamps every time, never stored as a counter.
function sla(c, now = Date.now()) {
  const deadline = Date.parse(c.slaDeadline);
  if (DONE.includes(c.status)) return { overdue: false, met: Date.parse(c.resolvedAt) <= deadline, remainingMs: null };
  const remainingMs = deadline - now;
  return { overdue: remainingMs < 0, met: null, remainingMs };
}
// Public view: no internal UUID and no contact information.
function view(c, now) {
  const { id, contact, votes = [], ...rest } = c;
  const voteCount = votes.length;
  const basePriority = cfg.CATEGORIES[c.category].priority;
  const levels = ['Low', 'Medium', 'High', 'Critical'];
  const priority = levels[Math.min(levels.indexOf(basePriority) + Math.floor(voteCount / 5), levels.length - 1)];
  return { ...rest, voteCount, priority, sla: sla(c, now) };
}
async function create(body) {
  const v = validate(body);
  const rule = cfg.CATEGORIES[v.category];
  const images = Array.isArray(body.images) ? body.images.filter((image) => image && image.url) : [];
  const now = new Date();
  const c = await storage.update((list) => {
    const rec = {
      id: crypto.randomUUID(),
      referenceNumber: `CR-${now.getFullYear()}-${String(list.length + 1).padStart(6, '0')}`,
      ...v, department: rule.department, priority: rule.priority, status: 'Submitted',
      votes: [], images,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
      slaDeadline: new Date(now.getTime() + rule.slaHours * 3600000).toISOString(), resolvedAt: null,
      history: [{ from: null, to: 'Submitted', at: now.toISOString(), by: 'system', note: 'Complaint registered' }]
    };
    list.push(rec);
    return rec;
  });
  bus.emit('complaint:created', c);
  return view(c);
}
async function get(ref) {
  const c = (await storage.readAll()).find((x) => x.referenceNumber === ref);
  if (!c) throw new AppError(404, 'Complaint not found');
  return view(c);
}
async function list(q) {
  const all = await storage.readAll();
  const now = Date.now();
  const visible = all.filter((c) => !q.department || c.department === q.department);
  const stats = { total: all.length, overdue: 0 };
  for (const s of cfg.STATUSES) stats[s] = 0;
  stats.total = visible.length;
  visible.forEach((c) => { stats[c.status]++; if (sla(c, now).overdue) stats.overdue++; });
  let rows = visible.filter((c) => (!q.status || c.status === q.status) && (!q.category || c.category === q.category));
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limit = Math.min(Math.max(parseInt(q.limit) || 50, 1), 100);
  const page = Math.max(parseInt(q.page) || 1, 1);
  return { stats, total: rows.length, page, limit, items: rows.slice((page - 1) * limit, page * limit).map((c) => view(c, now)) };
}
async function publicFeed(voterId) {
  const all = await storage.readAll();
  const items = all.map((c) => ({ ...view(c), viewerHasVoted: Boolean(voterId && c.votes && c.votes.includes(voterId)) }))
    .sort((a, b) => b.voteCount - a.voteCount || b.createdAt.localeCompare(a.createdAt));
  const active = items.filter((c) => !DONE.includes(c.status));
  return {
    stats: {
      total: items.length,
      active: active.length,
      resolved: items.filter((c) => DONE.includes(c.status)).length,
      votes: items.reduce((sum, c) => sum + c.voteCount, 0)
    },
    items
  };
}
async function vote(ref, voterId) {
  if (typeof voterId !== 'string' || voterId.length < 16 || voterId.length > 100) {
    throw new AppError(400, 'A valid voter ID is required');
  }
  const c = await storage.update((all) => {
    const rec = all.find((x) => x.referenceNumber === ref);
    if (!rec) throw new AppError(404, 'Complaint not found');
    rec.votes = Array.isArray(rec.votes) ? rec.votes : [];
    if (!rec.votes.includes(voterId)) rec.votes.push(voterId);
    return rec;
  });
  bus.emit('complaint:voted', c);
  return view(c);
}
async function updateStatus(ref, body, role) {
  const next = typeof body.status === 'string' ? body.status : '';
  if (!cfg.STATUSES.includes(next)) throw new AppError(400, 'Validation failed', ['status is not supported']);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
  let from;
  const c = await storage.update((all) => {
    const rec = all.find((x) => x.referenceNumber === ref);
    if (!rec) throw new AppError(404, 'Complaint not found');
    from = rec.status;
    if (cfg.STATUSES.indexOf(next) <= cfg.STATUSES.indexOf(from)) throw new AppError(400, `Cannot change status from ${from} to ${next}`);
    const at = new Date().toISOString();
    rec.status = next; rec.updatedAt = at;
    if (next === 'Resolved') rec.resolvedAt = at;
    if (next === 'Closed' && !rec.resolvedAt) rec.resolvedAt = at;
    rec.history.push({ from, to: next, at, by: `demo-${role}`, note });
    return rec;
  });
  bus.emit('status:updated', c, from);
  return view(c);
}
module.exports = { AppError, create, get, list, publicFeed, vote, updateStatus, sla, validate };
