/**
 * Session 5 Tests — Alerts, Dashboard & Audit Log
 *
 * Tests run against the live Neon DB. Timeout raised for Neon cold-start.
 */
const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');
const { computeActiveAlerts, ALERT_WINDOW_MS, CRITICAL_WINDOW_MS } =
  require('../src/routes/alerts');

jest.setTimeout(60000);

const uid = () => Math.random().toString(36).slice(2, 8);
let slotCounter = 0;

async function registerUser(role) {
  const email = `s5-${uid()}@clinic.test`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: `S5 ${role} ${uid()}`, role });
  return { token: res.body.token, user: res.body.user };
}

async function createSlotAt(fdToken, providerId, startTime) {
  const res = await request(app)
    .post('/api/slots')
    .set('Authorization', `Bearer ${fdToken}`)
    .send({ providerId, startTime: startTime.toISOString(), durationMinutes: 30 });
  return res.body.slot;
}

async function createFutureSlot(fdToken, providerId) {
  slotCounter++;
  const hours = 200 + slotCounter * 2;
  return createSlotAt(fdToken, providerId, new Date(Date.now() + hours * 3600 * 1000));
}

// ─── Teardown ─────────────────────────────────────────────────────────────────
afterAll(async () => {
  await prisma.alertDismissal.deleteMany({
    where: { slot: { provider: { email: { endsWith: '@clinic.test' } } } },
  });
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

beforeAll(async () => {
  ({ user: fd, token: fdToken } = await registerUser('front-desk'));
  ({ user: prov, token: provToken } = await registerUser('provider'));
});

// ═══════════════════════════════════════════════════════════════════════════
// computeActiveAlerts — pure unit tests (no DB)
// ═══════════════════════════════════════════════════════════════════════════
describe('computeActiveAlerts — unit tests (no DB)', () => {
  const now = new Date();

  const slotIn20h = { id: 'a', startTime: new Date(now.getTime() + 20 * 3600 * 1000) };
  const slotIn30m = { id: 'b', startTime: new Date(now.getTime() + 30 * 60 * 1000) };
  const slotIn2h  = { id: 'c', startTime: new Date(now.getTime() + 2 * 3600 * 1000) };

  test('shows undismissed alert within 24h window', () => {
    const active = computeActiveAlerts([slotIn20h], [], now);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('a');
  });

  test('hides dismissed alert outside critical window', () => {
    const dismissals = [{ slotId: 'a' }];
    const active = computeActiveAlerts([slotIn20h], dismissals, now);
    expect(active).toHaveLength(0);
  });

  test('reappears dismissed alert inside 1-hour critical window', () => {
    // slotIn30m is within the 1-hour critical window
    const dismissals = [{ slotId: 'b' }];
    const active = computeActiveAlerts([slotIn30m], dismissals, now);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('b');
  });

  test('dismissed alert at 2h (outside critical) stays hidden', () => {
    const dismissals = [{ slotId: 'c' }];
    const active = computeActiveAlerts([slotIn2h], dismissals, now);
    expect(active).toHaveLength(0);
  });

  test('multiple slots: mix of dismissed and active', () => {
    // slotIn20h dismissed (hidden), slotIn30m dismissed but critical (shown), slotIn2h not dismissed (shown)
    const dismissals = [{ slotId: 'a' }, { slotId: 'b' }];
    const active = computeActiveAlerts([slotIn20h, slotIn30m, slotIn2h], dismissals, now);
    const ids = active.map((s) => s.id);
    expect(ids).not.toContain('a');  // dismissed outside critical
    expect(ids).toContain('b');      // dismissed BUT in critical window → shown
    expect(ids).toContain('c');      // not dismissed
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Alert API — RBAC
// ═══════════════════════════════════════════════════════════════════════════
describe('Alerts — RBAC', () => {
  test('Provider CANNOT access alerts — gets 403', async () => {
    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${provToken}`);
    expect(res.status).toBe(403);
  });

  test('Provider CANNOT access alert count — gets 403', async () => {
    const res = await request(app)
      .get('/api/alerts/count')
      .set('Authorization', `Bearer ${provToken}`);
    expect(res.status).toBe(403);
  });

  test('Unauthenticated request gets 401', async () => {
    const res = await request(app).get('/api/alerts');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Alert API — list and count
// ═══════════════════════════════════════════════════════════════════════════
describe('Alerts — list and count', () => {
  test('GET /api/alerts returns { alerts, count } with correct shape', async () => {
    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.alerts)).toBe(true);
    expect(typeof res.body.count).toBe('number');
  });

  test('GET /api/alerts/count returns { count } number', async () => {
    const res = await request(app)
      .get('/api/alerts/count')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
  });

  test('Available slot does NOT appear as an alert', async () => {
    // Create a slot and leave it Available (no request)
    const slot = await createFutureSlot(fdToken, prov.id);
    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${fdToken}`);
    const alertSlotIds = res.body.alerts.map((a) => a.slotId);
    expect(alertSlotIds).not.toContain(slot.id);
  });

  test('Slot far in the future (>24h) does NOT appear as an alert', async () => {
    // createFutureSlot puts it 400+h in the future — well outside 24h window
    const slot = await createFutureSlot(fdToken, prov.id);
    await request(app)
      .post(`/api/appointments/${slot.id}/request`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ patientName: 'Far Future Patient' });

    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${fdToken}`);
    const alertSlotIds = res.body.alerts.map((a) => a.slotId);
    expect(alertSlotIds).not.toContain(slot.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Alert dismissal
// ═══════════════════════════════════════════════════════════════════════════
describe('Alert dismissal', () => {
  let nearSlot; // Requested slot within the 24h alert window

  beforeAll(async () => {
    // Create slot 2 hours from now so it's inside the 24h alert window
    // but outside the 1-hour critical window
    const twoHoursFromNow = new Date(Date.now() + 2 * 3600 * 1000);
    nearSlot = await createSlotAt(fdToken, prov.id, twoHoursFromNow);
    await request(app)
      .post(`/api/appointments/${nearSlot.id}/request`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ patientName: 'Near Patient' });
  });

  test('Requested slot within 24h appears as an alert', async () => {
    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const alertSlotIds = res.body.alerts.map((a) => a.slotId);
    expect(alertSlotIds).toContain(nearSlot.id);
  });

  test('Alert has correct fields: slotId, patientName, startTime, provider, minutesUntilStart', async () => {
    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${fdToken}`);
    const alert = res.body.alerts.find((a) => a.slotId === nearSlot.id);
    expect(alert).toBeDefined();
    expect(alert.patientName).toBe('Near Patient');
    expect(alert.startTime).toBeDefined();
    expect(alert.provider).toBeDefined();
    expect(typeof alert.minutesUntilStart).toBe('number');
    expect(typeof alert.isCritical).toBe('boolean');
  });

  test('Dismissing a 2-hour alert removes it from the list', async () => {
    await request(app)
      .post(`/api/alerts/${nearSlot.id}/dismiss`)
      .set('Authorization', `Bearer ${fdToken}`);

    const res = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${fdToken}`);
    const alertSlotIds = res.body.alerts.map((a) => a.slotId);
    expect(alertSlotIds).not.toContain(nearSlot.id);
  });

  test('Alert count decreases after dismissal', async () => {
    // Create a fresh near-slot and get count before and after dismiss
    const slotTime = new Date(Date.now() + 3 * 3600 * 1000);
    const freshSlot = await createSlotAt(fdToken, prov.id, slotTime);
    await request(app)
      .post(`/api/appointments/${freshSlot.id}/request`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ patientName: 'Count Test Patient' });

    const before = await request(app)
      .get('/api/alerts/count')
      .set('Authorization', `Bearer ${fdToken}`);

    await request(app)
      .post(`/api/alerts/${freshSlot.id}/dismiss`)
      .set('Authorization', `Bearer ${fdToken}`);

    const after = await request(app)
      .get('/api/alerts/count')
      .set('Authorization', `Bearer ${fdToken}`);

    expect(after.body.count).toBe(before.body.count - 1);
  });

  test('Dismissing a non-Requested slot returns 400', async () => {
    const availableSlot = await createFutureSlot(fdToken, prov.id);
    const res = await request(app)
      .post(`/api/alerts/${availableSlot.id}/dismiss`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(400);
  });

  test('Dismissing a non-existent slot returns 404', async () => {
    const res = await request(app)
      .post('/api/alerts/nonexistent-id/dismiss')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard metrics
// ═══════════════════════════════════════════════════════════════════════════
describe('Dashboard metrics', () => {
  test('GET /api/dashboard returns correct shape', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(typeof body.appointmentsToday).toBe('number');
    expect(typeof body.checkedIn).toBe('number');
    expect(typeof body.noShowsThisWeek).toBe('number');
    expect(typeof body.upcomingConfirmed).toBe('number');
    expect(Array.isArray(body.byStatus)).toBe(true);
    expect(Array.isArray(body.byProvider)).toBe(true);
  });

  test('byStatus entries have { status, count } shape', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${fdToken}`);
    res.body.byStatus.forEach((item) => {
      expect(typeof item.status).toBe('string');
      expect(typeof item.count).toBe('number');
    });
  });

  test('byProvider entries have { provider: { id, name }, count } shape', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${fdToken}`);
    res.body.byProvider.forEach((item) => {
      expect(item.provider).toBeDefined();
      expect(item.provider.id).toBeDefined();
      expect(typeof item.count).toBe('number');
    });
  });

  test('Provider CANNOT access dashboard — gets 403', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${provToken}`);
    expect(res.status).toBe(403);
  });

  test('Unauthenticated request gets 401', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  test('upcomingConfirmed is a non-negative integer', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.body.upcomingConfirmed).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard — weekly no-show rate
// ═══════════════════════════════════════════════════════════════════════════
describe('Dashboard — weekly no-show rate', () => {
  test('GET /api/dashboard/no-show-rate returns 8 week entries', async () => {
    const res = await request(app)
      .get('/api/dashboard/no-show-rate')
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.weeks)).toBe(true);
    expect(res.body.weeks).toHaveLength(8);
  });

  test('Each week entry has weekStart, weekEnd, noShows, total, noShowRate', async () => {
    const res = await request(app)
      .get('/api/dashboard/no-show-rate')
      .set('Authorization', `Bearer ${fdToken}`);
    res.body.weeks.forEach((week) => {
      expect(typeof week.weekStart).toBe('string');
      expect(typeof week.weekEnd).toBe('string');
      expect(typeof week.noShows).toBe('number');
      expect(typeof week.total).toBe('number');
      expect(typeof week.noShowRate).toBe('number');
      expect(week.noShowRate).toBeGreaterThanOrEqual(0);
      expect(week.noShowRate).toBeLessThanOrEqual(100);
    });
  });

  test('Weeks are in chronological order (oldest first)', async () => {
    const res = await request(app)
      .get('/api/dashboard/no-show-rate')
      .set('Authorization', `Bearer ${fdToken}`);
    const starts = res.body.weeks.map((w) => new Date(w.weekStart).getTime());
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    }
  });

  test('Provider CANNOT access no-show rate — gets 403', async () => {
    const res = await request(app)
      .get('/api/dashboard/no-show-rate')
      .set('Authorization', `Bearer ${provToken}`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Audit log — immutability (no edit/delete endpoints)
// ═══════════════════════════════════════════════════════════════════════════
describe('Audit log — append-only enforcement', () => {
  let slot;

  beforeAll(async () => {
    slot = await createFutureSlot(fdToken, prov.id);
    await request(app)
      .post(`/api/appointments/${slot.id}/request`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ patientName: 'Audit Patient' });
  });

  test('History endpoint returns audit events in chronological order', async () => {
    // Advance through a couple of transitions to create history
    await request(app).post(`/api/appointments/${slot.id}/confirm`).set('Authorization', `Bearer ${fdToken}`);
    await request(app).post(`/api/appointments/${slot.id}/checkin`).set('Authorization', `Bearer ${fdToken}`);

    const res = await request(app)
      .get(`/api/appointments/${slot.id}/history`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(200);
    const events = res.body.history;
    expect(events.length).toBeGreaterThanOrEqual(3);

    // Check chronological order
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(events[i - 1].createdAt).getTime());
    }
  });

  test('No PUT endpoint exists for audit logs — returns 404', async () => {
    // Try to PUT/PATCH to an audit endpoint — must not exist
    const res = await request(app)
      .put(`/api/appointments/${slot.id}/history/fake-id`)
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ eventType: 'tampered' });
    expect(res.status).toBe(404);
  });

  test('No DELETE endpoint exists for audit logs — returns 404', async () => {
    const res = await request(app)
      .delete(`/api/appointments/${slot.id}/history/fake-id`)
      .set('Authorization', `Bearer ${fdToken}`);
    expect(res.status).toBe(404);
  });

  test('Each history event includes performedBy user details', async () => {
    const res = await request(app)
      .get(`/api/appointments/${slot.id}/history`)
      .set('Authorization', `Bearer ${fdToken}`);
    res.body.history.forEach((event) => {
      expect(event.performedBy).toBeDefined();
      expect(event.performedBy.id).toBeDefined();
      expect(event.performedBy.name).toBeDefined();
    });
  });

  test('Each history event has eventType, eventData, and createdAt', async () => {
    const res = await request(app)
      .get(`/api/appointments/${slot.id}/history`)
      .set('Authorization', `Bearer ${fdToken}`);
    res.body.history.forEach((event) => {
      expect(typeof event.eventType).toBe('string');
      expect(event.eventData).toBeDefined();
      expect(event.createdAt).toBeDefined();
    });
  });

  test('Provider cannot access history of unassociated appointment — gets 403', async () => {
    const { token: otherProvToken } = await registerUser('provider');
    const res = await request(app)
      .get(`/api/appointments/${slot.id}/history`)
      .set('Authorization', `Bearer ${otherProvToken}`);
    expect(res.status).toBe(403);
  });
});
