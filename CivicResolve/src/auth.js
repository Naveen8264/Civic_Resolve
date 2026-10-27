const crypto = require('crypto');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs/promises');
const cfg = require('./config');
const { AppError } = require('./service');
const scrypt = promisify(crypto.scrypt);
const usersFile = path.join(cfg.DATA_DIR, 'users.json');
const sessions = new Map();
const attempts = new Map();
let accountQueue = Promise.resolve();
const SESSION_MS = 8 * 60 * 60 * 1000;
const DEMO_USERS = [
  { name: 'CivicResolve Administrator', email: process.env.DEMO_ADMIN_EMAIL || 'admin@civicresolve.local', password: process.env.DEMO_ADMIN_PASSWORD || 'AdminDemo#2026', role: 'admin', department: null },
  { name: 'Roads Department Staff', email: process.env.DEMO_STAFF_EMAIL || 'staff@civicresolve.local', password: process.env.DEMO_STAFF_PASSWORD || 'StaffDemo#2026', role: 'staff', department: 'Roads and Infrastructure' },
  { name: 'CivicResolve Resident', email: process.env.DEMO_RESIDENT_EMAIL || 'resident@civicresolve.local', password: process.env.DEMO_RESIDENT_PASSWORD || 'ResidentDemo#2026', role: 'resident', department: null }
];

async function readUsers() {
  return JSON.parse(await fs.readFile(usersFile, 'utf8'));
}
async function writeUsers(users) {
  const temporary = usersFile + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(users, null, 2), { mode: 0o600 });
  await fs.rename(temporary, usersFile);
}
async function makeUser(input) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(input.password, salt, 64);
  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    salt,
    passwordHash: hash.toString('hex'),
    role: input.role,
    department: input.department || null,
    createdAt: new Date().toISOString()
  };
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department };
}
function validateAccount(input, allowPrivileged) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (name.length < 2 || name.length > 80) throw new AppError(400, 'Name must be 2–80 characters');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'Enter a valid email address');
  if (password.length < 10 || password.length > 128) throw new AppError(400, 'Password must be 10–128 characters');
  let role = 'resident';
  let department = null;
  if (allowPrivileged) {
    if (!['staff', 'admin'].includes(input.role)) throw new AppError(400, 'Role must be staff or admin');
    role = input.role;
    if (role === 'staff') {
      if (!Object.values(cfg.CATEGORIES).some((category) => category.department === input.department)) {
        throw new AppError(400, 'Choose a valid department for staff');
      }
      department = input.department;
    }
  }
  return { name, email, password, role, department };
}
async function init() {
  await fs.mkdir(cfg.DATA_DIR, { recursive: true });
  try { await fs.access(usersFile); } catch { await fs.writeFile(usersFile, '[]', { mode: 0o600 }); }
  const users = await readUsers();
  let changed = false;
  for (const demo of DEMO_USERS) {
    if (!users.some((user) => user.email === demo.email.toLowerCase())) {
      users.push(await makeUser(demo));
      changed = true;
    }
  }
  if (changed) await writeUsers(users);
}
function clientAddress(req) {
  return req.socket.remoteAddress || 'unknown';
}
function checkLoginRate(req, email) {
  const key = `${clientAddress(req)}:${email}`;
  const current = attempts.get(key);
  if (current && current.until > Date.now() && current.count >= 8) throw new AppError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  if (!current || current.until <= Date.now()) attempts.set(key, { count: 1, until: Date.now() + 15 * 60 * 1000 });
  else current.count++;
  return key;
}
function startSession(user, res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_MS });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `civicresolve_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`);
  return publicUser(user);
}
function getToken(req) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('civicresolve_session='));
  return entry ? entry.slice('civicresolve_session='.length) : '';
}
async function currentUser(req) {
  const token = getToken(req);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = (await readUsers()).find((candidate) => candidate.id === session.userId);
  return user ? publicUser(user) : null;
}
async function login(req, res, input) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const key = checkLoginRate(req, email);
  const user = (await readUsers()).find((candidate) => candidate.email === email);
  const salt = user ? user.salt : 'civicresolve-unknown-account';
  const hash = await scrypt(typeof input.password === 'string' ? input.password : '', salt, 64);
  const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
  if (!user || hash.length !== expected.length || !crypto.timingSafeEqual(hash, expected)) {
    throw new AppError(401, 'Email or password is incorrect');
  }
  attempts.delete(key);
  return startSession(user, res);
}
async function register(input, res) {
  const data = validateAccount(input, false);
  return addAccount(data, true, res);
}
async function createManagedUser(input) {
  const data = validateAccount(input, true);
  return addAccount(data, false);
}
async function addAccount(data, createSession, res) {
  const run = accountQueue.then(async () => {
    const users = await readUsers();
    if (users.some((user) => user.email === data.email)) throw new AppError(409, 'An account with this email already exists');
    const user = await makeUser(data);
    users.push(user);
    await writeUsers(users);
    return createSession ? startSession(user, res) : publicUser(user);
  });
  accountQueue = run.catch(() => {});
  return run;
}
async function listUsers() {
  return (await readUsers()).map(publicUser);
}
function logout(req, res) {
  const token = getToken(req);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'civicresolve_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}
module.exports = { init, login, register, logout, currentUser, createManagedUser, listUsers, publicUser, DEMO_USERS: DEMO_USERS.map(({ name, email, role, department }) => ({ name, email, role, department })) };
