/**
 * Seed script — creates demo users and realistic appointment data.
 *
 * Run: node src/seed.js
 *
 * Demo credentials (all passwords: Demo@1234):
 *   frontdesk@clinic.demo  — Front Desk
 *   smith@clinic.demo      — Dr. Sarah Smith (provider)
 *   jones@clinic.demo      — Dr. Marcus Jones (provider)
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PASS = bcrypt.hashSync('Demo@1234', 10);

const USERS = [
  { email: 'frontdesk@clinic.demo', name: 'Front Desk Staff', role: 'front-desk', passwordHash: PASS },
  { email: 'smith@clinic.demo',     name: 'Dr. Sarah Smith',  role: 'provider',   passwordHash: PASS },
  { email: 'jones@clinic.demo',     name: 'Dr. Marcus Jones', role: 'provider',   passwordHash: PASS },
];

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600 * 1000);
}

function daysFromNow(d, hour = 9) {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  dt.setHours(hour, 0, 0, 0);
  return dt;
}

async function main() {
  console.log('🌱 Seeding database...');

  // Upsert users
  const [fd, smith, jones] = await Promise.all(
    USERS.map(u => prisma.user.upsert({
      where:  { email: u.email },
    update: { name: u.name, role: u.role, passwordHash: u.passwordHash },
      create: u,
    }))
  );
  console.log('✅ Users upserted:', fd.email, smith.email, jones.email);

  // Clean up old seed slots to avoid duplicates
  await prisma.slot.deleteMany({
    where: { provider: { email: { endsWith: '@clinic.demo' } }, patientName: { not: null } },
  });

  // Helper: create a slot in a specific status by running transitions
  async function makeAppointment({ providerId, startTime, durationMinutes, patientName, status, cancellationReason }) {
    // Create the slot
    let slot = await prisma.slot.create({
      data: { providerId, startTime, durationMinutes, status: 'Available' },
    });

    if (status === 'Available') return slot;

    // Request
    slot = await prisma.slot.update({ where:{ id: slot.id }, data:{ status:'Requested', patientName } });
    await prisma.auditLog.create({ data:{ slotId: slot.id, performedById: fd.id, eventType:'status_change', eventData:{ from:'Available', to:'Requested' } } });
    if (status === 'Requested') return slot;

    // Confirm
    slot = await prisma.slot.update({ where:{ id: slot.id }, data:{ status:'Confirmed' } });
    await prisma.auditLog.create({ data:{ slotId: slot.id, performedById: fd.id, eventType:'status_change', eventData:{ from:'Requested', to:'Confirmed' } } });
    if (status === 'Confirmed') return slot;

    if (status === 'Cancelled') {
      slot = await prisma.slot.update({ where:{ id: slot.id }, data:{ status:'Cancelled', cancellationReason } });
      await prisma.auditLog.create({ data:{ slotId: slot.id, performedById: fd.id, eventType:'cancellation', eventData:{ reason: cancellationReason } } });
      return slot;
    }

    // Check in
    slot = await prisma.slot.update({ where:{ id: slot.id }, data:{ status:'CheckedIn' } });
    await prisma.auditLog.create({ data:{ slotId: slot.id, performedById: fd.id, eventType:'status_change', eventData:{ from:'Confirmed', to:'CheckedIn' } } });
    if (status === 'CheckedIn') return slot;

    // Complete
    slot = await prisma.slot.update({ where:{ id: slot.id }, data:{ status:'Completed' } });
    await prisma.auditLog.create({ data:{ slotId: slot.id, performedById: fd.id, eventType:'status_change', eventData:{ from:'CheckedIn', to:'Completed' } } });

    if (status === 'NoShow') {
      slot = await prisma.slot.update({ where:{ id: slot.id }, data:{ status:'NoShow' } });
      await prisma.auditLog.create({ data:{ slotId: slot.id, performedById: fd.id, eventType:'status_change', eventData:{ from:'Confirmed', to:'NoShow' } } });
    }

    return slot;
  }

  const appointments = [
    // Today
    { providerId: smith.id, startTime: daysFromNow(0, 9),  durationMinutes: 30, patientName: 'Alice Johnson',   status: 'CheckedIn' },
    { providerId: smith.id, startTime: daysFromNow(0, 10), durationMinutes: 45, patientName: 'Bob Martinez',    status: 'Confirmed' },
    { providerId: jones.id, startTime: daysFromNow(0, 11), durationMinutes: 30, patientName: 'Carol White',     status: 'Requested' },
    { providerId: jones.id, startTime: daysFromNow(0, 14), durationMinutes: 60, patientName: 'David Chen',      status: 'Available' },

    // Tomorrow
    { providerId: smith.id, startTime: daysFromNow(1, 9),  durationMinutes: 30, patientName: 'Emma Thompson',  status: 'Confirmed' },
    { providerId: smith.id, startTime: daysFromNow(1, 10), durationMinutes: 30, patientName: 'Frank Wilson',   status: 'Requested' },
    { providerId: jones.id, startTime: daysFromNow(1, 9),  durationMinutes: 45, patientName: 'Grace Lee',      status: 'Confirmed' },

    // This week - completed/no-show (past dates handled by direct DB write)
    { providerId: smith.id, startTime: daysFromNow(-2, 10), durationMinutes: 30, patientName: 'Henry Brown',   status: 'Completed' },
    { providerId: smith.id, startTime: daysFromNow(-1, 14), durationMinutes: 30, patientName: 'Iris Kumar',    status: 'NoShow' },
    { providerId: jones.id, startTime: daysFromNow(-3, 9),  durationMinutes: 45, patientName: 'Jack Davis',    status: 'Completed' },
    { providerId: jones.id, startTime: daysFromNow(-1, 11), durationMinutes: 30, patientName: 'Kate Sharma',   status: 'Cancelled', cancellationReason: 'Patient requested reschedule' },

    // Next week — available slots
    { providerId: smith.id, startTime: daysFromNow(7, 9),  durationMinutes: 30, patientName: null, status: 'Available' },
    { providerId: smith.id, startTime: daysFromNow(7, 10), durationMinutes: 30, patientName: null, status: 'Available' },
    { providerId: jones.id, startTime: daysFromNow(7, 9),  durationMinutes: 45, patientName: null, status: 'Available' },
  ];

  let created = 0;
  for (const a of appointments) {
    await makeAppointment(a);
    created++;
  }
  console.log(`✅ Created ${created} demo appointments`);

  // Add a visit note to one completed appointment
  const completedSlot = await prisma.slot.findFirst({ where: { patientName: 'Henry Brown' } });
  if (completedSlot) {
    const noteExists = await prisma.visitNote.findFirst({ where: { slotId: completedSlot.id } });
    if (!noteExists) {
      await prisma.visitNote.create({
        data: {
          slot:     { connect: { id: completedSlot.id } },
          provider: { connect: { id: smith.id } },
          noteText: 'Patient presented with mild lower back pain. Recommended physical therapy exercises and follow-up in 2 weeks.',
        },
      });
    }
    console.log('✅ Added demo visit note');
  }

  console.log('\n🎉 Seed complete!');
  console.log('Demo credentials (password: Demo@1234 for all):');
  console.log('  frontdesk@clinic.demo — Front Desk');
  console.log('  smith@clinic.demo     — Dr. Sarah Smith');
  console.log('  jones@clinic.demo     — Dr. Marcus Jones');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
