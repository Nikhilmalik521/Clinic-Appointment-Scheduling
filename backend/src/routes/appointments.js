const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { writeAuditLog } = require('../lib/auditLog');

// ─── State machine ────────────────────────────────────────────────────────────
// Maps each status to what it can legally transition to
const TRANSITIONS = {
  Available:  ['Requested'],
  Requested:  ['Confirmed', 'Cancelled'],
  Confirmed:  ['CheckedIn', 'NoShow', 'Cancelled'],
  CheckedIn:  ['Completed'],
  Completed:  [],
  NoShow:     [],
  Cancelled:  [],
};

// Statuses that can be cancelled (must be before CheckedIn)
const CANCELLABLE = ['Requested', 'Confirmed'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch a slot or return 404 */
async function findSlot(id, res) {
  const slot = await prisma.slot.findUnique({
    where: { id },
    include: {
      provider: { select: { id: true, name: true, email: true } },
      careTeam: { include: { provider: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!slot) {
    res.status(404).json({ error: 'Appointment not found' });
    return null;
  }
  return slot;
}

/**
 * Check that the requesting user is authorised to act on this appointment.
 * Front-desk can act on anything.
 * Providers can act only on slots where they are the scheduling or supporting provider.
 */
function canAccess(user, slot) {
  if (user.role === 'front-desk') return true;
  if (slot.providerId === user.id) return true;
  if (slot.careTeam.some((ct) => ct.providerId === user.id)) return true;
  return false;
}

// ─── GET /api/appointments — List appointments visible to the caller ───────────
router.get('/', authenticate, async (req, res) => {
  try {
    let where = {};

    if (req.user.role === 'provider') {
      // Provider sees appointments where they are the scheduling OR supporting provider
      where = {
        OR: [
          { providerId: req.user.id },
          { careTeam: { some: { providerId: req.user.id } } },
        ],
        status: { not: 'Available' }, // only booked appointments
      };
    } else {
      // Front-desk sees everything that has been requested (not bare Available slots)
      where = { status: { not: 'Available' } };
    }

    const appointments = await prisma.slot.findMany({
      where,
      include: {
        provider: { select: { id: true, name: true, email: true } },
        careTeam: { include: { provider: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { startTime: 'asc' },
    });

    res.json({ appointments, count: appointments.length });
  } catch (err) {
    console.error('List appointments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/appointments/:id — Single appointment ──────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const slot = await findSlot(req.params.id, res);
    if (!slot) return;

    if (!canAccess(req.user, slot)) {
      return res.status(403).json({ error: 'Access denied: you are not associated with this appointment' });
    }

    res.json({ appointment: slot });
  } catch (err) {
    console.error('Get appointment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/appointments/:id/request ──────────────────────────────────────
// Available → Requested  (front-desk only; requires patientName)
router.post('/:id/request', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const slot = await findSlot(req.params.id, res);
    if (!slot) return;

    if (slot.status !== 'Available') {
      return res.status(400).json({
        error: `Cannot request: slot is already "${slot.status}". Only Available slots can be requested.`,
      });
    }
    if (slot.isArchived) {
      return res.status(400).json({ error: 'Cannot request an archived slot' });
    }

    const { patientName } = req.body;
    if (!patientName || !patientName.trim()) {
      return res.status(400).json({ error: 'patientName is required to request a slot' });
    }

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: { status: 'Requested', patientName: patientName.trim() },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    await writeAuditLog(slot.id, 'status_change', {
      from: 'Available', to: 'Requested', patientName: patientName.trim(),
    }, req.user.id);

    res.json({ appointment: updated });
  } catch (err) {
    console.error('Request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/appointments/:id/confirm ──────────────────────────────────────
// Requested → Confirmed  (front-desk only)
router.post('/:id/confirm', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const slot = await findSlot(req.params.id, res);
    if (!slot) return;

    if (slot.status !== 'Requested') {
      return res.status(400).json({
        error: `Cannot confirm: current status is "${slot.status}". Only Requested appointments can be confirmed.`,
      });
    }

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: { status: 'Confirmed' },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    await writeAuditLog(slot.id, 'status_change', { from: 'Requested', to: 'Confirmed' }, req.user.id);

    res.json({ appointment: updated });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/appointments/:id/checkin ──────────────────────────────────────
// Confirmed → CheckedIn  (front-desk only)
router.post('/:id/checkin', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const slot = await findSlot(req.params.id, res);
    if (!slot) return;

    if (slot.status !== 'Confirmed') {
      return res.status(400).json({
        error: `Cannot check in: current status is "${slot.status}". Only Confirmed appointments can be checked in.`,
      });
    }

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: { status: 'CheckedIn' },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    await writeAuditLog(slot.id, 'status_change', { from: 'Confirmed', to: 'CheckedIn' }, req.user.id);

    res.json({ appointment: updated });
  } catch (err) {
    console.error('CheckIn error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/appointments/:id/complete ─────────────────────────────────────
// CheckedIn → Completed  (provider or front-desk, must be associated)
router.post('/:id/complete', authenticate, async (req, res) => {
  try {
    const slot = await findSlot(req.params.id, res);
    if (!slot) return;

    if (!canAccess(req.user, slot)) {
      return res.status(403).json({ error: 'Access denied: you are not associated with this appointment' });
    }

    if (slot.status !== 'CheckedIn') {
      return res.status(400).json({
        error: `Cannot complete: current status is "${slot.status}". Only CheckedIn appointments can be completed.`,
      });
    }

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: { status: 'Completed' },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    await writeAuditLog(slot.id, 'status_change', { from: 'CheckedIn', to: 'Completed' }, req.user.id);

    res.json({ appointment: updated });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/appointments/:id/noshow ───────────────────────────────────────
// Confirmed → NoShow  (front-desk only, only AFTER scheduled time has passed)
router.post('/:id/noshow', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const slot = await findSlot(req.params.id, res);
    if (!slot) return;

    if (slot.status !== 'Confirmed') {
      return res.status(400).json({
        error: `Cannot mark no-show: current status is "${slot.status}". Only Confirmed appointments can become NoShow.`,
      });
    }

    // Must be AFTER the scheduled start time
    if (new Date() <= new Date(slot.startTime)) {
      return res.status(400).json({
        error: 'Cannot mark no-show before the scheduled appointment time has passed.',
      });
    }

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: { status: 'NoShow' },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    await writeAuditLog(slot.id, 'status_change', { from: 'Confirmed', to: 'NoShow' }, req.user.id);

    res.json({ appointment: updated });
  } catch (err) {
    console.error('NoShow error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/appointments/:id/cancel ───────────────────────────────────────
// Requested | Confirmed → Cancelled  (front-desk only, requires reason)
router.post('/:id/cancel', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const slot = await findSlot(req.params.id, res);
    if (!slot) return;

    if (!CANCELLABLE.includes(slot.status)) {
      return res.status(400).json({
        error: `Cannot cancel: current status is "${slot.status}". Cancellation is only allowed before check-in (Requested or Confirmed).`,
      });
    }

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A cancellation reason is required' });
    }

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: { status: 'Cancelled', cancellationReason: reason.trim() },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    await writeAuditLog(slot.id, 'cancellation', {
      from: slot.status, to: 'Cancelled', reason: reason.trim(),
    }, req.user.id);

    res.json({ appointment: updated });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/appointments/:id/history ───────────────────────────────────────
// Immutable timeline — available to front-desk and associated providers
router.get('/:id/history', authenticate, async (req, res) => {
  try {
    const slot = await findSlot(req.params.id, res);
    if (!slot) return;

    if (!canAccess(req.user, slot)) {
      return res.status(403).json({ error: 'Access denied: you are not associated with this appointment' });
    }

    const history = await prisma.auditLog.findMany({
      where: { slotId: req.params.id },
      include: { performedBy: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ history });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
