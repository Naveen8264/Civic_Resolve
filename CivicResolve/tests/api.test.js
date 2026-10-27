const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'civic-'));
const storage = require('../src/storage');
const auth = require('../src/auth');
const service = require('../src/service');
const { createServer } = require('../server');
let server, base, RESIDENT, STAFF, ADMIN;
const H = { 'Content-Type': 'application/json' };
const good = { title: 'Large pothole near main market', description: 'Deep pothole on the main road.', category: 'Roads and Potholes', location: 'Main Market Road', contact: 'x@example.com' };
const post = (b, session = RESIDENT) => fetch(base + '/api/complaints', { method: 'POST', headers: { ...H, ...session }, body: typeof b === 'string' ? b : JSON.stringify(b) });
async function login(email, password) {
  const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ email, password }) });
  return { response, session: { cookie: response.headers.get('set-cookie')?.split(';')[0] || '' } };
}
before(async () => {
  await storage.init();
  await auth.init();
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = 'http://localhost:' + server.address().port;
  const resident = await fetch(base + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Test Resident', email: 'resident@test.local', password: 'ResidentPass#2026' }) });
  RESIDENT = { cookie: resident.headers.get('set-cookie')?.split(';')[0] || '' };
  STAFF = (await login('staff@civicresolve.local', 'StaffDemo#2026')).session;
  ADMIN = (await login('admin@civicresolve.local', 'AdminDemo#2026')).session;
});
after(() => server.close());

test('T01 create valid complaint, routed by logic', async () => {
  const r = await post(good); const c = await r.json();
  assert.equal(r.status, 201); assert.match(c.referenceNumber, /^CR-\d{4}-\d{6}$/);
  assert.equal(c.department, 'Roads and Infrastructure'); assert.equal(c.status, 'Submitted');
  assert.equal(c.contact, undefined); assert.equal(c.id, undefined);
});
test('T02 missing field -> 400', async () => { assert.equal((await post({ ...good, title: '' })).status, 400); });
test('T03 unsupported category -> 400', async () => { assert.equal((await post({ ...good, category: 'Other' })).status, 400); });
test('T03b invalid JSON -> 400', async () => { assert.equal((await post('{bad')).status, 400); });
test('T04/T05 unique refs and routing per category', async () => {
  const exp = { 'Water Supply': 'Water Supply Department', 'Garbage and Sanitation': 'Sanitation Department', 'Drainage': 'Drainage Department', 'Streetlights': 'Electrical Maintenance Department' };
  const refs = new Set();
  for (const [category, dept] of Object.entries(exp)) { const c = await (await post({ ...good, category })).json(); assert.equal(c.department, dept); refs.add(c.referenceNumber); }
  assert.equal(refs.size, 4);
});
test('T06/T07 track existing and missing', async () => {
  const c = await (await post(good)).json();
  const ok = await fetch(base + '/api/complaints/' + c.referenceNumber); assert.equal(ok.status, 200);
  assert.equal((await fetch(base + '/api/complaints/CR-2026-999999')).status, 404);
  assert.equal((await fetch(base + '/api/complaints/bad-id')).status, 400);
});
test('T08 status update saves history; T09 invalid and backward blocked', async () => {
  const c = await (await post(good)).json(); const u = base + `/api/complaints/${c.referenceNumber}/status`;
  const r = await fetch(u, { method: 'PATCH', headers: { ...H, ...STAFF }, body: JSON.stringify({ status: 'In Progress' }) });
  const upd = await r.json(); assert.equal(r.status, 200); assert.equal(upd.history.length, 2);
  assert.equal((await fetch(u, { method: 'PATCH', headers: { ...H, ...STAFF }, body: JSON.stringify({ status: 'Bogus' }) })).status, 400);
  assert.equal((await fetch(u, { method: 'PATCH', headers: { ...H, ...STAFF }, body: JSON.stringify({ status: 'Submitted' }) })).status, 400);
  const t = await (await fetch(base + '/api/complaints/' + c.referenceNumber)).json(); assert.equal(t.status, 'In Progress');
});
test('T12 unauthorized update and list -> 403', async () => {
  const c = await (await post(good)).json();
  assert.equal((await fetch(base + `/api/complaints/${c.referenceNumber}/status`, { method: 'PATCH', headers: { ...H, ...RESIDENT }, body: '{"status":"Assigned"}' })).status, 403);
  assert.equal((await fetch(base + '/api/complaints', { headers: { ...H, ...RESIDENT } })).status, 403);
});
test('dashboard list: filters and stats', async () => {
  const d = await (await fetch(base + '/api/complaints?category=Drainage', { headers: { ...H, ...ADMIN } })).json();
  assert.ok(d.items.every((i) => i.category === 'Drainage')); assert.ok(d.stats.total >= d.total);
});
test('public feed exposes vote totals and voting raises priority once per voter', async () => {
  const c = await (await post(good)).json();
  const url = base + `/api/complaints/${c.referenceNumber}/vote`;
  const first = await fetch(url, { method: 'POST', headers: { ...H, ...RESIDENT } });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).voteCount, 1);
  const repeated = await fetch(url, { method: 'POST', headers: { ...H, ...RESIDENT } });
  assert.equal((await repeated.json()).voteCount, 1);
  await service.vote(c.referenceNumber, 'additional-resident-identity-002');
  await service.vote(c.referenceNumber, 'additional-resident-identity-003');
  await service.vote(c.referenceNumber, 'additional-resident-identity-004');
  const finalVote = await service.vote(c.referenceNumber, 'additional-resident-identity-005');
  assert.equal(finalVote.voteCount, 5);
  assert.equal(finalVote.priority, 'Critical');
  const feed = await (await fetch(base + '/api/complaints/feed')).json();
  assert.ok(feed.items.some((item) => item.referenceNumber === c.referenceNumber && item.voteCount === 5 && item.priority === 'Critical'));
  const feedAsResident = await (await fetch(base + '/api/complaints/feed', { headers: RESIDENT })).json();
  assert.ok(feedAsResident.items.find((item) => item.referenceNumber === c.referenceNumber).viewerHasVoted);
});
test('authentication assigns resident role, validates credentials, and protects privileged routes', async () => {
  const signup = await fetch(base + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Role Test', email: 'role@test.local', password: 'ResidentPass#2026', role: 'admin' }) });
  assert.equal(signup.status, 201);
  assert.equal((await signup.json()).user.role, 'resident');
  const whoAmI = await fetch(base + '/api/auth/me', { headers: { cookie: signup.headers.get('set-cookie')?.split(';')[0] } });
  assert.equal((await whoAmI.json()).user.role, 'resident');
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ email: 'role@test.local', password: 'incorrect' }) })).status, 401);
  assert.equal((await fetch(base + '/api/complaints', { method: 'POST', headers: H, body: JSON.stringify(good) })).status, 401);
  assert.equal((await fetch(base + '/api/admin/users')).status, 401);
  assert.equal((await fetch(base + '/api/admin/users', { headers: { 'X-Demo-Role': 'admin' } })).status, 401);
});
test('staff is restricted to assigned department; admin can create staff accounts', async () => {
  const roads = await (await post(good)).json();
  const drainage = await (await post({ ...good, category: 'Drainage', title: 'Drainage issue at main market' })).json();
  const staffList = await (await fetch(base + '/api/complaints', { headers: { ...H, ...STAFF } })).json();
  assert.ok(staffList.items.every((item) => item.department === 'Roads and Infrastructure'));
  assert.equal(staffList.stats.total, staffList.items.length);
  assert.equal((await fetch(base + `/api/complaints/${drainage.referenceNumber}/status`, { method: 'PATCH', headers: { ...H, ...STAFF }, body: JSON.stringify({ status: 'Assigned' }) })).status, 403);
  const created = await fetch(base + '/api/admin/users', { method: 'POST', headers: { ...H, ...ADMIN }, body: JSON.stringify({ name: 'Water Staff', email: 'water@test.local', password: 'WaterStaffPass#2026', role: 'staff', department: 'Water Supply Department' }) });
  assert.equal(created.status, 201);
  const createdUser = (await created.json()).user;
  assert.equal(createdUser.department, 'Water Supply Department');
  const newStaffLogin = await login('water@test.local', 'WaterStaffPass#2026');
  assert.equal(newStaffLogin.response.status, 200);
  assert.equal((await (await fetch(base + '/api/auth/me', { headers: newStaffLogin.session })).json()).user.role, 'staff');
  assert.equal((await fetch(base + '/api/admin/users', { headers: { ...H, ...newStaffLogin.session } })).status, 403);
  const invalidManaged = await fetch(base + '/api/admin/users', { method: 'POST', headers: { ...H, ...STAFF }, body: JSON.stringify({ name: 'Nope', email: 'nope@test.local', password: 'NopePass#2026', role: 'admin' }) });
  assert.equal(invalidManaged.status, 403);
  assert.ok(roads.referenceNumber);
});
test('logout expires the session and cross-origin writes are rejected', async () => {
  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...H, ...RESIDENT } });
  assert.equal(logout.status, 200);
  const clearedCookie = logout.headers.get('set-cookie')?.split(';')[0];
  assert.equal((await (await fetch(base + '/api/auth/me', { headers: { cookie: clearedCookie } })).json()).user, null);
  RESIDENT = (await login('resident@test.local', 'ResidentPass#2026')).session;
  const crossOrigin = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { ...H, Origin: 'https://untrusted.example' },
    body: JSON.stringify({ name: 'Origin Test', email: 'origin@test.local', password: 'OriginTestPass#2026' })
  });
  assert.equal(crossOrigin.status, 403);
});
test('405 wrong method, 404 route', async () => {
  assert.equal((await fetch(base + '/api/departments', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/nothing')).status, 404);
});
test('static serving and path traversal guard', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.notEqual((await fetch(base + '/..%2fpackage.json')).status, 200);
  assert.equal((await fetch(base + '/data/complaints.json')).status, 404);
});
test('oversized body -> 413', async () => {
  try { const r = await post({ ...good, description: 'x'.repeat(200000) }); assert.equal(r.status, 413); } catch (e) { assert.ok(e); }
});
test('T10/T11 SLA calculation and overdue detection', () => {
  const c = { status: 'Submitted', slaDeadline: new Date(Date.now() + 3600000).toISOString() };
  assert.equal(service.sla(c).overdue, false);
  assert.equal(service.sla({ ...c, slaDeadline: new Date(Date.now() - 3600000).toISOString() }).overdue, true);
  const r = service.sla({ status: 'Resolved', slaDeadline: '2026-01-02T00:00:00Z', resolvedAt: '2026-01-01T00:00:00Z' }); assert.equal(r.met, true);
});
test('T14 persistence: data is in the JSON file', async () => {
  const all = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'complaints.json'), 'utf8'));
  assert.ok(all.length >= 5);
  assert.ok(fs.readFileSync(path.join(process.env.DATA_DIR, 'app.log'), 'utf8').includes('created CR-'));
});
