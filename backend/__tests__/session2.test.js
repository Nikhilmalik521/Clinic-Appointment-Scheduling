/**
 * Session 2 Tests — Auth, RBAC, and Slot APIs
 *
 * Uses supertest against the live Express app with the real Neon DB.
 * Tests use randomised emails so they don't collide across runs.
 */
const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 8);

async function registerUser(role) {
  const email = `test-${uid()}@clinic.test`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: `Test ${role}`, role });
  return { token: res.body.token, user: res.body.user, email };
}

// ─── Teardown: clean up test data ────────────────────────────────────────────
afterAll(async () => {
  await prisma.slot.deleteMany({ where: { patientName: null, status: 'Available' } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@clinic.test' } } });
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth Tests
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/register', () => {
  test('registers a front-desk user and returns a JWT', async () => {
    const email = `fd-${uid()}@clinic.test`;
    const res = await request(app).post('/api/auth/register').send({
      email,
      password: 'password123',
      name: 'Front Desk Test',
      role: 'front-desk',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('front-desk');
    expect(res.body.user.passwordHash).toBeUndefined(); // never exposed
  });

  test('registers a provider user', async () => {
    const email = `prov-${uid()}@clinic.test`;
    const res = await request(app).post('/api/auth/register').send({
      email,
      password: 'password123',
      name: 'Provider Test',
      role: 'provider',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('provider');
  });

  test('rejects duplicate email with 409', async () => {
    const email = `dup-${uid()}@clinic.test`;
    await request(app).post('/api/auth/register').send({ email, password: 'password123', name: 'Dup', role: 'provider' });
    const res = await request(app).post('/api/auth/register').send({ email, password: 'password123', name: 'Dup2', role: 'provider' });
    expect(res.status).toBe(409);
  });

  test('rejects invalid role with 400', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: `bad-${uid()}@clinic.test`,
      password: 'password123',
      name: 'Bad',
      role: 'admin',
    });
    expect(res.status).toBe(400);
    expect(res.body.errors || res.body.error).toBeDefined();
  });

  test('rejects short password with 400', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: `short-${uid()}@clinic.test`,
      password: '123',
      name: 'Short',
      role: 'provider',
    });
    expect(res.status).toBe(400);
  });

  test('rejects missing fields with 400', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'only@email.test' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  test('logs in with correct credentials and returns a JWT', async () => {
    const { email } = await registerUser('provider');
    const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('rejects wrong password with 401', async () => {
    const { email } = await registerUser('provider');
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  test('rejects non-existent email with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@clinic.test', password: 'password123' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  test('returns current user for valid token', async () => {
    const { token, user } = await registerUser('provider');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
  });

  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns 401 with tampered token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Slot CRUD + RBAC Tests
// ═══════════════════════════════════════════════════════════════════════════
describe('Slot API — RBAC & CRUD', () => {
  let fdToken, fd;
  let provToken, prov;
  let provToken2, prov2;
  let createdSlotId;

  beforeAll(async () => {
    ({ token: fdToken, user: fd } = await registerUser('front-desk'));
    ({ token: provToken, user: prov } = await registerUser('provider'));
    ({ token: provToken2, user: prov2 } = await registerUser('provider'));
  });

  // ── Create ────────────────────────────────────────────────────────────────
  describe('POST /api/slots', () => {
    test('front-desk can create a slot for a provider', async () => {
      const res = await request(app)
        .post('/api/slots')
        .set('Authorization', `Bearer ${fdToken}`)
        .send({
          providerId: prov.id,
          startTime: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          durationMinutes: 30,
        });
      expect(res.status).toBe(201);
      expect(res.body.slot.providerId).toBe(prov.id);
      createdSlotId = res.body.slot.id;
    });

    test('provider CANNOT create a slot — gets 403', async () => {
      const res = await request(app)
        .post('/api/slots')
        .set('Authorization', `Bearer ${provToken}`)
        .send({
          providerId: prov.id,
          startTime: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
          durationMinutes: 30,
        });
      expect(res.status).toBe(403);
    });

    test('rejects slot for non-existent provider with 400', async () => {
      const res = await request(app)
        .post('/api/slots')
        .set('Authorization', `Bearer ${fdToken}`)
        .send({
          providerId: 'non-existent-id',
          startTime: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
          durationMinutes: 30,
        });
      expect(res.status).toBe(400);
    });

    test('rejects overlapping slot with 409', async () => {
      // Create first slot
      const start = new Date(Date.now() + 96 * 3600 * 1000).toISOString();
      await request(app)
        .post('/api/slots')
        .set('Authorization', `Bearer ${fdToken}`)
        .send({ providerId: prov.id, startTime: start, durationMinutes: 60 });

      // Try to create overlapping slot (30 min into first)
      const overlap = new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
      const res = await request(app)
        .post('/api/slots')
        .set('Authorization', `Bearer ${fdToken}`)
        .send({ providerId: prov.id, startTime: overlap, durationMinutes: 60 });
      expect(res.status).toBe(409);
    });

    test('rejects unauthenticated request with 401', async () => {
      const res = await request(app).post('/api/slots').send({
        providerId: prov.id,
        startTime: new Date().toISOString(),
        durationMinutes: 30,
      });
      expect(res.status).toBe(401);
    });
  });

  // ── List ──────────────────────────────────────────────────────────────────
  describe('GET /api/slots', () => {
    test('front-desk sees all slots', async () => {
      const res = await request(app).get('/api/slots').set('Authorization', `Bearer ${fdToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.slots)).toBe(true);
      // Should include slots for both providers
      const providerIds = res.body.slots.map((s) => s.providerId);
      expect(providerIds).toContain(prov.id);
    });

    test('provider only sees their own slots', async () => {
      const res = await request(app).get('/api/slots').set('Authorization', `Bearer ${provToken}`);
      expect(res.status).toBe(200);
      const otherSlots = res.body.slots.filter((s) => s.providerId !== prov.id);
      expect(otherSlots.length).toBe(0);
    });

    test('returns 401 without token', async () => {
      const res = await request(app).get('/api/slots');
      expect(res.status).toBe(401);
    });
  });

  // ── Edit ──────────────────────────────────────────────────────────────────
  describe('PUT /api/slots/:id', () => {
    test('front-desk can edit an unbooked slot', async () => {
      const res = await request(app)
        .put(`/api/slots/${createdSlotId}`)
        .set('Authorization', `Bearer ${fdToken}`)
        .send({ durationMinutes: 45 });
      expect(res.status).toBe(200);
      expect(res.body.slot.durationMinutes).toBe(45);
    });

    test('provider CANNOT edit another provider\'s slot — gets 403', async () => {
      const res = await request(app)
        .put(`/api/slots/${createdSlotId}`)
        .set('Authorization', `Bearer ${provToken2}`)
        .send({ durationMinutes: 60 });
      expect(res.status).toBe(403);
    });

    test('provider can edit their own unbooked slot', async () => {
      const res = await request(app)
        .put(`/api/slots/${createdSlotId}`)
        .set('Authorization', `Bearer ${provToken}`)
        .send({ durationMinutes: 30 });
      expect(res.status).toBe(200);
    });

    test('returns 404 for non-existent slot', async () => {
      const res = await request(app)
        .put('/api/slots/non-existent-id')
        .set('Authorization', `Bearer ${fdToken}`)
        .send({ durationMinutes: 30 });
      expect(res.status).toBe(404);
    });
  });

  // ── Archive / Restore ────────────────────────────────────────────────────
  describe('POST /api/slots/:id/archive and /restore', () => {
    test('front-desk can archive a slot', async () => {
      const res = await request(app)
        .post(`/api/slots/${createdSlotId}/archive`)
        .set('Authorization', `Bearer ${fdToken}`);
      expect(res.status).toBe(200);
      expect(res.body.slot.isArchived).toBe(true);
    });

    test('provider CANNOT archive a slot — gets 403', async () => {
      // Create a fresh slot to test on
      const createRes = await request(app)
        .post('/api/slots')
        .set('Authorization', `Bearer ${fdToken}`)
        .send({
          providerId: prov.id,
          startTime: new Date(Date.now() + 200 * 3600 * 1000).toISOString(),
          durationMinutes: 30,
        });
      const res = await request(app)
        .post(`/api/slots/${createRes.body.slot.id}/archive`)
        .set('Authorization', `Bearer ${provToken}`);
      expect(res.status).toBe(403);
    });

    test('front-desk can restore an archived slot', async () => {
      const res = await request(app)
        .post(`/api/slots/${createdSlotId}/restore`)
        .set('Authorization', `Bearer ${fdToken}`);
      expect(res.status).toBe(200);
      expect(res.body.slot.isArchived).toBe(false);
    });

    test('archiving an already-archived slot returns 400', async () => {
      await request(app).post(`/api/slots/${createdSlotId}/archive`).set('Authorization', `Bearer ${fdToken}`);
      const res = await request(app)
        .post(`/api/slots/${createdSlotId}/archive`)
        .set('Authorization', `Bearer ${fdToken}`);
      expect(res.status).toBe(400);
    });
  });
});
