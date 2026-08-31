const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get start and end of today (UTC midnight boundaries) */
function todayBounds() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/** Get start of the current ISO week (Monday) and end of week (Sunday) */
function currentWeekBounds() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { monday, sunday };
}

/** Get the Monday of the week that is `weeksAgo` weeks before this week */
function weekStartWeeksAgo(weeksAgo) {
  const { monday } = currentWeekBounds();
  const d = new Date(monday);
  d.setUTCDate(monday.getUTCDate() - weeksAgo * 7);
  return d;
}

// ─── GET /api/dashboard — Core metrics (front-desk only) ─────────────────────
router.get('/', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const now = new Date();
    const { start: todayStart, end: todayEnd } = todayBounds();
    const { monday: weekStart, sunday: weekEnd } = currentWeekBounds();

    const [
      appointmentsToday,
      checkedIn,
      noShowsThisWeek,
      upcomingConfirmed,
      byStatusRaw,
      providers,
    ] = await Promise.all([
      // Appointments today (all statuses except plain Available)
      prisma.slot.count({
        where: {
          startTime: { gte: todayStart, lte: todayEnd },
          status: { not: 'Available' },
        },
      }),

      // Currently checked-in patients
      prisma.slot.count({ where: { status: 'CheckedIn' } }),

      // No-shows this week
      prisma.slot.count({
        where: {
          status: 'NoShow',
          startTime: { gte: weekStart, lte: weekEnd },
        },
      }),

      // Upcoming confirmed appointments (future)
      prisma.slot.count({
        where: { status: 'Confirmed', startTime: { gt: now } },
      }),

      // Breakdown by status
      prisma.slot.groupBy({
        by: ['status'],
        where: { status: { not: 'Available' } },
        _count: { status: true },
      }),

      // Breakdown by provider (join provider name)
      prisma.slot.groupBy({
        by: ['providerId'],
        where: { status: { not: 'Available' } },
        _count: { providerId: true },
      }),
    ]);

    // Enrich provider breakdown with names
    const providerIds = providers.map((p) => p.providerId);
    const providerUsers = await prisma.user.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, name: true, email: true },
    });
    const providerMap = Object.fromEntries(providerUsers.map((u) => [u.id, u]));

    const byProvider = providers.map((p) => ({
      provider: providerMap[p.providerId] ?? { id: p.providerId },
      count: p._count.providerId,
    }));

    const byStatus = byStatusRaw.map((s) => ({
      status: s.status,
      count: s._count.status,
    }));

    res.json({
      appointmentsToday,
      checkedIn,
      noShowsThisWeek,
      upcomingConfirmed,
      byStatus,
      byProvider,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/dashboard/no-show-rate — Weekly no-show rate for last 8 weeks ──
router.get('/no-show-rate', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const WEEKS = 8;
    const weeks = [];

    for (let i = WEEKS - 1; i >= 0; i--) {
      const weekStart = weekStartWeeksAgo(i);
      const weekEnd   = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
      weekEnd.setUTCHours(23, 59, 59, 999);

      const [noShows, total] = await Promise.all([
        prisma.slot.count({
          where: { status: 'NoShow', startTime: { gte: weekStart, lte: weekEnd } },
        }),
        prisma.slot.count({
          where: {
            status: { in: ['NoShow', 'Completed', 'CheckedIn', 'Confirmed', 'Cancelled'] },
            startTime: { gte: weekStart, lte: weekEnd },
          },
        }),
      ]);

      weeks.push({
        weekStart:   weekStart.toISOString().split('T')[0],
        weekEnd:     weekEnd.toISOString().split('T')[0],
        noShows,
        total,
        noShowRate:  total > 0 ? parseFloat((noShows / total * 100).toFixed(1)) : 0,
      });
    }

    res.json({ weeks });
  } catch (err) {
    console.error('No-show rate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
