/**
 * Acceptance Test C — Incomplete required task blocks readiness
 *
 * Verifies that operational readiness is false whenever a required workflow
 * task is not COMPLETED or SKIPPED, regardless of order status or payment
 * state. A confirmed, paid order with one pending task is NOT ready.
 *
 * Scenario (synthetic data only):
 *   - Ronnie's BBQ × DIRECT × NEW_ORDER
 *   - Order status: CONFIRMED
 *   - originalProcessingComplete: true
 *   - 7 of 8 required tasks completed; DRIVER_ASSIGN is PENDING
 *   - Readiness: false
 *   - Mark DRIVER_ASSIGN COMPLETED → readiness: true
 *   - Mark DRIVER_ASSIGN SKIPPED (pickup order) → readiness: true
 */

import { it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { computeOperationalReadiness } from '../../src/lib/operational-readiness'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL } },
})

let businessId: string
let adminUserId: string

beforeAll(async () => {
  const business = await prisma.business.create({
    data: {
      name: '[TEST] Task-Block Test BBQ',
      slug: `test-taskblock-${Date.now()}`,
      isActive: true,
    },
  })
  businessId = business.id

  await prisma.workflowDefinition.create({
    data: {
      businessId,
      channel: 'DIRECT',
      recordContext: 'NEW_ORDER',
      requiredTaskTypes: [
        'DOCUMENT_UPLOAD_AND_REVIEW',
        'ORDER_VERIFICATION',
        'SEVENTEEN_HATS_CREATE_OR_UPDATE',
        'SLACK_CHANNEL_CREATE',
        'SLACK_CHANNEL_NOTIFY',
        'GOOGLE_CALENDAR_ADD',
        'DRIVER_ASSIGN',
        'PAYMENT_RETAINER_REQUEST',
      ],
      isActive: true,
    },
  })

  const adminUser = await prisma.user.create({
    data: {
      name: '[TEST] Admin User C',
      email: `test-admin-c-${Date.now()}@example.test`,
      role: 'ADMIN',
      isActive: true,
    },
  })
  adminUserId = adminUser.id
})

afterAll(async () => {
  await prisma.task.deleteMany({ where: { order: { businessId } } })
  await prisma.order.deleteMany({ where: { businessId } })
  await prisma.customer.deleteMany({ where: { email: 'synthetic-c@example.test' } })
  await prisma.workflowDefinition.deleteMany({ where: { businessId } })
  await prisma.user.deleteMany({ where: { id: adminUserId } })
  await prisma.business.deleteMany({ where: { id: businessId } })
  await prisma.$disconnect()
})

/** Creates a synthetic order with all required tasks except DRIVER_ASSIGN (left PENDING) */
async function createOrderWithPendingDriverAssign(): Promise<{
  orderId: string
  driverTaskId: string
}> {
  const customer = await prisma.customer.create({
    data: { name: '[SYNTHETIC] Task Block Customer', email: 'synthetic-c@example.test' },
  })

  const eventDate = new Date()
  eventDate.setDate(eventDate.getDate() + 14)

  const order = await prisma.order.create({
    data: {
      businessId,
      customerId: customer.id,
      channel: 'DIRECT',
      eventDate,
      status: 'CONFIRMED',
      originalProcessingComplete: true,
    },
  })

  // 7 tasks completed
  await prisma.task.createMany({
    data: [
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_CREATE',
      'SLACK_CHANNEL_NOTIFY',
      'GOOGLE_CALENDAR_ADD',
      'PAYMENT_RETAINER_REQUEST',
    ].map((taskType) => ({
      orderId: order.id,
      taskType: taskType as any,
      status: 'COMPLETED',
      completedAt: new Date(),
      completedById: adminUserId,
    })),
  })

  // DRIVER_ASSIGN left PENDING
  const driverTask = await prisma.task.create({
    data: {
      orderId: order.id,
      taskType: 'DRIVER_ASSIGN',
      status: 'PENDING',
    },
  })

  return { orderId: order.id, driverTaskId: driverTask.id }
}

// ─── Test C-1 ─────────────────────────────────────────────────────────────────
it('C-1: confirmed order with one PENDING task is NOT ready', async () => {
  const { orderId } = await createOrderWithPendingDriverAssign()

  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(false)

  const taskCheck = result.checks.find((c) => c.name === 'allRequiredTasksComplete')
  expect(taskCheck?.passed).toBe(false)
  expect(taskCheck?.detail).toContain('DRIVER_ASSIGN')

  // originalProcessingComplete should pass — it's only tasks that block
  const processingCheck = result.checks.find((c) => c.name === 'originalProcessingComplete')
  expect(processingCheck?.passed).toBe(true)
})

// ─── Test C-2 ─────────────────────────────────────────────────────────────────
it('C-2: completing DRIVER_ASSIGN task makes the order ready', async () => {
  const { orderId, driverTaskId } = await createOrderWithPendingDriverAssign()

  // Complete the pending driver task
  await prisma.task.update({
    where: { id: driverTaskId },
    data: { status: 'COMPLETED', completedAt: new Date(), completedById: adminUserId },
  })

  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(true)
  expect(result.checks.every((c) => c.passed)).toBe(true)
})

// ─── Test C-3 ─────────────────────────────────────────────────────────────────
it('C-3: skipping DRIVER_ASSIGN (pickup order) also makes the order ready', async () => {
  const { orderId, driverTaskId } = await createOrderWithPendingDriverAssign()

  // Mark as SKIPPED — customer is picking up
  await prisma.task.update({
    where: { id: driverTaskId },
    data: {
      status: 'SKIPPED',
      notes: '[SYNTHETIC] Pickup order — driver assignment not required',
      updatedAt: new Date(),
    },
  })

  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(true)

  const taskCheck = result.checks.find((c) => c.name === 'allRequiredTasksComplete')
  expect(taskCheck?.passed).toBe(true)
})

// ─── Test C-4 ─────────────────────────────────────────────────────────────────
it('C-4: originalProcessingComplete=false alone blocks readiness', async () => {
  const customer = await prisma.customer.create({
    data: { name: '[SYNTHETIC] Processing Incomplete Customer', email: 'synthetic-c@example.test' },
  })

  const eventDate = new Date()
  eventDate.setDate(eventDate.getDate() + 14)

  const order = await prisma.order.create({
    data: {
      businessId,
      customerId: customer.id,
      channel: 'DIRECT',
      eventDate,
      status: 'CONFIRMED',
      originalProcessingComplete: false, // Not yet confirmed
    },
  })

  // All tasks complete
  await prisma.task.createMany({
    data: [
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_CREATE',
      'SLACK_CHANNEL_NOTIFY',
      'GOOGLE_CALENDAR_ADD',
      'DRIVER_ASSIGN',
      'PAYMENT_RETAINER_REQUEST',
    ].map((taskType) => ({
      orderId: order.id,
      taskType: taskType as any,
      status: 'COMPLETED',
      completedAt: new Date(),
      completedById: adminUserId,
    })),
  })

  const result = await computeOperationalReadiness(order.id, prisma)

  expect(result.isReady).toBe(false)

  const processingCheck = result.checks.find((c) => c.name === 'originalProcessingComplete')
  expect(processingCheck?.passed).toBe(false)

  // Tasks check should pass
  const taskCheck = result.checks.find((c) => c.name === 'allRequiredTasksComplete')
  expect(taskCheck?.passed).toBe(true)
})
