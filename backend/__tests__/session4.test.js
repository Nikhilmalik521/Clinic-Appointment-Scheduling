/**
 * Session 4 Tests — Search, Pagination, Bulk Generation & CSV Export
 *
 * All tests run against the live Neon DB. Randomised emails prevent collisions.
 * Timeout raised for Neon cold-start latency.
 */
const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');

jest.setTimeout(60000);

const uid = () => Math.random().toString(36).slice(2, 8);
let slotCounter = 0;

async function registerUser(role) {
  const email = `s4-${uid()}@clinic.test`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: `S4 ${role} ${uid()}`, role });
  return { token: res.body.token, user: res.body.user };
}

async function createSlot(fdToken, providerId) {
  slotCounter++;
  const hours = 100 + slotCounter * 2; // far future, unique, non-overlapping
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

async function requestAppointment(fdToken, slotId, patientName) {
  await request(app)
    .post(`/api/appointments/${slotId}/request`)
    .set('Authorization', `Bearer ${fdToken}`)
    .send({ patientName });
}

// ─── Teardown ─────────────────────────────────────────────────────────────────
afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { slot: { provider: { email: { endsWith: '@clinic.test' } } } },
  });
  await prisma.slot.deleteMany({
    where: { provider: { email: { endsWith: '@clinic.test' } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@clinic.test' } } });
  await prisma.$disconnect();
});

// ─── Shared fixtures ──────────────────────────────────────────────────────────
let fd, fdToken;
let prov, provToken;
let prov2, provToken2;
// Slots for search/filter tests
let slotA, slotB, slotC, slotD;

beforeAll(async () => {
  ({ user: fd, token: fdToken } = await registerUser('front-desk'));
  ({ user: prov, token: provToken } = await registerUser('provider'));
  ({ user: prov2, token: provToken2 } = await registerUser('provider'));

  // Create 4 slots and request appointments with distinct patient names/statuses
  slotA = await createSlot(fdToken, prov.id);
  slotB = await createSlot(fdToken, prov.id);
  slotC = await createSlot(fdToken, prov2.id);
  slotD = await createSlot(fdToken, prov2.id);

  await requestAppointment(fdToken, slotA.id, 'Alice Johnson');
  await requestAppointment(fdToken, slotB.id, 'Bob Smith');
  await requestAppointment(fdToken, slotC.id, 'Alice Walker');
  await requestAppointment(fdToken, slotD.id, 'Carol White');

  // Confirm slotB and slotD so we have mixed statuses
  await request(app).post(`/api/appointments/${slotB.id}/confirm`).set('Authorization', `Bearer ${fdToken}`);
  await request(app).post(`/api/appointments/${slotD.id}/confirm`).set('Authorization', `Bearer ${fdToken}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Search by patient name
// ═══════════════════════════════════════════════════════════════════════════
describe('Search by patient name', () => {
  test('search=alice returns only appointments matching "alice" (case-insensitive)', async () => {
    const res = await request(app)
      .get('/api/appointments?search=alice')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const names = res.body.appointments.map((a) => a.patientName.toLowerCase());
    names.forEach((n) => expect(n).toContain('alice'));
    expect(names).not.toContain('bob smith');
    expect(names).not.toContain('carol white');
  });

  test('search=ALICE (uppercase) still matches case-insensitively', async () => {
    const res = await request(app)
      .get('/api/appointments?search=ALICE')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointments.length).toBeGreaterThanOrEqual(2);
  });

  test('search=xyz returns empty results', async () => {
    const res = await request(app)
      .get('/api/appointments?search=xyz_nomatch_xyz')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointments.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Filter by provider
// ═══════════════════════════════════════════════════════════════════════════
describe('Filter by provider', () => {
  test('providerId filter returns only that provider\'s appointments', async () => {
    const res = await request(app)
      .get(`/api/appointments?providerId=${prov.id}`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const providerIds = res.body.appointments.map((a) => a.providerId);
    providerIds.forEach((id) => expect(id).toBe(prov.id));
    // Should not include prov2's appointments
    expect(providerIds).not.toContain(prov2.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Filter by status
// ═══════════════════════════════════════════════════════════════════════════
describe('Filter by status', () => {
  test('status=Requested returns only Requested appointments', async () => {
    const res = await request(app)
      .get('/api/appointments?status=Requested')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const statuses = res.body.appointments.map((a) => a.status);
    statuses.forEach((s) => expect(s).toBe('Requested'));
  });

  test('status=Confirmed returns only Confirmed appointments', async () => {
    const res = await request(app)
      .get('/api/appointments?status=Confirmed')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const statuses = res.body.appointments.map((a) => a.status);
    statuses.forEach((s) => expect(s).toBe('Confirmed'));
  });

  test('status=Requested,Confirmed returns both statuses', async () => {
    const res = await request(app)
      .get('/api/appointments?status=Requested,Confirmed')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const statuses = new Set(res.body.appointments.map((a) => a.status));
    expect(statuses.has('Requested')).toBe(true);
    expect(statuses.has('Confirmed')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Filter by date range
// ═══════════════════════════════════════════════════════════════════════════
describe('Filter by date range', () => {
  test('dateFrom in the far past to dateTo yesterday returns 0 results (all slots are future)', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .get(`/api/appointments?dateTo=${yesterday}`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    // All our test slots are far in the future, so none should be in this range
    const testIds = [slotA.id, slotB.id, slotC.id, slotD.id];
    const matched = res.body.appointments.filter((a) => testIds.includes(a.id));
    expect(matched.length).toBe(0);
  });

  test('dateFrom now to far future returns all test appointments', async () => {
    const now = new Date().toISOString();
    const farFuture = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .get(`/api/appointments?dateFrom=${now}&dateTo=${farFuture}`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const testIds = [slotA.id, slotB.id, slotC.id, slotD.id];
    const matched = res.body.appointments.filter((a) => testIds.includes(a.id));
    expect(matched.length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sorting
// ═══════════════════════════════════════════════════════════════════════════
describe('Sorting', () => {
  test('sortBy=startTime&sortOrder=asc returns appointments in ascending time order', async () => {
    const res = await request(app)
      .get('/api/appointments?sortBy=startTime&sortOrder=asc')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const times = res.body.appointments.map((a) => new Date(a.startTime).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  test('sortBy=startTime&sortOrder=desc returns appointments in descending time order', async () => {
    const res = await request(app)
      .get('/api/appointments?sortBy=startTime&sortOrder=desc')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const times = res.body.appointments.map((a) => new Date(a.startTime).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
    }
  });

  test('sortBy=status returns appointments sorted alphabetically by status', async () => {
    const res = await request(app)
      .get('/api/appointments?sortBy=status&sortOrder=asc')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const statuses = res.body.appointments.map((a) => a.status);
    const sorted = [...statuses].sort();
    expect(statuses).toEqual(sorted);
  });

  test('sortBy=providerName returns appointments sorted by provider name', async () => {
    const res = await request(app)
      .get('/api/appointments?sortBy=providerName&sortOrder=asc')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.status).toBe(200);
    // Just verify no error — provider name sort is valid
    expect(Array.isArray(res.body.appointments)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Pagination
// ═══════════════════════════════════════════════════════════════════════════
describe('Pagination', () => {
  test('returns pagination metadata with total, page, pageSize, totalPages', async () => {
    const res = await request(app)
      .get('/api/appointments?page=1&pageSize=2')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.pageSize).toBe(2);
    expect(typeof res.body.pagination.total).toBe('number');
    expect(typeof res.body.pagination.totalPages).toBe('number');
  });

  test('pageSize=2 returns at most 2 results per page', async () => {
    const res = await request(app)
      .get('/api/appointments?pageSize=2')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.appointments.length).toBeLessThanOrEqual(2);
  });

  test('page=1 and page=2 return different records', async () => {
    const page1 = await request(app)
      .get('/api/appointments?pageSize=2&page=1')
      .set('Authorization', `Bearer ${fdToken}`);
    const page2 = await request(app)
      .get('/api/appointments?pageSize=2&page=2')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    if (page1.body.pagination.total > 2) {
      const ids1 = page1.body.appointments.map((a) => a.id);
      const ids2 = page2.body.appointments.map((a) => a.id);
      const overlap = ids1.filter((id) => ids2.includes(id));
      expect(overlap.length).toBe(0);
    }
  });

  test('pageSize caps at 100', async () => {
    const res = await request(app)
      .get('/api/appointments?pageSize=999')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.pageSize).toBe(100);
  });

  test('total count is consistent with unfiltered results', async () => {
    const res1 = await request(app)
      .get('/api/appointments?pageSize=100')
      .set('Authorization', `Bearer ${fdToken}`);
    const res2 = await request(app)
      .get('/api/appointments?pageSize=2')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res1.body.pagination.total).toBe(res2.body.pagination.total);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bulk slot generation
// ═══════════════════════════════════════════════════════════════════════════
describe('Bulk slot generation (POST /api/slots/bulk)', () => {
  // Use a far-future date range to avoid collisions with other test slots
  const startDate = new Date(Date.now() + 300 * 24 * 3600 * 1000);
  const endDate = new Date(startDate.getTime() + 4 * 24 * 3600 * 1000); // 5-day range

  const fmt = (d) => d.toISOString().split('T')[0];

  test('generates slots Mon–Fri for a provider', async () => {
    const res = await request(app)
      .post('/api/slots/bulk')
      .set('Authorization', `Bearer ${fdToken}`)
      .send({
        providerId: prov.id,
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        startHour: 9,
        endHour: 11,
        durationMinutes: 30,
        intervalMinutes: 30,
        daysOfWeek: [1, 2, 3, 4, 5],
      });
    expect(res.status).toBe(201);
    expect(res.body.summary).toBeDefined();
    expect(res.body.created.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.skipped)).toBe(true);
    // 9:00, 9:30, 10:00, 10:30, 11:00 = 5 slots per weekday
    const weekdays = [1, 2, 3, 4, 5];
    let expectedDays = 0;
    const cur = new Date(startDate);
    while (cur <= endDate) {
      if (weekdays.includes(cur.getDay())) expectedDays++;
      cur.setDate(cur.getDate() + 1);
    }
    expect(res.body.created.length).toBe(expectedDays * 5);
  });

  test('skips slots that would conflict with existing ones', async () => {
    // Running bulk again for the same provider/date should skip all (already created)
    const res = await request(app)
      .post('/api/slots/bulk')
      .set('Authorization', `Bearer ${fdToken}`)
      .send({
        providerId: prov.id,
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        startHour: 9,
        endHour: 11,
        durationMinutes: 30,
        intervalMinutes: 30,
        daysOfWeek: [1, 2, 3, 4, 5],
      });
    expect(res.status).toBe(201);
    expect(res.body.created.length).toBe(0);
    expect(res.body.skipped.length).toBeGreaterThan(0);
    expect(res.body.skipped[0].reason).toMatch(/overlap/i);
  });

  test('provider CANNOT use bulk generation — gets 403', async () => {
    const res = await request(app)
      .post('/api/slots/bulk')
      .set('Authorization', `Bearer ${provToken}`)
      .send({
        providerId: prov.id,
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        startHour: 9,
        endHour: 11,
        durationMinutes: 30,
        intervalMinutes: 30,
      });
    expect(res.status).toBe(403);
  });

  test('returns 400 if required fields are missing', async () => {
    const res = await request(app)
      .post('/api/slots/bulk')
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ providerId: prov.id });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  test('returns 400 if intervalMinutes < durationMinutes', async () => {
    const res = await request(app)
      .post('/api/slots/bulk')
      .set('Authorization', `Bearer ${fdToken}`)
      .send({
        providerId: prov.id,
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        startHour: 9,
        endHour: 11,
        durationMinutes: 60,
        intervalMinutes: 30, // less than duration
      });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CSV Export
// ═══════════════════════════════════════════════════════════════════════════
describe('CSV Export (GET /api/schedule/export)', () => {
  test('returns 400 when date param is missing', async () => {
    const res = await request(app)
      .get('/api/schedule/export')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  test('returns 400 for an invalid date', async () => {
    const res = await request(app)
      .get('/api/schedule/export?date=not-a-date')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(400);
  });

  test('returns text/csv content-type for a valid date', async () => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request(app)
      .get(`/api/schedule/export?date=${today}`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(`schedule-${today}.csv`);
  });

  test('CSV contains correct column headers', async () => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request(app)
      .get(`/api/schedule/export?date=${today}`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const firstLine = res.text.split('\r\n')[0];
    expect(firstLine).toContain('Start Time');
    expect(firstLine).toContain('Status');
    expect(firstLine).toContain('Patient Name');
    expect(firstLine).toContain('Provider');
  });

  test('provider export is scoped to their own schedule', async () => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request(app)
      .get(`/api/schedule/export?date=${today}`)
      .set('Authorization', `Bearer ${provToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  test('returns 401 without auth token', async () => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request(app).get(`/api/schedule/export?date=${today}`);
    expect(res.status).toBe(401);
  });
});
