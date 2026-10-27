# CivicResolve (prototype)

Smart Local Government Complaint Resolution System: an academic Backend Engineering prototype with a responsive public issue feed, **community voting**, resident accounts, role-based access for residents, department staff and administrators, complaint registration and tracking, and staff/admin dashboards.

Built with **Node.js built-in modules only** (no Express, no database, no npm dependencies), to match the class syllabus.
This differs from the master prompt's planned stack (React, TypeScript, Express, Prisma, PostgreSQL): that stack is the intended future version.

## Run
Requires Node.js 18 or newer.
```
npm start        # http://localhost:3000
npm test         # automated API/authentication/unit tests (node:test, no dependencies)
```
Optional: `PORT=4000 npm start`, `DATA_DIR=/path npm start`.

## Demo flow
1. Browse the community feed. Sign up as a resident to report issues and vote once per issue; every five votes raise its priority by one level, up to Critical.
2. For the resident demo account, sign in with `resident@civicresolve.local` / `ResidentDemo#2026`.
3. For the classroom staff dashboard, sign in with `staff@civicresolve.local` / `StaffDemo#2026`. This account can view and update Roads and Infrastructure reports only.
4. For account management and all departments, sign in as `admin@civicresolve.local` / `AdminDemo#2026`. Admins can create staff or additional admin accounts.
5. Track a report by its ID to see department, priority, SLA deadline, remaining time and status history.
6. Restart the server: complaints and account password hashes persist in the `data` directory; sessions expire on server restart.

Change the seeded demo account credentials with `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_STAFF_EMAIL`, `DEMO_STAFF_PASSWORD`, `DEMO_RESIDENT_EMAIL`, and `DEMO_RESIDENT_PASSWORD` before starting the server. Seed accounts are created only when their email is not already in `data/users.json`.

## Syllabus mapping
| Topic | Where |
|---|---|
| Node fundamentals, server setup | `server.js` (`http.createServer`) |
| Modules, package.json, npm scripts | `require`/`module.exports` in `src/`; `npm start`, `npm test` |
| HTTP methods, status codes | `src/routes.js` (200, 201, 400, 403, 404, 405, 413, 500) |
| Async programming | async/await in `src/service.js`, `src/storage.js` |
| JSON and file handling | `src/storage.js` (`fs/promises`, serialized updates, temp file + rename) |
| Events and error handling | `src/events.js` (EventEmitter); `AppError` + central handler in `server.js` |
| Streams and buffers | `fs.createReadStream` for static files; write stream in `src/logger.js`; body chunks collected as Buffers in `readBody` |

## API (route parameter is the public complaint ID, e.g. CR-2026-000001)
| Method and route | Purpose | Role |
|---|---|---|
| POST /api/auth/register | Create a resident account and sign in | public |
| POST /api/auth/login | Sign in; sets an HttpOnly session cookie | public |
| POST /api/auth/logout | End the current session | signed in |
| GET /api/auth/me | Current signed-in account | signed in |
| POST /api/complaints | Create complaint (201) | resident |
| GET /api/complaints/:id | Track complaint | public |
| GET /api/complaints/feed | Public issue feed and community stats | none |
| POST /api/complaints/:id/vote | Add one vote per signed-in resident | resident |
| GET /api/complaints?status=&category=&department=&page=&limit= | List + stats; staff are scoped to their department | staff/admin |
| PATCH /api/complaints/:id/status | Update status `{status, note}`; staff only in their department | staff/admin |
| GET, POST /api/admin/users | List users and create staff/admin accounts | admin |
| GET /api/departments | Departments, categories, statuses | none |
| GET /api/health | Health | none |

## Implemented vs planned
**Implemented:** public community feed with search and category filters, session-based resident signup/sign-in, password hashing, HttpOnly session cookies, role-checked APIs, resident voting/report submission, department-scoped staff access, admin account management, vote-driven priority escalation, complaint tracking, rule-based routing (`src/config.js`), SLA deadlines, status history, validation, JSON persistence, logging.
**Not implemented (planned):** production identity provider, persistent/revocable sessions, database-backed storage, email verification and password recovery, scheduled escalation, duplicate detection, notifications, and production-grade abuse prevention.

## Known limitations
- JSON file storage with an in-process queue: single server process only.
- Routing, priority and SLA hours are demonstration values, not official policy.
- Accounts and voting are for a single-process classroom prototype, not production deployment. Add a managed identity provider, durable session store, HTTPS, secure secret management, and production rate limiting before public use.
- Contact information is stored but never returned by any endpoint.
