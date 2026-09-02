/**
 * Acceptance Test D — Historical facts survive a new update
 *
 * Verifies the fundamental immutability guarantee: receiving a new OrderUpdate
 * must NOT disturb the existing original_processing_complete state, existing
 * Task records, or any other historical facts on the Order.
 *
 * A new update DOES set has_unresolved_updates=true and blocks readiness — but
 * it does NOT reset or alter anything that was already settled.
 *
 * Core invariants tested:
 *   - originalProcessingComplete remains true after a new OrderUpdate
 *   - Existing COMPLETED tasks remain COMPLETED
 *   - hasUnresolvedUpdates correctly reflects the new update
 *   - operationalReadiness correctly drops to false (update blocks it)
 *   - Resolving the update restores readiness
 *
 * Scenario (synthetic data only):
 *   - Le Box Lunch Cafe × CATERNATION order, fully processed and ready
 *   - A new CaterNation revision arrives
 *   - Historical facts must be unaffected
 *   - Readiness must drop to false, then recover after resolution
 */

import { it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { computeOperationalReadiness } from '../../src/lib/operational-readiness'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL } },
})

let businessId: string
let orderId: string
let originalTaskIds: string[]
let adminUserId: string

beforeAll(async () => {
  const business = await prisma.business.create({
    data: {
      name: '[TEST] Historical Facts Le Box',
      slug: `test-historical-${Date.now()}`,
      isActive: true,
    },
  })
  businessId = business.id

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
      name: '[TEST] Admin User D',
      email: `test-admin-d-${Date.now()}@example.test`,
      role: 'ADMIN',
      isActive: true,
    },
  })
  adminUserId = adminUser.id

  const customer = await prisma.customer.create({
    data: { name: '[SYNTHETIC] Historical Test Corp', email: 'synthetic-d@example.test' },
  })

  const eventDate = new Date()
  eventDate.setDate(eventDate.getDate() + 14)

  const order = await prisma.order.create({
    data: {
      businessId,
      customerId: customer.id,
      channel: 'CATERNATION',
      externalOrderId: '88-HIST',
      eventDate,
      status: 'CONFIRMED',
      originalProcessingComplete: true, // Original processing complete from the start
    },
  })
  orderId = order.id

  // All original NEW_ORDER tasks completed
  const tasks = await Promise.all(
    [
      'CATERNATION_ACCEPT_VIA_EMAIL_OR_TEXT',
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_CREATE',
      'SLACK_CHANNEL_NOTIFY',
      'GOOGLE_CALENDAR_ADD',
      'DRIVER_ASSIGN',
    ].map((taskType) =>
      prisma.task.create({
        data: {
          orderId,
          taskType: taskType as any,
          status: 'COMPLETED',
          completedAt: new Date(),
          completedById: adminUserId,
        },
      })
    )
  )

  originalTaskIds = tasks.map((t) => t.id)
})

afterAll(async () => {
  await prisma.task.deleteMany({ where: { orderId } })
  await prisma.orderUpdate.deleteMany({ where: { orderId } })
  await prisma.order.deleteMany({ where: { id: orderId } })
  await prisma.customer.deleteMany({ where: { email: 'synthetic-d@example.test' } })
  await prisma.workflowDefinition.deleteMany({ where: { businessId } })
  await prisma.user.deleteMany({ where: { id: adminUserId } })
  await prisma.business.deleteMany({ where: { id: businessId } })
  await prisma.$disconnect()
})

// ─── Test D-1 ─────────────────────────────────────────────────────────────────
it('D-1: order is fully ready before any update arrives', async () => {
  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(true)
  expect(result.hasUnresolvedUpdates).toBe(false)
  expect(result.checks.every((c) => c.passed)).toBe(true)
})

// ─── Test D-2 ─────────────────────────────────────────────────────────────────
it('D-2: after a new OrderUpdate arrives, originalProcessingComplete stays true', async () => {
  // Simulate CaterNation sending Revision C
  await prisma.orderUpdate.create({
    data: {
      orderId,
      channel: 'CATERNATION',
      revisionLabel: 'C',
      description: '[SYNTHETIC] Revision C: menu item substitution requested',
      resolutionState: 'UNRESOLVED',
    },
  })

  // originalProcessingComplete must not be touched
  const freshOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { originalProcessingComplete: true },
  })

  expect(freshOrder?.originalProcessingComplete).toBe(true)
})

// ─── Test D-3 ─────────────────────────────────────────────────────────────────
it('D-3: after a new OrderUpdate, existing completed tasks remain COMPLETED', async () => {
  const tasks = await prisma.task.findMany({
    where: { id: { in: originalTaskIds } },
    select: { id: true, status: true, taskType: true },
  })

  expect(tasks).toHaveLength(originalTaskIds.length)
  for (const task of tasks) {
    expect(task.status).toBe('COMPLETED')
  }
})

// ─── Test D-4 ─────────────────────────────────────────────────────────────────
it('D-4: after a new OrderUpdate, readiness drops to false and hasUnresolvedUpdates=true', async () => {
  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(false)
  expect(result.hasUnresolvedUpdates).toBe(true)

  const updateCheck = result.checks.find((c) => c.name === 'noBlockingUpdates')
  expect(updateCheck?.passed).toBe(false)
  expect(updateCheck?.detail).toContain('Rev C')

  // All other checks should still pass — the update is the only new issue
  const otherChecks = result.checks.filter((c) => c.name !== 'noBlockingUpdates')
  for (const check of otherChecks) {
    expect(check.passed).toBe(true)
  }
})

// ─── Test D-5 ─────────────────────────────────────────────────────────────────
it('D-5: resolving the update restores readiness; historical facts still intact', async () => {
  // Resolve Revision C
  const updateC = await prisma.orderUpdate.findFirst({
    where: { orderId, revisionLabel: 'C' },
  })
  expect(updateC).not.toBeNull()

  await prisma.orderUpdate.update({
    where: { id: updateC!.id },
    data: {
      resolutionState: 'RESOLVED',
      resolvedAt: new Date(),
      notes: '[SYNTHETIC] Substitution confirmed with Le Box kitchen',
    },
  })

  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(true)
  expect(result.hasUnresolvedUpdates).toBe(false)

  // Confirm originalProcessingComplete still true after full resolution
  const processingCheck = result.checks.find((c) => c.name === 'originalProcessingComplete')
  expect(processingCheck?.passed).toBe(true)

  // Confirm task check still passes
  const taskCheck = result.checks.find((c) => c.name === 'allRequiredTasksComplete')
  expect(taskCheck?.passed).toBe(true)
})
