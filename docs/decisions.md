# Decisions

Log the decisions that actually shaped this codebase — the ones where a real alternative existed and you picked one. At least five entries.

## Decision 1

- **Chose:** PostgreSQL (with Supabase and Prisma)
- **Rejected:** MongoDB
- **Why:** Relational consistency, strong foreign key constraints, and clean join operations (specifically for the Care Team many-to-many relationship) are native to SQL. Transactions prevent race conditions (double-booking the same availability slot). Enforcing strict constraints at the database layer acts as a strong safety net for data integrity.

## Decision 2

- **Chose:** Unified `Slot` and `Appointment` table with a `status` field.
- **Rejected:** Having separate `slots` and `appointments` tables.
- **Why:** The instructions specify that "once a patient requests a slot, that same record becomes an appointment." Keeping them in separate tables would require data migration, duplicate keys, and complex synchronizations. Merging them into a single table with a state machine simplifies updates, search queries, and analytics.

## Decision 3

- **Chose:** Write-Only `AuditLog` table for history logging.
- **Rejected:** Storing historical changes as a JSON array inside the `Slot` record.
- **Why:** Storing logs in an external table with strict database-level security privileges ensures history cannot be updated or deleted, even by front-desk or administrative users. A separate audit log scales better and makes queries for historic changes direct and filterable.

## Decision 4

- **Chose:** Express.js code-level enforcement of the state transition machine.
- **Rejected:** Enforcing the state transitions via PostgreSQL triggers or DB constraints.
- **Why:** While database triggers offer bulletproof enforcement, they are harder to debug, test, and adapt. Defining the lifecycle flow maps (`Requested` -> `Confirmed` -> `CheckedIn` -> `Completed`) inside backend controllers keeps business rules clean, legible, and maintainable. We will still enforce correct text validation at the database level.

## Decision 5

- **Chose:** Dynamic SQL-based alert dismissal query checks.
- **Rejected:** Setting up background cron jobs or redis/memory timer queues to "reset" dismissed alerts.
- **Why:** Dynamic queries check the current timestamp against the appointment's scheduled time and dismissal time on the fly. If `currentTime >= startTime - 1 hour`, the dismissal is automatically ignored, making it completely stateless and zero-maintenance on free-tier servers that sleep when idle.

## Decision 6

- **Chose:** Plain JavaScript (CommonJS) for the backend.
- **Rejected:** TypeScript for the backend.
- **Why:** Initially planned TypeScript, but reversed this decision in Session 1. TypeScript adds useful type safety in large codebases but introduces overhead (tsconfig setup, type declaration files, compilation step) that doesn't pay off in a solo 12-hour project where speed matters. The frontend (React/Vite) stays in plain JSX.
- **Later reversed:** This is the reversal — TypeScript was the original plan and was swapped out for JavaScript early in Session 1.

## Decision 7

- **Chose:** `prisma db push` + `prisma migrate resolve` for initial schema application.
- **Rejected:** `prisma migrate dev` (the standard interactive dev workflow).
- **Why:** `prisma migrate dev` requires a TTY (interactive terminal) to confirm database resets and prompt for migration names. The agentic shell environment this project was built in is non-interactive, which caused the command to hang indefinitely. `prisma db push` applies the schema directly without interaction, and `prisma migrate resolve` registers the migration in the `_prisma_migrations` table so future migrations work correctly.


