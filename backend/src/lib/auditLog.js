const prisma = require('./prisma');

/**
 * Write an immutable audit log entry.
 * Called inside every state transition, care-team change, and note creation.
 *
 * @param {string} slotId
 * @param {string} eventType - 'status_change' | 'cancellation' | 'care_team_change' | 'note_added'
 * @param {object} eventData - arbitrary JSON describing the event
 * @param {string} performedById - user ID who triggered the action
 */
async function writeAuditLog(slotId, eventType, eventData, performedById) {
  await prisma.auditLog.create({
    data: {
      slotId,
      eventType,
      eventData,
      performedById,
    },
  });
}

module.exports = { writeAuditLog };
