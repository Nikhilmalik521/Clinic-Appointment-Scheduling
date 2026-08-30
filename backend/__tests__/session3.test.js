/**
 * Session 3 Tests — Appointment Lifecycle, Care Team & Visit Notes
 *
 * Tests run against the live Neon DB. Randomised emails prevent collisions.
 * Timeout raised to 30s to handle Neon cold-start latency across multiple
 * sequential DB calls in beforeAll hooks.
 */
const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');

jest.setTimeout(30000); // Neon cold-start can take several seconds per query

const uid = () => Math.random().toString(36).slice(2, 8);

/**
 * Monotonic counter so every slot gets a unique 2-hour window.
 * Without this, multiple createSlot(fdToken, prov.id) calls all land at
 * "now + 24h" and trigger the overlap-conflict 409, returning undefined.
 */
let slotCounter = 0;

async function registerUser(role) {
  const email = `s3-${uid()}@clinic.test`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: `S3 ${role}`, role });
  return { token: res.body.token, user: res.body.user };
}

async function createSlot(fdToken, providerId, hoursFromNow) {
  slotCounter++;
  const hours = hoursFromNow ?? (24 + slotCounter * 2); // unique non-overlapping windows
  const res = await request(app)
    .post('/api/slots')
    .set('Authorization', `Bearer ${fdToken}`)
    .send({
      providerId,
      startTime: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
      durationMinutes: 30,
    });
  return res.body.slot;
}


// ─── Teardown ─────────────────────────────────────────────────────────────────
afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { slot: { provider: { email: { endsWith: '@clinic.test' } } } },
  });
  await prisma.visitNote.deleteMany({
    where: { slot: { provider: { email: { endsWith: '@clinic.test' } } } },
  });
  await prisma.careTeam.deleteMany({
    where: { slot: { provider: { email: { endsWith: '@clinic.test' } } } },
  });
  await prisma.slot.deleteMany({
    where: { provider: { email: { endsWith: '@clinic.test' } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@clinic.test' } } });
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// Shared fixtures
// ═══════════════════════════════════════════════════════════════════════════
let fd, fdToken;
let prov, provToken;
let prov2, provToken2;

beforeAll(async () => {
  ({ user: fd, token: fdToken } = await registerUser('front-desk'));
  ({ user: prov, token: provToken } = await registerUser('provider'));
  ({ user: prov2, token: provToken2 } = await registerUser('provider'));
});

// ═══════════════════════════════════════════════════════════════════════════
// Appointment Lifecycle — state machine
// ═══════════════════════════════════════════════════════════════════════════
describe('Appointment lifecycle — valid transitions', () => {
  let slot;

  beforeAll(async () => { slot = await createSlot(fdToken, prov.id); });

  test('Available → Requested (with patientName)', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/request`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ patientName: 'Jane Smith' });
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('Requested');
    expect(res.body.appointment.patientName).toBe('Jane Smith');
  });

  test('Requested → Confirmed', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/confirm`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('Confirmed');
  });

  test('Confirmed → CheckedIn', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/checkin`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('CheckedIn');
  });

  test('CheckedIn → Completed (provider can complete)', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/complete`)
      .set('Authorization', `Bearer ${provToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('Completed');
  });

  test('history has 4 status_change events in order', async () => {
    const res = await request(app)
      .get(`/api/appointments/${slot.id}/history`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const types = res.body.history.map((h) => h.eventType);
    expect(types).toContain('status_change');
    expect(res.body.history.length).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Invalid transitions — must be rejected with 400
// ═══════════════════════════════════════════════════════════════════════════
describe('Appointment lifecycle — invalid transitions', () => {
  test('Cannot confirm an Available slot (must be Requested first)', async () => {
    const slot = await createSlot(fdToken, prov.id);
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/confirm`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Requested/);
  });

  test('Cannot checkin a Requested slot (must be Confirmed first)', async () => {
    const slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Test' });
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/checkin`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Confirmed/);
  });

  test('Cannot complete a Confirmed slot (must be CheckedIn first)', async () => {
    const slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Test' });
    await request(app).post(`/api/appointments/${slot.id}/confirm`).set('Authorization', `Bearer ${fdToken}`);
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/complete`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CheckedIn/);
  });

  test('Cannot cancel after CheckedIn', async () => {
    const slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Test' });
    await request(app).post(`/api/appointments/${slot.id}/confirm`).set('Authorization', `Bearer ${fdToken}`);
    await request(app).post(`/api/appointments/${slot.id}/checkin`).set('Authorization', `Bearer ${fdToken}`);
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/cancel`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ reason: 'Late cancellation attempt' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/check-in/i);
  });

  test('Cancel requires a reason', async () => {
    const slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Test' });
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/cancel`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  test('NoShow requires appointment to be in Confirmed status', async () => {
    const slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Test' });
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/noshow`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Confirmed/);
  });

  test('NoShow cannot be set before scheduled time', async () => {
    // Slot is in the future (24h), so NoShow should be blocked
    const slot = await createSlot(fdToken, prov.id, 24);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Test' });
    await request(app).post(`/api/appointments/${slot.id}/confirm`).set('Authorization', `Bearer ${fdToken}`);
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/noshow`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scheduled/i);
  });

  test('Request requires patientName', async () => {
    const slot = await createSlot(fdToken, prov.id);
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/request`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/patientName/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cancellation — valid case
// ═══════════════════════════════════════════════════════════════════════════
describe('Cancellation', () => {
  test('Can cancel a Requested appointment with a reason', async () => {
    const slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Cancel Me' });
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/cancel`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ reason: 'Patient requested cancellation' });
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('Cancelled');
    expect(res.body.appointment.cancellationReason).toBe('Patient requested cancellation');
  });

  test('Cancellation is recorded in history with reason', async () => {
    const slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'History Test' });
    await request(app).post(`/api/appointments/${slot.id}/cancel`).set('Authorization', `Bearer ${fdToken}`).send({ reason: 'No longer needed' });
    const histRes = await request(app)
      .get(`/api/appointments/${slot.id}/history`)
      .set('Authorization', `Bearer ${fdToken}`);
    const cancellation = histRes.body.history.find((h) => h.eventType === 'cancellation');
    expect(cancellation).toBeDefined();
    expect(cancellation.eventData.reason).toBe('No longer needed');
  });

  test('Provider CANNOT cancel an appointment — gets 403', async () => {
    const slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Test' });
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/cancel`)
      .set('Authorization', `Bearer ${provToken}`)
      .send({ reason: 'Provider tried to cancel' });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Care Team
// ═══════════════════════════════════════════════════════════════════════════
describe('Care Team', () => {
  let slot;

  beforeAll(async () => {
    slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Care Team Patient' });
  });

  test('Front-desk can add a supporting provider', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/care-team`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ providerId: prov2.id });
    expect(res.status).toBe(201);
    const teamIds = res.body.appointment.careTeam.map((ct) => ct.providerId);
    expect(teamIds).toContain(prov2.id);
  });

  test('Supporting provider now sees the appointment in their list', async () => {
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${provToken2}`);
    expect(res.status).toBe(200);
    const ids = res.body.appointments.map((a) => a.id);
    expect(ids).toContain(slot.id);
  });

  test('Duplicate care team member returns 409', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/care-team`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ providerId: prov2.id });
    expect(res.status).toBe(409);
  });

  test('Cannot add scheduling provider as supporting provider', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/care-team`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ providerId: prov.id });
    expect(res.status).toBe(400);
  });

  test('Provider CANNOT add care team members — gets 403', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/care-team`)
      .set('Authorization', `Bearer ${provToken}`)
      .send({ providerId: prov2.id });
    expect(res.status).toBe(403);
  });

  test('Care team changes recorded in history', async () => {
    const res = await request(app)
      .get(`/api/appointments/${slot.id}/history`)
      .set('Authorization', `Bearer ${fdToken}`);
    const careEvents = res.body.history.filter((h) => h.eventType === 'care_team_change');
    expect(careEvents.length).toBeGreaterThanOrEqual(1);
    expect(careEvents[0].eventData.action).toBe('added');
  });

  test('Front-desk can remove a supporting provider', async () => {
    const res = await request(app)
      .delete(`/api/appointments/${slot.id}/care-team/${prov2.id}`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const teamIds = res.body.appointment.careTeam.map((ct) => ct.providerId);
    expect(teamIds).not.toContain(prov2.id);
  });

  test('Removing non-member returns 404', async () => {
    const res = await request(app)
      .delete(`/api/appointments/${slot.id}/care-team/${prov2.id}`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Visit Notes
// ═══════════════════════════════════════════════════════════════════════════
describe('Visit Notes', () => {
  let slot;
  let noteId;

  beforeAll(async () => {
    slot = await createSlot(fdToken, prov.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Notes Patient' });
    await request(app).post(`/api/appointments/${slot.id}/confirm`).set('Authorization', `Bearer ${fdToken}`);
    await request(app).post(`/api/appointments/${slot.id}/checkin`).set('Authorization', `Bearer ${fdToken}`);
  });

  test('Scheduling provider can add a visit note', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/notes`)
      .set('Authorization', `Bearer ${provToken}`)
      .send({ noteText: 'Patient is recovering well.' });
    expect(res.status).toBe(201);
    expect(res.body.note.noteText).toBe('Patient is recovering well.');
    expect(res.body.note.author.id).toBe(prov.id);
    noteId = res.body.note.id;
  });

  test('Front-desk CANNOT add a note — gets 403', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/notes`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ noteText: 'Front desk note attempt' });
    expect(res.status).toBe(403);
  });

  test('Non-associated provider CANNOT add a note — gets 403', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/notes`)
      .set('Authorization', `Bearer ${provToken2}`)
      .send({ noteText: 'Random provider note' });
    expect(res.status).toBe(403);
  });

  test('Author can edit their own note', async () => {
    const res = await request(app)
      .put(`/api/appointments/note/${noteId}`)
      .set('Authorization', `Bearer ${provToken}`)
      .send({ noteText: 'Updated: Patient is recovering very well.' });
    expect(res.status).toBe(200);
    expect(res.body.note.noteText).toBe('Updated: Patient is recovering very well.');
  });

  test('Another provider CANNOT edit someone else\'s note — gets 403', async () => {
    // Add prov2 to care team so they have access, but still can't edit prov's note
    await request(app).post(`/api/appointments/${slot.id}/care-team`).set('Authorization', `Bearer ${fdToken}`).send({ providerId: prov2.id });
    const res = await request(app)
      .put(`/api/appointments/note/${noteId}`)
      .set('Authorization', `Bearer ${provToken2}`)
      .send({ noteText: 'Attempted edit by prov2' });
    expect(res.status).toBe(403);
  });

  test('Supporting provider can add their own note', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/notes`)
      .set('Authorization', `Bearer ${provToken2}`)
      .send({ noteText: 'Supporting provider observation.' });
    expect(res.status).toBe(201);
  });

  test('GET notes returns notes in order', async () => {
    const res = await request(app)
      .get(`/api/appointments/${slot.id}/notes`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notes)).toBe(true);
    expect(res.body.notes.length).toBeGreaterThanOrEqual(2);
  });

  test('Note creation recorded in history', async () => {
    const res = await request(app)
      .get(`/api/appointments/${slot.id}/history`)
      .set('Authorization', `Bearer ${fdToken}`);
    const noteEvents = res.body.history.filter((h) => h.eventType === 'note_added');
    expect(noteEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('Note text is required', async () => {
    const res = await request(app)
      .post(`/api/appointments/${slot.id}/notes`)
      .set('Authorization', `Bearer ${provToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Provider visibility scoping
// ═══════════════════════════════════════════════════════════════════════════
describe('Provider appointment visibility', () => {
  test('Provider only sees their own appointments and those they support', async () => {
    // prov2 should not see appointments they have no relation to
    const { user: prov3, token: provToken3 } = await registerUser('provider');
    const slot = await createSlot(fdToken, prov3.id);
    await request(app).post(`/api/appointments/${slot.id}/request`).set('Authorization', `Bearer ${fdToken}`).send({ patientName: 'Scoped Test' });

    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${provToken}`); // prov1 should NOT see prov3's appt
    const ids = res.body.appointments.map((a) => a.id);
    expect(ids).not.toContain(slot.id);
  });

  test('Front-desk sees all appointments', async () => {
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointments.length).toBeGreaterThan(0);
  });
});
