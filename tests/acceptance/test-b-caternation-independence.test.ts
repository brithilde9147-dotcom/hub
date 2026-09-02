/**
 * Acceptance Test B — CaterNation revision letters are independent
 *
 * Verifies that each CaterNation revision (12-345A, 12-345B, etc.) is a
 * separate OrderUpdate record, and that resolving one does NOT affect others.
 *
 * Core invariant: resolving Revision A must not change Revision B's state.
 *
 * Scenario (synthetic data only):
 *   - Le Box Lunch Cafe × CATERNATION × NEW_ORDER order exists
 *   - Two revisions received: Rev A and Rev B (both UNRESOLVED)
 *   - Staff resolves Rev A
 *   - Rev B must still be UNRESOLVED
 *   - hasUnresolvedUpdates must still be true (B is open)
 *   - operationalReadiness must still be false (B blocks it)
 *   - After resolving Rev B: hasUnresolvedUpdates = false
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { computeOperationalReadiness } from '../../src/lib/operational-readiness'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL } },
})

let businessId: string
let orderId: string
let updateIdA: string
let updateIdB: string
let adminUserId: string

beforeAll(async () => {
  const business = await prisma.business.create({
    data: {
      name: '[TEST] Synthetic Le Box Co',
      slug: `test-lebox-${Date.now()}`,
      isActive: true,
    },
  })
  businessId = business.id

  // WorkflowDefinition for CaterNation NEW_ORDER
  await prisma.workflowDefinition.create({
    data: {
      businessId,
      channel: 'CATERNATION',
      recordContext: 'NEW_ORDER',
      requiredTaskTypes: [
        'CATERNATION_ACCEPT_VIA_EMAIL_OR_TEXT',
        'DOCUMENT_UPLOAD_AND_REVIEW',
        'ORDER_VERIFICATION',
        'SEVENTEEN_HATS_CREATE_OR_UPDATE',
        'SLACK_CHANNEL_CREATE',
        'SLACK_CHANNEL_NOTIFY',
        'GOOGLE_CALENDAR_ADD',
        'DRIVER_ASSIGN',
      ],
      isActive: true,
    },
  })

  const adminUser = await prisma.user.create({
    data: {
      name: '[TEST] Admin User B',
      email: `test-admin-b-${Date.now()}@example.test`,
      role: 'ADMIN',
      isActive: true,
    },
  })
  adminUserId = adminUser.id

  // Synthetic customer and order
  const customer = await prisma.customer.create({
    data: {
      name: '[SYNTHETIC] Corp Catering Inc',
      email: 'synthetic-b@example.test',
    },
  })

  const eventDate = new Date()
  eventDate.setDate(eventDate.getDate() + 21)

  const order = await prisma.order.create({
    data: {
      businessId,
      customerId: customer.id,
      channel: 'CATERNATION',
      externalOrderId: '99-SYNTH',
      eventDate,
      status: 'CONFIRMED',
      originalProcessingComplete: true, // Original processing done
    },
  })
  orderId = order.id

  // Complete all original NEW_ORDER tasks
  await prisma.task.createMany({
    data: [
      'CATERNATION_ACCEPT_VIA_EMAIL_OR_TEXT',
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_CREATE',
      'SLACK_CHANNEL_NOTIFY',
      'GOOGLE_CALENDAR_ADD',
      'DRIVER_ASSIGN',
    ].map((taskType) => ({
      orderId,
      taskType: taskType as any,
      status: 'COMPLETED',
      completedAt: new Date(),
      completedById: adminUserId,
    })),
  })

  // CaterNation sends Revision A (e.g., 99-SYNTH-A)
  const updateA = await prisma.orderUpdate.create({
    data: {
      orderId,
      channel: 'CATERNATION',
      revisionLabel: 'A',
      description: '[SYNTHETIC] Revision A: headcount changed from 50 to 55',
      resolutionState: 'UNRESOLVED',
    },
  })
  updateIdA = updateA.id

  // CaterNation sends Revision B (e.g., 99-SYNTH-B)
  const updateB = await prisma.orderUpdate.create({
    data: {
      orderId,
      channel: 'CATERNATION',
      revisionLabel: 'B',
      description: '[SYNTHETIC] Revision B: delivery address updated',
      resolutionState: 'UNRESOLVED',
    },
  })
  updateIdB = updateB.id
})

afterAll(async () => {
  await prisma.task.deleteMany({ where: { orderId } })
  await prisma.orderUpdate.deleteMany({ where: { orderId } })
  await prisma.order.deleteMany({ where: { id: orderId } })
  await prisma.customer.deleteMany({ where: { email: 'synthetic-b@example.test' } })
  await prisma.workflowDefinition.deleteMany({ where: { businessId } })
  await prisma.user.deleteMany({ where: { id: adminUserId } })
  await prisma.business.deleteMany({ where: { id: businessId } })
  await prisma.$disconnect()
})

// ─── Test B-1 ─────────────────────────────────────────────────────────────────
it('B-1: both revisions unresolved → hasUnresolvedUpdates=true, not ready', async () => {
  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.hasUnresolvedUpdates).toBe(true)
  expect(result.isReady).toBe(false)

  const updateCheck = result.checks.find((c) => c.name === 'noBlockingUpdates')
  expect(updateCheck?.passed).toBe(false)
  // Both revisions should be mentioned
  expect(updateCheck?.detail).toContain('Rev A')
  expect(updateCheck?.detail).toContain('Rev B')
})

// ─── Test B-2 ─────────────────────────────────────────────────────────────────
it('B-2: resolving Rev A does NOT change Rev B state', async () => {
  // Resolve Revision A
  await prisma.orderUpdate.update({
    where: { id: updateIdA },
    data: {
      resolutionState: 'RESOLVED',
      resolvedAt: new Date(),
      notes: '[SYNTHETIC] Rev A resolved — headcount confirmed',
    },
  })

  // Rev B must still be UNRESOLVED in the database
  const revB = await prisma.orderUpdate.findUnique({ where: { id: updateIdB } })
  expect(revB?.resolutionState).toBe('UNRESOLVED')
})

// ─── Test B-3 ─────────────────────────────────────────────────────────────────
it('B-3: after resolving Rev A only, order is still not ready (Rev B open)', async () => {
  // Rev A is already resolved from B-2 (tests run sequentially within this file)
  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.hasUnresolvedUpdates).toBe(true)
  expect(result.isReady).toBe(false)

  const updateCheck = result.checks.find((c) => c.name === 'noBlockingUpdates')
  expect(updateCheck?.passed).toBe(false)
  // Only Rev B should still appear
  expect(updateCheck?.detail).toContain('Rev B')
  expect(updateCheck?.detail).not.toContain('Rev A')
})

// ─── Test B-4 ─────────────────────────────────────────────────────────────────
it('B-4: after resolving both revisions, order is ready', async () => {
  // Resolve Revision B
  await prisma.orderUpdate.update({
    where: { id: updateIdB },
    data: {
      resolutionState: 'RESOLVED',
      resolvedAt: new Date(),
      notes: '[SYNTHETIC] Rev B resolved — address confirmed',
    },
  })

  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.hasUnresolvedUpdates).toBe(false)
  expect(result.isReady).toBe(true)

  const updateCheck = result.checks.find((c) => c.name === 'noBlockingUpdates')
  expect(updateCheck?.passed).toBe(true)
})
