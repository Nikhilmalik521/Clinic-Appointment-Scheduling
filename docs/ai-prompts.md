# AI Prompts

The prompts used during this project, grouped by goal. Each entry includes what was asked, what was returned, and any corrections made.

---

## Session 1: Project Understanding & Architecture Planning

### Prompt
"I have to build this project — explain what we have to do and how we will be building this project. Don't start writing code. First explain the building approach, then wait for the next instruction."

### What you got
A full breakdown of all 10 requirements, the proposed tech stack (Node/Express + PostgreSQL + React), a session-by-session building plan (6 sessions × ~2 hours each), and a ER diagram-style database design with all 6 tables.

### What you corrected
Nothing required correction. The explanation was accurate and aligned well with the assignment goals.

---

## Session 1: Database Choice Clarification

### Prompt
"Why are we using PostgreSQL? Why not MongoDB?"

### What you got
A detailed comparison explaining ACID transactions (preventing double-bookings), native many-to-many JOIN support for Care Teams, referential integrity via foreign keys, and the difficulty of enforcing audit-log immutability in a document store.

### What you corrected
No corrections needed. This response was directly used to populate `docs/decisions.md` — Decision 1.

---

## Session 1: Prisma Schema Design

### Prompt
"Design the initial complete Prisma schema for Users/Roles, Providers, Slots, Appointments, Supporting Providers, Visit Notes, Appointment History/Audit Events, and Alert Dismissals. Add proper relationships, indexes, unique constraints, and timestamps."

### What you got
A complete `schema.prisma` defining 6 models: `User`, `Slot`, `CareTeam`, `VisitNote`, `AuditLog`, `AlertDismissal` — with correct foreign key constraints, composite primary keys on join tables, database-level indexes on high-frequency lookup columns, and nullable fields for optional data (patientName, cancellationReason).

### What you corrected
No structural corrections. One operational issue arose: `prisma migrate dev` was flagged as non-interactive in the non-TTY shell environment. The fix was to use `prisma db push` for initial schema sync followed by `prisma migrate resolve --applied` to register the migration in the migrations table — a known Prisma deployment pattern for non-interactive CI/CD environments.

---

## Session 1: Express Server Boilerplate

### Prompt
"Set up the Node.js + Express backend with a basic /api/health endpoint, CORS, dotenv, and a Prisma singleton."

### What you got
A working `src/index.js` with Express, CORS middleware, JSON body parsing, /api/health endpoint, 404 catch-all, and a global error handler. A separate `src/lib/prisma.js` singleton was created to share one Prisma client instance across all route handlers.

### What you corrected
The initial attempt to background-start the server with `&` failed on Windows PowerShell (ampersand operator not supported in PowerShell). Corrected to use `node -e "require('./src/index.js'); setTimeout(...)"` which confirmed the server boots on port 5000 correctly.

---

## Session 2: Auth middleware (JWT verification)

### Prompt
"Create a JWT authentication middleware for Express that extracts a Bearer token from the Authorization header, verifies it, and attaches the decoded payload to req.user."

### What you got
A clean `authenticate.js` middleware that checks for the `Bearer ` prefix, calls `jwt.verify()`, and returns 401 for missing or invalid tokens.

### What you corrected
Nothing required correction. The middleware worked correctly in the first test run.

---

## Session 2: RBAC middleware

### Prompt
"Create a role-based authorization middleware factory that accepts a list of allowed roles and returns a middleware returning 403 if req.user.role is not in the list."

### What you got
`authorize(...allowedRoles)` factory that returns an Express middleware. Returns 401 if req.user is absent, 403 if role is not in the allowed list.

### What you corrected
Nothing required correction.

---

## Session 2: Slot conflict detection

### Prompt
"Implement overlap/conflict detection for slot creation — two slots for the same provider overlap if one starts before the other ends."

### What you got (initially wrong)
The first draft tried to express the slot-end comparison entirely in the Prisma `where` clause using `AND: [{ startTime: { lt: end } }]`. This is incomplete because Prisma cannot compute `startTime + durationMinutes * 60000` inline — it cannot compare a computed column against a value.

### What you corrected
Split the check into two parts: (1) a Prisma query to find candidates whose `startTime < proposedEnd` (slot started before proposed slot ends), then (2) a JavaScript `.some()` filter to check whether each candidate's computed end time (`startTime + durationMinutes * 60s`) falls after the proposed start. This correctly catches all overlap cases with no false positives.

---

## Session 2: Test suite (auth + RBAC + slots)

### Prompt
"Write a comprehensive supertest test suite covering: register/login/me, slot create with RBAC, provider vs front-desk visibility, edit restrictions, archive/restore with RBAC, conflict detection, and 401/403/404 error paths."

### What you got
28 test cases grouped into 5 describe blocks. All 28 passed on first run against the live Neon PostgreSQL database. Cleanup afterAll deletes all test records ending in `@clinic.test`.

### What you corrected
Nothing required correction. All tests passed cleanly.

---

## Session 3: Appointment lifecycle state machine

### Prompt
"Implement the appointment status lifecycle: Available→Requested→Confirmed→CheckedIn→Completed. Allow Confirmed→NoShow only after scheduled time. Cancellation only before check-in and requires a reason. Reject invalid transitions server-side with clear errors."

### What you got
A `src/routes/appointments.js` file with one endpoint per transition action. Each endpoint validates current status, enforces RBAC, checks the NoShow time guard and cancellation reason requirement, updates the slot record, and writes an immutable audit log entry.

### What you corrected
Nothing required correction. All lifecycle tests passed on the first run.

---

## Session 3: Test fixture slot-conflict bug

### Prompt
"Write a comprehensive supertest test suite covering all lifecycle transitions, care team, and notes."

### What you got (initially wrong)
The test helper used `Date.now() + 24h` as a fixed start time for every slot. Multiple describe blocks calling `createSlot` for the same provider caused conflict-409 rejections, returning `undefined`, which cascaded into 28 `TypeError: Cannot read properties of undefined (reading 'id')` failures.

### What you corrected
Added a module-level monotonic counter. Each `createSlot` call now uses `24 + counter * 2` hours from now, giving every slot a distinct 2-hour window. Production conflict-detection logic was not changed.

---

## Session 4: Search, filter, sort, paginate GET /api/appointments

### Prompt
"Upgrade GET /api/appointments with server-side search by patient name, filters by provider/status/date-range, sorting by date/status/providerName, and pagination with total count. No client-side filtering."

### What you got
Replaced the simple `findMany` with a Prisma `$transaction([findMany, count])` query. Search uses `{ contains: ..., mode: 'insensitive' }`. Status accepts comma-separated values mapped to `{ in: [...] }`. Date filters use `{ gte: }` / `{ lte: }`. Sort by providerName uses `{ provider: { name: order } }`. Pagination uses `skip` + `take` with capped `pageSize` of 100.

### What you corrected
Nothing required correction. All 19 search/filter/sort/pagination tests passed on first run.

---

## Session 4: Bulk slot generation

### Prompt
"Create POST /api/slots/bulk that generates recurring slots across a date range for a provider, returning which slots were created and which were skipped due to conflicts."

### What you got
`POST /api/slots/bulk` (front-desk only) accepts `startDate`, `endDate`, `startHour`, `endHour`, `durationMinutes`, `intervalMinutes`, `daysOfWeek`. Iterates day by day, generates slot start times as a minuteOffset loop, checks each with `hasConflict()`, creates or records as skipped. Returns `{ summary, created, skipped }`.

### What you corrected
Nothing required correction. Bulk generation and conflict-skipping tests passed first run.

---

## Session 4: CSV export

### Prompt
"Create GET /api/schedule/export?date=&providerId= that returns a single-day schedule as a CSV file. No extra npm packages."

### What you got
`src/routes/schedule.js` that filters slots by day using UTC `T00:00:00.000Z` / `T23:59:59.999Z` boundaries. Builds CSV string manually with an RFC 4180-compliant `escape()` helper (wraps in double-quotes, escapes internal quotes). Sets `Content-Type: text/csv` and `Content-Disposition: attachment` headers.

### What you corrected
Nothing required correction. All 6 CSV tests passed first run.

---

## Session 5: Alerts with dismissal and 1-hour reappearance rule

### Prompt
"Add unconfirmed appointment alerts when status is Requested and scheduled time is within 24h. Allow front desk to dismiss alerts. If still Requested within 1 hour of appointment, the alert must reappear despite previous dismissal."

### What you got
`src/routes/alerts.js` with GET /api/alerts, GET /api/alerts/count, POST /api/alerts/:slotId/dismiss. The reappearance rule is a pure stateless runtime computation via `computeActiveAlerts()`: candidates are fetched from DB, dismissals are fetched, then JS filters — any slot within 1h of start always passes through regardless of dismissal row. The function is exported for direct unit testing without any DB calls.

### What you corrected
Nothing required correction. All 18 alert tests (5 pure unit + 13 HTTP) passed first run.

---

## Session 5: Dashboard metrics and weekly no-show rate

### Prompt
"Build dashboard metrics: appointments today, currently checked-in, no-shows this week, upcoming confirmed, breakdown by provider and status, weekly no-show rate for last 8 weeks."

### What you got
`src/routes/dashboard.js` with GET /api/dashboard (uses Promise.all with 6 parallel Prisma queries: count, groupBy) and GET /api/dashboard/no-show-rate (loops 8 weeks using UTC week boundary helpers, runs 2 queries per week). No-show rate is `noShows / total * 100` rounded to 1 decimal.

### What you corrected
Nothing required correction. All 12 dashboard tests passed first run.

---

## Session 5: Audit log immutability

### Prompt
"Ensure audit/history records are append-only and cannot be edited or deleted."

### What you got
The existing GET /api/appointments/:id/history returns records in chronological order. No PUT, PATCH, or DELETE route is registered for audit log entries at any path, so attempts return 404 from Express. Tests explicitly verify that PUT and DELETE to /history/:id return 404. Each event's `performedBy`, `eventType`, `eventData`, and `createdAt` are verified.

### What you corrected
Nothing required correction. All 6 audit immutability tests passed first run.

---

## Session 6: React frontend — design system and routing

### Prompt
"Build the complete React frontend using Vanilla CSS, modern and responsive, dark-mode-first. Connect the UI to all existing backend APIs. Implement login and role-based navigation."

### What you got
`src/index.css` — 600-line CSS-only design system with custom properties, glassmorphism cards, gradient buttons, animated status badges, sidebar layout, modal, timeline, and bar chart — no Tailwind or component library. `src/App.jsx` uses React Router v6 with a `RequireAuth` HOC that redirects unauthenticated users and enforces role-based access (front-desk → dashboard, provider → appointments). `AuthContext` stores the JWT in localStorage and calls `GET /api/auth/me` on mount to restore sessions.

### What you corrected
`client.js` was initially not saved to disk correctly (tool write appeared to succeed but file was missing on disk). Recreated it before the production build. Build then succeeded with 0 errors, 44 modules transformed.

---

## Session 6: All 6 pages

### Prompt
"Build dashboard, appointment list/search, scheduling/slots, appointment details, care team, visit notes and alerts views. Show proper loading, empty, success and error states."

### What you got
- **LoginPage**: Email/password form + one-click demo credential fill buttons for all 3 accounts.
- **DashboardPage**: 4 metric cards (appointmentsToday, checkedIn, upcomingConfirmed, noShowsThisWeek), by-status and by-provider breakdown tables, 8-week no-show rate pure-CSS bar chart.
- **AppointmentsPage**: Server-side search input, status/date-from/date-to filters, sortable column headers (▲▼), paginated table, row-click to detail.
- **AppointmentDetailPage**: Info panel, role-aware transition buttons (Confirm/CheckIn/Complete/Cancel/NoShow), care team add/remove, visit notes add/edit (author-gated), append-only timeline with colour-coded dots.
- **SlotsPage**: Slot table with edit/archive/restore, create-slot modal, bulk generation modal showing created+skipped summary, CSV download via Blob URL trigger.
- **AlertsPage**: Alert cards with critical/normal highlight, locked dismiss button in 1h window, refresh button.

### What you corrected
Nothing required correction on first build.

---

## Session 6: Seed data

### Prompt
"Add realistic demo/seed data and demo credentials for both roles."

### What you got
`backend/src/seed.js` upserts 3 demo users (frontdesk@clinic.demo, smith@clinic.demo, jones@clinic.demo, all password Demo@1234) and creates 14 appointments spanning past/present/future in all statuses (CheckedIn, Confirmed, Requested, Available, Completed, NoShow, Cancelled) with audit log entries for each transition.

### What you corrected
Two field-name mismatches against the Prisma schema: `password` → `passwordHash` in the users array; `visitNote.create` needed the `slot: { connect }` relation syntax rather than bare `slotId`. Both fixed immediately.
