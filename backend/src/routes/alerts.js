const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

// ─── Alert Logic ──────────────────────────────────────────────────────────────
// An alert is ACTIVE for a slot when ALL of the following are true:
//   1. Slot status is "Requested"
//   2. Slot startTime is within the next 24 hours
//   3. Slot is not archived
//
// Dismissal behaviour:
//   - A dismissed alert stays hidden UNLESS the slot enters the critical window:
//     startTime - now <= 1 hour  →  alert MUST reappear regardless of dismissal
//
// All logic runs at query time (stateless — no background jobs needed).

const ALERT_WINDOW_MS   = 24 * 60 * 60 * 1000; // 24 hours
const CRITICAL_WINDOW_MS =      60 * 60 * 1000; //  1 hour

/**
 * Compute whether each candidate slot is an active alert for the given user.
 * @param {Array}  slots       - Requested, non-archived slots within 24h window
 * @param {Array}  dismissals  - AlertDismissal rows for this user
 * @param {Date}   now
 * @returns {Array} active alert slots
 */
function computeActiveAlerts(slots, dismissals, now) {
  const dismissedSlotIds = new Set(dismissals.map((d) => d.slotId));

  return slots.filter((slot) => {
    const startTime  = new Date(slot.startTime);
    const msUntilStart = startTime.getTime() - now.getTime();
    const isInCriticalWindow = msUntilStart <= CRITICAL_WINDOW_MS;

    if (isInCriticalWindow) {
      // Always show — critical window overrides any dismissal
      return true;
    }
    // Show only if not dismissed
    return !dismissedSlotIds.has(slot.id);
  });
}

// ─── GET /api/alerts — List active alerts for front-desk ─────────────────────
router.get('/', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const now     = new Date();
    const in24h   = new Date(now.getTime() + ALERT_WINDOW_MS);

    // Fetch candidate slots: Requested, not archived, within 24h
    const candidates = await prisma.slot.findMany({
      where: {
        status:     'Requested',
        isArchived: false,
        startTime:  { lte: in24h },
      },
      include: {
        provider: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    if (candidates.length === 0) {
      return res.json({ alerts: [], count: 0 });
    }

    // Fetch dismissals for this user for these slots
    const slotIds = candidates.map((s) => s.id);
    const dismissals = await prisma.alertDismissal.findMany({
      where: {
        userId: req.user.id,
        slotId: { in: slotIds },
      },
    });

    const alerts = computeActiveAlerts(candidates, dismissals, now).map((slot) => ({
      slotId:      slot.id,
      patientName: slot.patientName,
      startTime:   slot.startTime,
      provider:    slot.provider,
      status:      slot.status,
      minutesUntilStart: Math.round((new Date(slot.startTime) - now) / 60000),
      isCritical:  (new Date(slot.startTime) - now) <= CRITICAL_WINDOW_MS,
    }));

    res.json({ alerts, count: alerts.length });
  } catch (err) {
    console.error('Alerts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/alerts/count — Alert badge count ────────────────────────────────
router.get('/count', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const now   = new Date();
    const in24h = new Date(now.getTime() + ALERT_WINDOW_MS);

    const candidates = await prisma.slot.findMany({
      where: { status: 'Requested', isArchived: false, startTime: { lte: in24h } },
      select: { id: true, startTime: true },
    });

    if (candidates.length === 0) {
      return res.json({ count: 0 });
    }

    const slotIds = candidates.map((s) => s.id);
    const dismissals = await prisma.alertDismissal.findMany({
      where: { userId: req.user.id, slotId: { in: slotIds } },
      select: { slotId: true },
    });

    const active = computeActiveAlerts(candidates, dismissals, now);
    res.json({ count: active.length });
  } catch (err) {
    console.error('Alert count error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/alerts/:slotId/dismiss ────────────────────────────────────────
// Dismiss an alert. The dismissal is stored with a timestamp.
// It will be ignored automatically once the slot enters the 1-hour critical window.
router.post('/:slotId/dismiss', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const { slotId } = req.params;

    // Verify the slot exists and is actually alertable
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (slot.status !== 'Requested') {
      return res.status(400).json({ error: 'Only Requested appointments can be dismissed' });
    }

    // Upsert — if already dismissed, update the timestamp
    const dismissal = await prisma.alertDismissal.upsert({
      where:  { slotId_userId: { slotId, userId: req.user.id } },
      update: { dismissedAt: new Date() },
      create: { slotId, userId: req.user.id },
    });

    res.json({
      message: 'Alert dismissed. It will reappear within 1 hour of the appointment.',
      dismissal,
    });
  } catch (err) {
    console.error('Dismiss error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, computeActiveAlerts, ALERT_WINDOW_MS, CRITICAL_WINDOW_MS };
