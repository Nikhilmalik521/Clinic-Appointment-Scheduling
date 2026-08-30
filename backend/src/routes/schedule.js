const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/authenticate');

// ─── GET /api/schedule/export — Single-day CSV export ────────────────────────
// Query params:
//   date=<YYYY-MM-DD>     required — the day to export
//   providerId=<uuid>     optional — filter to a specific provider (front-desk only)
//
// Providers can only export their own schedule.
// Front-desk can export any or all providers for a day.
//
// Response: text/csv with Content-Disposition: attachment; filename="schedule-<date>.csv"
router.get('/export', authenticate, async (req, res) => {
  try {
    const { date, providerId } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date query parameter is required (YYYY-MM-DD)' });
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    if (isNaN(dayStart)) {
      return res.status(400).json({ error: 'date must be a valid date in YYYY-MM-DD format' });
    }

    // ── RBAC filter ───────────────────────────────────────────────────────────
    let whereClause = {
      startTime: { gte: dayStart, lte: dayEnd },
      isArchived: false,
    };

    if (req.user.role === 'provider') {
      // Providers can only export their own schedule
      whereClause.providerId = req.user.id;
    } else if (providerId) {
      // Front-desk may filter to a specific provider
      whereClause.providerId = providerId;
    }

    const slots = await prisma.slot.findMany({
      where: whereClause,
      include: {
        provider: { select: { name: true, email: true } },
        careTeam: { include: { provider: { select: { name: true } } } },
      },
      orderBy: { startTime: 'asc' },
    });

    // ── Build CSV ─────────────────────────────────────────────────────────────
    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Wrap in quotes if it contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'Start Time',
      'Duration (min)',
      'Status',
      'Patient Name',
      'Provider',
      'Provider Email',
      'Supporting Providers',
      'Cancellation Reason',
    ];

    const rows = slots.map((slot) => {
      const supportingNames = slot.careTeam.map((ct) => ct.provider.name).join('; ');
      return [
        slot.startTime.toISOString(),
        slot.durationMinutes,
        slot.status,
        slot.patientName ?? '',
        slot.provider.name,
        slot.provider.email,
        supportingNames,
        slot.cancellationReason ?? '',
      ].map(escape).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="schedule-${date}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
