const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middleware/authenticate');
const { writeAuditLog } = require('../lib/auditLog');

// ─── Helper: check provider access to appointment ─────────────────────────────
async function getSlotAndCheckAccess(slotId, userId, res) {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { careTeam: true },
  });
  if (!slot) {
    res.status(404).json({ error: 'Appointment not found' });
    return null;
  }

  // Provider must be scheduling or supporting provider
  const isScheduling = slot.providerId === userId;
  const isSupporting = slot.careTeam.some((ct) => ct.providerId === userId);

  if (!isScheduling && !isSupporting) {
    res.status(403).json({ error: 'Access denied: you are not associated with this appointment' });
    return null;
  }
  return slot;
}

// ─── GET /api/appointments/:id/notes ──────────────────────────────────────────
// List all notes for an appointment (scheduling or supporting provider, or front-desk)
router.get('/:id/notes', authenticate, async (req, res) => {
  try {
    // Front-desk can access any appointment's notes
    if (req.user.role !== 'front-desk') {
      const slot = await getSlotAndCheckAccess(req.params.id, req.user.id, res);
      if (!slot) return;
    } else {
      // Verify appointment exists
      const exists = await prisma.slot.findUnique({ where: { id: req.params.id } });
      if (!exists) return res.status(404).json({ error: 'Appointment not found' });
    }

    const notes = await prisma.visitNote.findMany({
      where: { slotId: req.params.id },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ notes });
  } catch (err) {
    console.error('List notes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/appointments/:id/notes ────────────────────────────────────────
// Add a visit note (provider only; must be scheduling or supporting provider)
router.post('/:id/notes', authenticate, async (req, res) => {
  try {
    // Only providers can write notes
    if (req.user.role !== 'provider') {
      return res.status(403).json({ error: 'Only providers can add visit notes' });
    }

    const slot = await getSlotAndCheckAccess(req.params.id, req.user.id, res);
    if (!slot) return;

    const { noteText } = req.body;
    if (!noteText || !noteText.trim()) {
      return res.status(400).json({ error: 'noteText is required' });
    }

    const note = await prisma.visitNote.create({
      data: {
        slotId: req.params.id,
        authorId: req.user.id,
        noteText: noteText.trim(),
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    await writeAuditLog(req.params.id, 'note_added', {
      noteId: note.id, authorId: req.user.id,
    }, req.user.id);

    res.status(201).json({ note });
  } catch (err) {
    console.error('Add note error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/notes/:noteId ──────────────────────────────────────────────────
// Edit a visit note (only the original author can edit)
router.put('/note/:noteId', authenticate, async (req, res) => {
  try {
    const note = await prisma.visitNote.findUnique({
      where: { id: req.params.noteId },
      include: { author: { select: { id: true, name: true } } },
    });
    if (!note) return res.status(404).json({ error: 'Visit note not found' });

    // Only the author can edit
    if (note.authorId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: only the note author can edit this note' });
    }

    const { noteText } = req.body;
    if (!noteText || !noteText.trim()) {
      return res.status(400).json({ error: 'noteText is required' });
    }

    const updated = await prisma.visitNote.update({
      where: { id: req.params.noteId },
      data: { noteText: noteText.trim() },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    res.json({ note: updated });
  } catch (err) {
    console.error('Edit note error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
