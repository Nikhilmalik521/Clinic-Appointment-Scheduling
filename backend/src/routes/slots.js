const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

// Statuses that mean the slot is no longer unbooked (can't be edited)
const BOOKED_STATUSES = ['Requested', 'Confirmed', 'CheckedIn', 'Completed', 'NoShow', 'Cancelled'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateSlotBody(body) {
  const { providerId, startTime, durationMinutes } = body;
  const errors = [];
  if (!providerId) errors.push('providerId is required');
  if (!startTime) errors.push('startTime is required');
  if (!durationMinutes) errors.push('durationMinutes is required');
  if (durationMinutes !== undefined && (isNaN(durationMinutes) || durationMinutes < 5)) {
    errors.push('durationMinutes must be a number >= 5');
  }
  if (startTime && isNaN(Date.parse(startTime))) {
    errors.push('startTime must be a valid ISO date string');
  }
  return errors;
}

/**
 * Check whether a proposed slot (start, duration) for a provider collides
 * with any existing non-archived, non-cancelled slot.
 * Excludes `excludeId` to allow edits of the same slot.
 */
async function hasConflict(providerId, startTime, durationMinutes, excludeId = null) {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const conflicting = await prisma.slot.findFirst({
    where: {
      providerId,
      isArchived: false,
      status: { notIn: ['Cancelled'] },
      id: excludeId ? { not: excludeId } : undefined,
      AND: [
        { startTime: { lt: end } },
        // slot ends after the proposed start
        // computed as: startTime + durationMinutes > start => startTime > start - durationMinutes
        // We use a raw comparison by checking start < slot_end
        // Prisma doesn't support computed columns, so we fetch candidates and filter in JS
      ],
    },
  });

  // Since Prisma can't compute "slot end time" in the DB,
  // we do a broader query and refine in JS.
  const candidates = await prisma.slot.findMany({
    where: {
      providerId,
      isArchived: false,
      status: { notIn: ['Cancelled'] },
      id: excludeId ? { not: excludeId } : undefined,
      startTime: { lt: end }, // slot starts before proposed end
    },
    select: { id: true, startTime: true, durationMinutes: true },
  });

  return candidates.some((slot) => {
    const slotEnd = new Date(slot.startTime.getTime() + slot.durationMinutes * 60 * 1000);
    return slotEnd > start; // slot ends after proposed start → overlap
  });
}

// ─── POST /api/slots — Create a slot (front-desk only) ───────────────────────
router.post('/', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const { providerId, startTime, durationMinutes } = req.body;

    const errors = validateSlotBody(req.body);
    if (errors.length) return res.status(400).json({ errors });

    // Verify the target provider exists and is a provider
    const provider = await prisma.user.findUnique({ where: { id: providerId } });
    if (!provider || provider.role !== 'provider') {
      return res.status(400).json({ error: 'providerId must reference a valid provider account' });
    }

    // Conflict check
    const conflict = await hasConflict(providerId, startTime, durationMinutes);
    if (conflict) {
      return res.status(409).json({ error: 'This time slot overlaps with an existing slot for this provider' });
    }

    const slot = await prisma.slot.create({
      data: {
        providerId,
        startTime: new Date(startTime),
        durationMinutes: parseInt(durationMinutes),
        status: 'Available',
      },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    res.status(201).json({ slot });
  } catch (err) {
    console.error('Create slot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/slots — List slots ─────────────────────────────────────────────
// Front-desk: sees all slots (optionally filter by providerId)
// Provider: sees only their own slots
router.get('/', authenticate, async (req, res) => {
  try {
    const { providerId, includeArchived } = req.query;

    let whereClause = {};

    if (req.user.role === 'provider') {
      // Providers only see their own slots
      whereClause.providerId = req.user.id;
    } else if (providerId) {
      // Front-desk can optionally filter by provider
      whereClause.providerId = providerId;
    }

    // Exclude archived unless explicitly requested
    if (includeArchived !== 'true') {
      whereClause.isArchived = false;
    }

    const slots = await prisma.slot.findMany({
      where: whereClause,
      include: { provider: { select: { id: true, name: true, email: true } } },
      orderBy: { startTime: 'asc' },
    });

    res.json({ slots, count: slots.length });
  } catch (err) {
    console.error('List slots error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/slots/:id — Get single slot ────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const slot = await prisma.slot.findUnique({
      where: { id: req.params.id },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    // Providers can only see their own slots
    if (req.user.role === 'provider' && slot.providerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: this slot belongs to another provider' });
    }

    res.json({ slot });
  } catch (err) {
    console.error('Get slot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/slots/:id — Edit an unbooked slot ──────────────────────────────
// Front-desk: can edit any unbooked slot
// Provider: can edit only their own unbooked slot
router.put('/:id', authenticate, async (req, res) => {
  try {
    const slot = await prisma.slot.findUnique({ where: { id: req.params.id } });
    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    // RBAC: provider can only edit their own
    if (req.user.role === 'provider' && slot.providerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: this slot belongs to another provider' });
    }

    // Cannot edit a booked slot
    if (BOOKED_STATUSES.includes(slot.status)) {
      return res.status(400).json({
        error: `Cannot edit a slot with status "${slot.status}". Only unbooked (Available) slots can be edited.`,
      });
    }

    // Cannot edit archived slot
    if (slot.isArchived) {
      return res.status(400).json({ error: 'Cannot edit an archived slot. Restore it first.' });
    }

    const { startTime, durationMinutes, providerId } = req.body;

    // Front-desk can reassign to another provider; providers cannot change providerId
    if (providerId && req.user.role === 'provider' && providerId !== req.user.id) {
      return res.status(403).json({ error: 'Providers cannot reassign a slot to another provider' });
    }

    // Validate provided fields
    const updates = {};
    if (startTime !== undefined) {
      if (isNaN(Date.parse(startTime))) return res.status(400).json({ error: 'startTime must be a valid ISO date string' });
      updates.startTime = new Date(startTime);
    }
    if (durationMinutes !== undefined) {
      if (isNaN(durationMinutes) || durationMinutes < 5) {
        return res.status(400).json({ error: 'durationMinutes must be a number >= 5' });
      }
      updates.durationMinutes = parseInt(durationMinutes);
    }
    if (providerId !== undefined) {
      const provider = await prisma.user.findUnique({ where: { id: providerId } });
      if (!provider || provider.role !== 'provider') {
        return res.status(400).json({ error: 'providerId must reference a valid provider account' });
      }
      updates.providerId = providerId;
    }

    // Conflict check with updated values
    const effectiveProviderId = updates.providerId ?? slot.providerId;
    const effectiveStart = updates.startTime ?? slot.startTime;
    const effectiveDuration = updates.durationMinutes ?? slot.durationMinutes;

    const conflict = await hasConflict(effectiveProviderId, effectiveStart, effectiveDuration, slot.id);
    if (conflict) {
      return res.status(409).json({ error: 'Updated time overlaps with an existing slot for this provider' });
    }

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: updates,
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    res.json({ slot: updated });
  } catch (err) {
    console.error('Edit slot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/slots/:id/archive — Archive a slot (front-desk only) ──────────
router.post('/:id/archive', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const slot = await prisma.slot.findUnique({ where: { id: req.params.id } });
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (slot.isArchived) return res.status(400).json({ error: 'Slot is already archived' });

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: { isArchived: true },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    res.json({ slot: updated, message: 'Slot archived successfully' });
  } catch (err) {
    console.error('Archive slot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/slots/:id/restore — Restore an archived slot (front-desk only) ─
router.post('/:id/restore', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const slot = await prisma.slot.findUnique({ where: { id: req.params.id } });
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (!slot.isArchived) return res.status(400).json({ error: 'Slot is not archived' });

    const updated = await prisma.slot.update({
      where: { id: req.params.id },
      data: { isArchived: false },
      include: { provider: { select: { id: true, name: true, email: true } } },
    });

    res.json({ slot: updated, message: 'Slot restored successfully' });
  } catch (err) {
    console.error('Restore slot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
