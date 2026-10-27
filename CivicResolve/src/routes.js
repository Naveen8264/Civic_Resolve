const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const service = require('./service');
const auth = require('./auth');
const { AppError } = service;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readRequestBytes(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > cfg.MAX_BODY) {
        reject(new AppError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartForm(req) {
  return new Promise(async (resolve, reject) => {
    try {
      const contentType = req.headers['content-type'] || '';
      const match = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
      if (!match) return reject(new AppError(400, 'Invalid multipart form data'));

      const boundary = (match[1] || match[2]).trim();
      const body = await readRequestBytes(req);
      const text = body.toString('latin1');
      const sections = [];

      for (const raw of text.split(`--${boundary}`)) {
        if (!raw || raw.trim() === '' || raw.trim() === '--') continue;
        const normalized = raw.replace(/^\r\n/, '').replace(/\r\n$/, '');
        const divider = normalized.indexOf('\r\n\r\n');
        if (divider === -1) continue;

        const headersText = normalized.slice(0, divider);
        let content = normalized.slice(divider + 4);
        if (content.endsWith('\r\n')) content = content.slice(0, -2);
        if (content.endsWith('--')) content = content.slice(0, -2);

        sections.push({ headersText, content });
      }

      const parsed = { complaint: null, photos: [] };

      for (const section of sections) {
        const disposition = /name="([^"]+)"(?:;\s*filename="([^"]+)")?/i.exec(section.headersText);
        if (!disposition) continue;

        const fieldName = disposition[1];
        const fileName = disposition[2];

        if (fieldName === 'complaint') {
          const value = section.content.trim();
          if (!value) continue;
          parsed.complaint = JSON.parse(value);
        } else if (fieldName === 'photos' && fileName) {
          parsed.photos.push({
            fileName,
            content: Buffer.from(section.content, 'latin1'),
            headers: section.headersText,
          });
        }
      }

      resolve(parsed);
    } catch (error) {
      reject(error instanceof Error && error.name === 'SyntaxError' ? new AppError(400, 'Invalid complaint payload') : error);
    }
  });
}

async function saveUploadedPhotos(photos) {
  const list = Array.isArray(photos) ? photos : [];
  if (!list.length) return [];
  if (list.length > cfg.MAX_PHOTOS) throw new AppError(400, `You can attach up to ${cfg.MAX_PHOTOS} photos.`);

  await fs.mkdir(cfg.UPLOADS_DIR, { recursive: true });
  const saved = [];
  for (const photo of list) {
    const contentType = /Content-Type:\s*([^;\r\n]+)/i.exec(photo.headers || '')?.[1]?.trim().toLowerCase() || '';
    if (!contentType || !cfg.ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new AppError(400, 'Only JPG, PNG, and WebP images are allowed.');
    }
    if (photo.content.length > cfg.MAX_PHOTO_BYTES) {
      throw new AppError(413, 'Each uploaded image must be 5 MB or smaller.');
    }

    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[contentType] || '.png';
    const fileName = `${crypto.randomUUID()}${extension}`;
    await fs.writeFile(path.join(cfg.UPLOADS_DIR, fileName), photo.content);
    saved.push({ url: `/uploads/${fileName}`, name: photo.fileName || fileName, size: photo.content.length, contentType });
  }

  return saved;
}

async function readBody(req) {
  const type = (req.headers['content-type'] || '').toLowerCase();
  if (type.startsWith('multipart/form-data')) {
    const parsed = await parseMultipartForm(req);
    const complaint = parsed.complaint && typeof parsed.complaint === 'object' ? parsed.complaint : {};
    const images = await saveUploadedPhotos(parsed.photos || []);
    return { ...complaint, images };
  }

  const bytes = await readRequestBytes(req);
  const text = bytes.toString('utf8');
  if (!text) return {};

  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new AppError(400, 'Invalid JSON');
  }
}

async function requireRole(req, roles) {
  const user = await auth.currentUser(req);
  if (!user) throw new AppError(401, 'Sign in to continue');
  if (!roles.includes(user.role)) throw new AppError(403, 'Your account does not have permission to do this');
  req.user = user;
  return user;
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) throw new AppError(403, 'Cross-origin request rejected');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(403, 'Cross-origin request rejected');
    }
  }
}

const REF = /^CR-\d{4}-\d{6}$/;

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  const allow = (...methods) => {
    if (!methods.includes(m)) {
      res.setHeader('Allow', methods.join(', '));
      throw new AppError(405, 'Method not allowed');
    }
  };

  if (p === '/api/health') { allow('GET'); return sendJson(res, 200, { status: 'ok' }); }
  if (p === '/api/departments') {
    allow('GET');
    return sendJson(res, 200, { departments: [...new Set(Object.values(cfg.CATEGORIES).map((c) => c.department))], categories: Object.keys(cfg.CATEGORIES), statuses: cfg.STATUSES });
  }
  if (p === '/api/auth/me') { allow('GET'); return sendJson(res, 200, { user: await auth.currentUser(req) }); }
  if (p === '/api/auth/demo') { allow('GET'); return sendJson(res, 200, { accounts: auth.DEMO_USERS }); }
  if (p === '/api/auth/register') {
    allow('POST');
    checkOrigin(req);
    return sendJson(res, 201, { user: await auth.register(await readBody(req), res) });
  }
  if (p === '/api/auth/login') {
    allow('POST');
    checkOrigin(req);
    return sendJson(res, 200, { user: await auth.login(req, res, await readBody(req)) });
  }
  if (p === '/api/auth/logout') {
    allow('POST');
    checkOrigin(req);
    auth.logout(req, res);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/complaints/feed') {
    allow('GET');
    const user = await auth.currentUser(req);
    return sendJson(res, 200, await service.publicFeed(user && user.role === 'resident' ? user.id : null));
  }

  let voteRoute = p.match(/^\/api\/complaints\/([^/]+)\/vote$/);
  if (voteRoute) {
    allow('POST');
    checkOrigin(req);
    if (!REF.test(voteRoute[1])) throw new AppError(400, 'Invalid complaint ID format');
    const user = await requireRole(req, ['resident']);
    return sendJson(res, 200, await service.vote(voteRoute[1], user.id));
  }

  if (p === '/api/complaints') {
    allow('GET', 'POST');
    if (m === 'POST') {
      checkOrigin(req);
      await requireRole(req, ['resident']);
      return sendJson(res, 201, await service.create(await readBody(req)));
    }

    const user = await requireRole(req, ['staff', 'admin']);
    const filters = Object.fromEntries(url.searchParams);
    if (user.role === 'staff') filters.department = user.department;
    return sendJson(res, 200, await service.list(filters));
  }

  let r = p.match(/^\/api\/complaints\/([^/]+)$/);
  if (r) {
    allow('GET');
    if (!REF.test(r[1])) throw new AppError(400, 'Invalid complaint ID format');
    return sendJson(res, 200, await service.get(r[1]));
  }

  r = p.match(/^\/api\/complaints\/([^/]+)\/status$/);
  if (r) {
    allow('PATCH');
    checkOrigin(req);
    const user = await requireRole(req, ['staff', 'admin']);
    if (!REF.test(r[1])) throw new AppError(400, 'Invalid complaint ID format');
    if (user.role === 'staff') {
      const complaint = await service.get(r[1]);
      if (complaint.department !== user.department) throw new AppError(403, 'Staff can only update reports for their department');
    }
    return sendJson(res, 200, await service.updateStatus(r[1], await readBody(req), user.role));
  }

  if (p === '/api/admin/users') {
    allow('GET', 'POST');
    await requireRole(req, ['admin']);
    if (m === 'GET') {
      return sendJson(res, 200, { items: await auth.listUsers() });
    }
    allow('POST');
    checkOrigin(req);
    return sendJson(res, 201, { user: await auth.createManagedUser(await readBody(req)) });
  }

  throw new AppError(404, 'Route not found');
}

module.exports = { handle, sendJson };
