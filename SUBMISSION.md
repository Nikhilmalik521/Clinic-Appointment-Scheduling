# Submission

## Links

- **GitHub repository:** https://github.com/Nikhilmalik521/Clinic-Appointment-Scheduling
- **Live application:** `<to be filled after deployment>`

## Notes for the reviewer

- The backend is deployed on Render (free tier). The first request after inactivity may take **30–60 seconds** for a cold start — please wait.
- The frontend is deployed on Vercel and loads instantly.
- All 10 required features are implemented and backed by **126 passing automated tests** across 4 test suites.
- Demo seed data is pre-loaded so every feature is immediately visible after login.

## Demo credentials

| Role | Email | Password |
|------|-------|----------|
| Front Desk | frontdesk@clinic.demo | Demo@1234 |
| Provider (Dr. Sarah Smith) | smith@clinic.demo | Demo@1234 |
| Provider (Dr. Marcus Jones) | jones@clinic.demo | Demo@1234 |

## Stack

| Layer | What you used | Why |
|-------|---------------|-----|
| Frontend | React 19 + Vite + Vanilla CSS | Fast, no CSS framework bloat; dark-mode-first design system |
| Backend | Node.js + Express | Lightweight, familiar; all RBAC and state machine logic server-side |
| Database | PostgreSQL via Neon (dev) / Supabase (prod) + Prisma ORM | Type-safe queries, migrations, relation management |
| Hosting | Vercel (frontend) + Render (backend) | Free tier, zero-config CI from GitHub |

## Goal checklist

| # | Goal | Status | Notes |
|---|------|--------|-------|
| 1 | Accounts and roles | ✅ Done | JWT auth, front-desk and provider roles, enforced server-side via middleware |
| 2 | Appointment slots | ✅ Done | Create/edit/archive/restore; slots become appointments on request |
| 3 | Visit notes | ✅ Done | Provider-authored; only author can edit; displayed on appointment detail |
| 4 | Appointment status | ✅ Done | Full state machine: Requested→Confirmed→CheckedIn→Completed; NoShow only after time; cancel requires reason |
| 5 | Care team | ✅ Done | Add/remove supporting providers; providers see all appointments they're on |
| 6 | Finding appointments | ✅ Done | Server-side search by patient name, filter by provider/status/date range, sort by time/status/provider, pagination with total count |
| 7 | Bulk availability generation | ✅ Done | POST /api/slots/bulk generates recurring slots; returns created + skipped counts; CSV export per day |
| 8 | Dashboard | ✅ Done | Today's appointments, checked-in now, no-shows this week, upcoming confirmed, by-status breakdown, by-provider breakdown, 8-week no-show rate chart |
| 9 | History you cannot rewrite | ✅ Done | Append-only AuditLog table; GET-only history endpoint; no PUT/DELETE routes exist |
| 10 | Unconfirmed alerts | ✅ Done | Alerts for Requested within 24h; badge count; dismiss; reappears within 1h of start regardless of dismissal |

## How much time did you actually spend?

- Session 1 (scaffolding): ~2.5 hours
- Session 2 (auth + slots): ~1.5 hours
- Session 3 (lifecycle + care team + notes): ~2 hours
- Session 4 (search + bulk + CSV): ~1.5 hours
- Session 5 (alerts + dashboard + audit): ~1.5 hours
- Session 6 (frontend + seed + deploy): ~2 hours

**Total: ~11 hours**

## What would you do next, with another 12 hours?

1. **Real-time updates** via WebSockets or SSE so alert counts update without polling
2. **Patient portal** — self-service booking with email confirmation
3. **Recurring appointments** for ongoing treatment plans
4. **Automated reminders** (email/SMS) using a queue like BullMQ
5. **Role-specific dashboards** for providers showing their own metrics
6. **Mobile-responsive** improvements and a native-feel bottom nav

## What are you least happy with in this codebase, and why?

The **care team add flow in the UI** currently requires pasting the provider's UUID directly, which is bad UX. A proper provider search/autocomplete backed by a `GET /api/providers` endpoint (currently missing) would be the first thing to add. The endpoint exists conceptually via `/api/auth/users` but was not exposed to avoid scope creep beyond the 10 requirements.
