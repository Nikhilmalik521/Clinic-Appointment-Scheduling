# Schema

### Table by table: what columns and types does each one have?

1. **`User`**
   - `id`: `UUID` (Primary Key, Default: `uuid_generate_v4()`)
   - `email`: `VARCHAR(255)` (Unique, Indexed)
   - `passwordHash`: `VARCHAR(255)`
   - `name`: `VARCHAR(255)`
   - `role`: `VARCHAR(50)` (Values: `'front-desk'`, `'provider'`)
   - `createdAt`: `TIMESTAMP` (Default: `now()`)

2. **`Slot`** (Represents both unbooked availability slots and scheduled appointments)
   - `id`: `UUID` (Primary Key)
   - `providerId`: `UUID` (Foreign Key -> `User.id`, Indexed)
   - `startTime`: `TIMESTAMP` (Indexed)
   - `durationMinutes`: `INTEGER`
   - `status`: `VARCHAR(50)` (Values: `'Available'`, `'Requested'`, `'Confirmed'`, `'CheckedIn'`, `'Completed'`, `'NoShow'`, `'Cancelled'`)
   - `isArchived`: `BOOLEAN` (Default: `false`, Indexed)
   - `patientName`: `VARCHAR(255)` (Nullable, Indexed)
   - `cancellationReason`: `TEXT` (Nullable)
   - `createdAt`: `TIMESTAMP`
   - `updatedAt`: `TIMESTAMP`

3. **`CareTeam`** (Many-to-many relationship mapping supporting providers to appointments)
   - `slotId`: `UUID` (Foreign Key -> `Slot.id`, Composite PK)
   - `providerId`: `UUID` (Foreign Key -> `User.id`, Composite PK, Indexed)
   - `assignedAt`: `TIMESTAMP` (Default: `now()`)

4. **`VisitNote`** (Medical observations written by providers)
   - `id`: `UUID` (Primary Key)
   - `slotId`: `UUID` (Foreign Key -> `Slot.id`, Indexed)
   - `authorId`: `UUID` (Foreign Key -> `User.id`)
   - `noteText`: `TEXT`
   - `createdAt`: `TIMESTAMP` (Default: `now()`)
   - `updatedAt`: `TIMESTAMP`

5. **`AuditLog`** (Immutable event log for appointments)
   - `id`: `UUID` (Primary Key)
   - `slotId`: `UUID` (Foreign Key -> `Slot.id`, Indexed)
   - `eventType`: `VARCHAR(50)` (Values: `'status_change'`, `'note_added'`, `'care_team_change'`, `'cancellation'`)
   - `eventData`: `JSONB` (Stores old/new status, care team changes, note additions, reasons)
   - `performedById`: `UUID` (Foreign Key -> `User.id`)
   - `createdAt`: `TIMESTAMP` (Default: `now()`)

6. **`AlertDismissal`** (Tracks alerts hidden by front-desk staff)
   - `slotId`: `UUID` (Foreign Key -> `Slot.id`, Composite PK)
   - `userId`: `UUID` (Foreign Key -> `User.id`, Composite PK)
   - `dismissedAt`: `TIMESTAMP` (Default: `now()`)

### Which relationships are one-to-many, and which are many-to-many?

- **One-to-Many**:
  - `User` $\rightarrow$ `Slot` (A scheduling provider can have many slots).
  - `Slot` $\rightarrow$ `VisitNote` (An appointment can contain multiple visit notes over time).
  - `Slot` $\rightarrow$ `AuditLog` (An appointment accumulates multiple immutable audit events).
  - `User` $\rightarrow$ `AuditLog` (A user performs multiple actions recorded in the logs).
  - `User` $\rightarrow$ `VisitNote` (A provider writes multiple visit notes).
- **Many-to-Many**:
  - `Slot` $\leftrightarrow$ `User` (via `CareTeam`): An appointment can have multiple supporting providers, and a provider can support multiple appointments.
  - `Slot` $\leftrightarrow$ `User` (via `AlertDismissal`): Front-desk staff can dismiss multiple appointment alerts, and an alert can be dismissed by multiple front-desk users.

### Which constraints are enforced by the database, and which by application code — and why did you draw the line there?

* **Database Constraints**:
  - `FOREIGN KEY` constraints are enforced at the database level (`User`, `Slot`, `CareTeam`, `VisitNote`, `AuditLog`, `AlertDismissal`) to maintain referential integrity.
  - `UNIQUE` constraint on `User.email` prevents duplicate user accounts.
  - Composite Primary Key on `CareTeam(slotId, providerId)` prevents adding the same supporting provider to an appointment multiple times.
  - Database-level triggers or constraint checks (e.g., `durationMinutes > 0`) ensure numeric invariants.
* **Application Constraints**:
  - **Appointment State Transitions**: The rules mapping allowed workflow paths (`Requested` $\rightarrow$ `Confirmed` $\rightarrow$ `CheckedIn` $\rightarrow$ `Completed`) are checked in Express route middlewares. This keeps business workflow rules flexible and customizable in code rather than locked inside PL/pgSQL database triggers.
  - **Alert Dismissal Logic**: The evaluation of whether a dismissal is valid (greater than 1 hour before appointment time) is resolved in SQL query logic during fetching.
  - **Role-Based Permissions**: Front-desk vs provider visibility restrictions are enforced in Express backend middleware to return appropriate HTTP 403 status codes.

### What did you deliberately denormalise?

- We represent both availability slots and requested/confirmed appointments in a single `Slot` table. While a normalized structure would have distinct `slots` and `appointments` tables, merging them simplifies state management. Once a patient is assigned to an `Available` slot, its status shifts directly to `Requested` and `patientName` is populated, keeping search queries, filters, and dashboard calculations clean and index-friendly.

### What would break first if this had 100x the data?

1. **Dashboard Metrics**: The weekly no-show rate calculations and status counts would slow down if they perform full table scans over millions of historic slots. We would need to implement:
   - Indexes on `Slot(startTime, status, isArchived)`.
   - A materialized view or daily/weekly pre-aggregated cache for dashboard statistics.
2. **Text Search pagination**: Doing server-side `patientName` pattern matching using standard `LIKE '%query%'` is not scalable on large datasets since it skips ordinary B-Tree indexes. If the dataset scales 100x, we will need to implement a PostgreSQL Full-Text Search index (using `tsvector` and a GIN index on `patientName`) or integrate a tool like Elasticsearch.
3. **AuditLog scale**: The `AuditLog` table will grow exponentially faster than slots. Standard pagination would degrade. Partitioning the `AuditLog` table by date ranges (e.g., monthly partitions) would be required.

