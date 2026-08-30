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
