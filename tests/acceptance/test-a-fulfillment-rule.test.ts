/**
 * Acceptance Test A — Cookie FulfillmentRule blocks and unblocks readiness
 *
 * Verifies that a triggered FulfillmentRule (unsatisfied) blocks operational
 * readiness even when all required workflow tasks are complete, and that
 * satisfying the rule clears the block.
 *
 * Scenario (synthetic data only):
 *   - Ronnie's BBQ × DIRECT × NEW_ORDER
 *   - Cookie FulfillmentRule triggered
 *   - All 8 required tasks completed
 *   - Readiness: false (cookie rule not satisfied) → true (after satisfaction)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { computeOperationalReadiness } from '../../src/lib/operational-readiness'

// Use a separate test database. Set TEST_DATABASE_URL in .env.test.
// This must NOT point to the production or staging database.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL } },
})

// Synthetic IDs scoped to this test file to avoid cross-test collisions
let businessId: string
let cookieRuleId: string
let adminUserId: string

// IDs created fresh per test
let orderId: string
let customerId: string

beforeAll(async () => {
  // Verify test isolation — refuse to run against a database with a name
  // that looks like production. This is a safety check, not a lock.
  const { rows } = await prisma.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()
  `
  const dbName: string = (rows as unknown as Array<{ current_database: string }>)[0]?.current_database ?? ''
  if (!dbName.includes('test') && !dbName.includes('dev')) {
    throw new Error(
      `Safety check: database "${dbName}" does not look like a test database. ` +
        'Set TEST_DATABASE_URL to a test database to run acceptance tests.'
    )
  }

  // Seed the minimum needed for this test: one Business, one WorkflowDefinition,
  // one FulfillmentRule, one User — all synthetic.
  const business = await prisma.business.create({
    data: {
      name: '[TEST] Synthetic BBQ Co',
      slug: `test-ronnies-${Date.now()}`,
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

  const cookieRule = await prisma.fulfillmentRule.create({
    data: {
      businessId: null, // applies to all businesses
      name: '[TEST] Cookie Request',
      description: 'Synthetic cookie rule for Test A',
      triggerConfig: { type: 'ITEM_KEYWORD', keyword: 'cookie' },
      requiredActionDescription: 'Confirm with cookie vendor',
      isActive: true,
    },
  })
  cookieRuleId = cookieRule.id

  const adminUser = await prisma.user.create({
    data: {
      name: '[TEST] Admin User',
      email: `test-admin-a-${Date.now()}@example.test`,
      role: 'ADMIN',
      isActive: true,
    },
  })
  adminUserId = adminUser.id
})

beforeEach(async () => {
  // Create a fresh synthetic customer + order for each test case
  const customer = await prisma.customer.create({
    data: {
      name: '[SYNTHETIC] Test Customer A',
      email: 'synthetic-a@example.test',
    },
  })
  customerId = customer.id

  const eventDate = new Date()
  eventDate.setDate(eventDate.getDate() + 30) // 30 days from now

  const order = await prisma.order.create({
    data: {
      businessId,
      customerId,
      channel: 'DIRECT',
      eventDate,
      status: 'CONFIRMED',
      originalProcessingComplete: false,
    },
  })
  orderId = order.id
})

afterAll(async () => {
  // Clean up all test data created by this suite.
  // Order matters — delete dependents before parents.
  await prisma.orderFulfillmentRule.deleteMany({ where: { fulfillmentRule: { name: { startsWith: '[TEST]' } } } })
  await prisma.task.deleteMany({ where: { order: { business: { slug: { startsWith: 'test-ronnies' } } } } })
  await prisma.order.deleteMany({ where: { businessId } })
  await prisma.customer.deleteMany({ where: { email: 'synthetic-a@example.test' } })
  await prisma.workflowDefinition.deleteMany({ where: { businessId } })
  await prisma.fulfillmentRule.deleteMany({ where: { id: cookieRuleId } })
  await prisma.user.deleteMany({ where: { id: adminUserId } })
  await prisma.business.deleteMany({ where: { id: businessId } })
  await prisma.$disconnect()
})

// ─── Test A-1 ─────────────────────────────────────────────────────────────────
it('A-1: unsatisfied cookie rule blocks readiness even when all tasks complete', async () => {
  // Create all 8 required tasks, all COMPLETED
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
      orderId,
      taskType: taskType as any,
      status: 'COMPLETED',
      completedAt: new Date(),
      completedById: adminUserId,
    })),
  })

  // Mark originalProcessingComplete
  await prisma.order.update({
    where: { id: orderId },
    data: { originalProcessingComplete: true },
  })

  // Trigger the cookie fulfillment rule (not yet satisfied)
  await prisma.orderFulfillmentRule.create({
    data: {
      orderId,
      fulfillmentRuleId: cookieRuleId,
      status: 'TRIGGERED',
    },
  })

  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(false)

  const fulfillmentCheck = result.checks.find((c) => c.name === 'allFulfillmentRulesSatisfied')
  expect(fulfillmentCheck?.passed).toBe(false)
  expect(fulfillmentCheck?.detail).toContain('Cookie Request')

  // All other checks should pass
  const taskCheck = result.checks.find((c) => c.name === 'allRequiredTasksComplete')
  expect(taskCheck?.passed).toBe(true)

  const processingCheck = result.checks.find((c) => c.name === 'originalProcessingComplete')
  expect(processingCheck?.passed).toBe(true)
})

// ─── Test A-2 ─────────────────────────────────────────────────────────────────
it('A-2: satisfying the cookie rule unblocks readiness', async () => {
  // Complete all tasks
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
      orderId,
      taskType: taskType as any,
      status: 'COMPLETED',
      completedAt: new Date(),
      completedById: adminUserId,
    })),
  })

  await prisma.order.update({
    where: { id: orderId },
    data: { originalProcessingComplete: true },
  })

  // Trigger and immediately satisfy the rule
  await prisma.orderFulfillmentRule.create({
    data: {
      orderId,
      fulfillmentRuleId: cookieRuleId,
      status: 'SATISFIED',
      satisfiedAt: new Date(),
      satisfiedById: adminUserId,
      notes: '[TEST] Vendor confirmed — synthetic test',
    },
  })

  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(true)
  expect(result.checks.every((c) => c.passed)).toBe(true)
})

// ─── Test A-3 ─────────────────────────────────────────────────────────────────
it('A-3: waiving the cookie rule also unblocks readiness', async () => {
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
      orderId,
      taskType: taskType as any,
      status: 'COMPLETED',
      completedAt: new Date(),
      completedById: adminUserId,
    })),
  })

  await prisma.order.update({
    where: { id: orderId },
    data: { originalProcessingComplete: true },
  })

  await prisma.orderFulfillmentRule.create({
    data: {
      orderId,
      fulfillmentRuleId: cookieRuleId,
      status: 'WAIVED', // Intentionally waived
      notes: '[TEST] Customer removed cookies from order — waiving rule',
    },
  })

  const result = await computeOperationalReadiness(orderId, prisma)

  expect(result.isReady).toBe(true)
  const fulfillmentCheck = result.checks.find((c) => c.name === 'allFulfillmentRulesSatisfied')
  expect(fulfillmentCheck?.passed).toBe(true)
})
