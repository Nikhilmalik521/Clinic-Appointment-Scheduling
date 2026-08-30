const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { writeAuditLog } = require('../lib/auditLog');

// ─── POST /api/appointments/:id/care-team ─────────────────────────────────────
// Add a supporting provider  (front-desk only)
router.post('/:id/care-team', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const slot = await prisma.slot.findUnique({
      where: { id: req.params.id },
      include: { careTeam: true },
    });
    if (!slot) return res.status(404).json({ error: 'Appointment not found' });

    const { providerId } = req.body;
    if (!providerId) return res.status(400).json({ error: 'providerId is required' });

    // Verify the target is a valid provider
    const provider = await prisma.user.findUnique({ where: { id: providerId } });
    if (!provider || provider.role !== 'provider') {
      return res.status(400).json({ error: 'providerId must reference a valid provider account' });
    }

    // Cannot add the scheduling provider as a supporting provider
    if (providerId === slot.providerId) {
      return res.status(400).json({ error: 'The scheduling provider cannot also be added as a supporting provider' });
    }

    // Check for duplicate
    const alreadyAdded = slot.careTeam.some((ct) => ct.providerId === providerId);
    if (alreadyAdded) {
      return res.status(409).json({ error: 'This provider is already on the care team for this appointment' });
    }

    await prisma.careTeam.create({ data: { slotId: req.params.id, providerId } });

    await writeAuditLog(slot.id, 'care_team_change', {
      action: 'added', providerId, providerName: provider.name,
    }, req.user.id);

    // Return updated slot with care team
    const updated = await prisma.slot.findUnique({
      where: { id: req.params.id },
      include: {
        provider: { select: { id: true, name: true, email: true } },
        careTeam: { include: { provider: { select: { id: true, name: true, email: true } } } },
      },
    });

    res.status(201).json({ appointment: updated, message: `${provider.name} added to care team` });
  } catch (err) {
    console.error('Add care team error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/appointments/:id/care-team/:providerId ───────────────────────
// Remove a supporting provider  (front-desk only)
router.delete('/:id/care-team/:providerId', authenticate, authorize('front-desk'), async (req, res) => {
  try {
    const { id: slotId, providerId } = req.params;

    const existing = await prisma.careTeam.findUnique({
      where: { slotId_providerId: { slotId, providerId } },
    });
    if (!existing) {
      return res.status(404).json({ error: 'This provider is not on the care team for this appointment' });
    }

    const provider = await prisma.user.findUnique({
      where: { id: providerId },
      select: { name: true },
    });

    await prisma.careTeam.delete({ where: { slotId_providerId: { slotId, providerId } } });

    await writeAuditLog(slotId, 'care_team_change', {
      action: 'removed', providerId, providerName: provider?.name,
    }, req.user.id);

    const updated = await prisma.slot.findUnique({
      where: { id: slotId },
      include: {
        provider: { select: { id: true, name: true, email: true } },
        careTeam: { include: { provider: { select: { id: true, name: true, email: true } } } },
      },
    });

    res.json({ appointment: updated, message: `${provider?.name ?? providerId} removed from care team` });
  } catch (err) {
    console.error('Remove care team error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
