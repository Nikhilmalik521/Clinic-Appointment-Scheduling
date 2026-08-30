# Architecture

### What are the moving pieces, and how do they talk to each other?

1. **Client Application (Frontend)**: Built in React (Vite). It captures user actions, performs basic client-side routing and validation, and renders standard HTML views styled via custom Vanilla CSS rules.
2. **Web API Service (Backend)**: Built using Node.js and Express. It receives requests, verifies JWT tokens via `authenticate` middleware, checks role permissions via `authorize` middleware, runs the appointment state machine checks, and queries/modifies the database. Implemented routes so far:
   - `POST /api/auth/register` — bcrypt password hashing + JWT issuance
   - `POST /api/auth/login` — credential verification + JWT issuance
   - `GET /api/auth/me` — token-protected profile fetch
   - `POST /api/slots` — front-desk only; creates slots with conflict checking
   - `GET /api/slots` — scoped by role (providers see only own slots)
   - `GET /api/slots/:id` — single slot fetch with ownership check for providers
   - `PUT /api/slots/:id` — edit unbooked slots; providers restricted to own
   - `POST /api/slots/:id/archive` — front-desk only; soft-removes from schedule
   - `POST /api/slots/:id/restore` — front-desk only; un-archives slot
   - `GET /api/appointments` — role-scoped list (providers see own + supported)
   - `GET /api/appointments/:id` — single appointment with care team
   - `POST /api/appointments/:id/request` — Available→Requested; requires patientName
   - `POST /api/appointments/:id/confirm` — Requested→Confirmed (front-desk)
   - `POST /api/appointments/:id/checkin` — Confirmed→CheckedIn (front-desk)
   - `POST /api/appointments/:id/complete` — CheckedIn→Completed (provider or front-desk)
   - `POST /api/appointments/:id/noshow` — Confirmed→NoShow; only after scheduled time (front-desk)
   - `POST /api/appointments/:id/cancel` — requires reason; blocked after CheckedIn (front-desk)
   - `GET /api/appointments/:id/history` — immutable audit log in chronological order
   - `POST /api/appointments/:id/care-team` — add supporting provider (front-desk)
   - `DELETE /api/appointments/:id/care-team/:providerId` — remove supporting provider (front-desk)
   - `GET /api/appointments/:id/notes` — list visit notes (front-desk or associated provider)
   - `POST /api/appointments/:id/notes` — add note (provider only; must be scheduling or supporting)
   - `PUT /api/appointments/note/:noteId` — edit note (author only)
   - `GET /api/appointments` *(upgraded)* — search (`?search=`), filter (`?providerId=`, `?status=`, `?dateFrom=`, `?dateTo=`), sort (`?sortBy=`, `?sortOrder=`), paginate (`?page=`, `?pageSize=`); all DB-side
   - `POST /api/slots/bulk` — front-desk only; generate recurring slots across a date range; returns `{ created, skipped }`
   - `GET /api/schedule/export` — single-day CSV export (`?date=YYYY-MM-DD&providerId=`); RFC 4180 CSV, RBAC-scoped
3. **Database (Persistence)**: PostgreSQL hosted on Neon, managed through the Prisma ORM tool. It handles foreign key checks, uniqueness constraints, and stores data transactionally.

**Communication**:
- The client talks to the backend via asynchronous JSON/HTTP requests (`fetch` or `axios`). All API requests carry a Bearer JWT token in the `Authorization` header after login.
- The backend communicates with the database using TCP connection pooling via Prisma's client library.

### Where does each piece run?

- **Client (Frontend)**: Served statically from Vercel's global CDN and executes entirely in the user's web browser.
- **Web API Service (Backend)**: Runs inside a Docker container/Node runtime environment on Render.com's web services.
- **Database**: Runs in a managed PostgreSQL instance provided by Supabase in the cloud.

### What is the request path for one representative user action, end to end?

**Example: A provider writes a visit note for an appointment.**
1. **User Action**: The provider clicks "Save Note" on the frontend UI, entering free-text note content.
2. **Client Request**: The React application fires a `POST /api/slots/:slotId/notes` request with body `{ noteText: "Patient is recovering well." }` and the provider's JWT token in the header.
3. **Backend Middleware Checks**:
   - **Auth Gate**: Enforces the token is valid, extracting user ID and role (`provider`).
   - **Role Gate**: Confirms the user has the `provider` role (or matches permissions).
   - **Ownership Gate**: Queries the database to confirm this provider is either the scheduling provider or a registered member of the Care Team for `slotId`. If not, returns `403 Forbidden`.
4. **Database Insertion**: The backend triggers a Prisma database transaction that:
   - Inserts the new row into the `VisitNote` table.
   - Inserts an audit trace into the `AuditLog` table with `eventType = 'note_added'` and details about the author.
5. **Client Response**: The database returns the created note. The backend constructs a `201 Created` JSON payload containing the note metadata.
6. **Client Render**: The React app receives the note, appends it to the chronological list of notes in state, and displays the updated timeline to the provider.

### What did you decide *not* to build, and why?

- **Separate "Slots" vs "Appointments" Tables**: We chose not to build separate tables. Since "once a patient requests a slot, that same record becomes an appointment," maintaining two separate tables would require duplicate keys, table synchronizations, and complex joins. A unified table with a `status` field simplifies query structures.
- **Real-time WebSockets for Alerts**: Instead of persistent WebSockets (which run into connection limits and setup overhead on free-tier Render services), alerts are fetched on dashboard load/refresh and kept up-to-date via short client-side interval polling (e.g., every 30-60 seconds) or page re-entries. This fits within the 12-hour budget while retaining high performance.
- **Patient Authentication Accounts**: We avoided building a patient-facing account model. Since the scenario focuses on front-desk management, providers, and a "paper day-sheet" replacement, patient names are simply treated as text metadata fields attached to appointments. This reduces auth security scope and database complexity.
- **Optional Stretch Features (Reminders, Waitlist, Room Assignments)**: These were omitted in the initial architecture to focus entirely on delivering the 10 core clinic requirements flawlessly.

