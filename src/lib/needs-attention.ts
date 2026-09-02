/**
 * Operations Control Hub — Needs Attention Query Engine
 *
 * Returns a prioritized work queue of orders requiring action.
 * Priority levels reflect operational urgency:
 *
 *   CRITICAL — action required immediately; event is imminent or overdue
 *   HIGH     — action required soon; significant risk if not addressed
 *   MEDIUM   — should be addressed; not yet urgent
 *   LOW      — informational; may need attention before event
 *
 * None of these queries store computed state. They query live data.
 * Readiness computation (computeOperationalReadiness) is called per-order
 * for orders that qualify by date proximity.
 */

import { PrismaClient } from '@prisma/client'
import { computeOperationalReadiness } from './operational-readiness'

const defaultPrisma = new PrismaClient()

export type AttentionPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface AttentionItem {
  orderId: string
  businessId: string
  eventDate: Date
  channel: string
  reason: string
  priority: AttentionPriority
  detail?: string
}

export interface NeedsAttentionResult {
  items: AttentionItem[]
  computedAt: Date
  /** Total count by priority */
  summary: Record<AttentionPriority, number>
}

const DAYS_MS = 24 * 60 * 60 * 1000

function daysFromNow(date: Date): number {
  return (date.getTime() - Date.now()) / DAYS_MS
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAYS_MS)
}

/**
 * Main entry point. Returns all attention items sorted by priority then event date.
 * Excludes CANCELLED and COMPLETED orders.
 *
 * @param prismaClient  Pass a test client to run against the test database.
 */
export async function getNeedsAttention(
  prismaClient: PrismaClient = defaultPrisma
): Promise<NeedsAttentionResult> {
  const items: AttentionItem[] = []
  const now = new Date()

  // Active orders only
  const activeStatuses = ['INQUIRY', 'CONFIRMED'] as const

  // ── Category 1 (CRITICAL): Unresolved updates within 72 hours of event ─────
  const criticalUpdateOrders = await prismaClient.order.findMany({
    where: {
      status: { in: activeStatuses },
      eventDate: { lte: addDays(now, 3) },
      updates: {
        some: { resolutionState: { in: ['UNRESOLVED', 'IN_PROGRESS'] } },
      },
    },
    select: {
      id: true,
      businessId: true,
      eventDate: true,
      channel: true,
      updates: {
        where: { resolutionState: { in: ['UNRESOLVED', 'IN_PROGRESS'] } },
        select: { resolutionState: true, revisionLabel: true },
      },
    },
  })

  for (const order of criticalUpdateOrders) {
    items.push({
      orderId: order.id,
      businessId: order.businessId,
      eventDate: order.eventDate,
      channel: order.channel,
      reason: 'Unresolved update within 72 hours of event',
      priority: 'CRITICAL',
      detail: `${order.updates.length} update(s) still ${order.updates[0]?.resolutionState ?? 'unresolved'}`,
    })
  }

  // ── Category 2 (CRITICAL): Not ready within 72 hours of event ──────────────
  const imminentOrders = await prismaClient.order.findMany({
    where: {
      status: { in: activeStatuses },
      eventDate: { lte: addDays(now, 3), gte: now },
    },
    select: { id: true, businessId: true, eventDate: true, channel: true },
  })

  for (const order of imminentOrders) {
    // Skip if already flagged by Category 1
    if (items.some((i) => i.orderId === order.id && i.priority === 'CRITICAL')) continue

    const readiness = await computeOperationalReadiness(order.id, prismaClient)
    if (!readiness.isReady) {
      const failedChecks = readiness.checks.filter((c) => !c.passed).map((c) => c.name)
      items.push({
        orderId: order.id,
        businessId: order.businessId,
        eventDate: order.eventDate,
        channel: order.channel,
        reason: 'Not operationally ready within 72 hours of event',
        priority: 'CRITICAL',
        detail: `Failed: ${failedChecks.join(', ')}`,
      })
    }
  }

  // ── Category 3 (HIGH): Not ready 3–7 days before event ────────────────────
  const approachingOrders = await prismaClient.order.findMany({
    where: {
      status: { in: activeStatuses },
      eventDate: {
        gt: addDays(now, 3),
        lte: addDays(now, 7),
      },
    },
    select: { id: true, businessId: true, eventDate: true, channel: true },
  })

  for (const order of approachingOrders) {
    const readiness = await computeOperationalReadiness(order.id, prismaClient)
    if (!readiness.isReady) {
      const failedChecks = readiness.checks.filter((c) => !c.passed).map((c) => c.name)
      items.push({
        orderId: order.id,
        businessId: order.businessId,
        eventDate: order.eventDate,
        channel: order.channel,
        reason: 'Not operationally ready — event in 3–7 days',
        priority: 'HIGH',
        detail: `Failed: ${failedChecks.join(', ')}`,
      })
    }
  }

  // ── Category 4 (HIGH): FulfillmentRule triggered but not satisfied ──────────
  const unsatisfiedFulfillmentOrders = await prismaClient.order.findMany({
    where: {
      status: { in: activeStatuses },
      orderFulfillmentRules: {
        some: { status: 'TRIGGERED' },
      },
    },
    select: {
      id: true,
      businessId: true,
      eventDate: true,
      channel: true,
      orderFulfillmentRules: {
        where: { status: 'TRIGGERED' },
        select: { fulfillmentRule: { select: { name: true } } },
      },
    },
  })

  for (const order of unsatisfiedFulfillmentOrders) {
    // Don't double-flag orders already CRITICAL by category 1/2
    if (items.some((i) => i.orderId === order.id && i.priority === 'CRITICAL')) continue

    const ruleNames = order.orderFulfillmentRules.map((r) => r.fulfillmentRule.name).join(', ')
    items.push({
      orderId: order.id,
      businessId: order.businessId,
      eventDate: order.eventDate,
      channel: order.channel,
      reason: 'Fulfillment rule(s) triggered and not yet satisfied',
      priority: 'HIGH',
      detail: `Pending: ${ruleNames}`,
    })
  }

  // ── Category 5 (MEDIUM): Unresolved updates older than 7 days ──────────────
  const stalledUpdateOrders = await prismaClient.order.findMany({
    where: {
      status: { in: activeStatuses },
      updates: {
        some: {
          resolutionState: { in: ['UNRESOLVED', 'IN_PROGRESS'] },
          receivedAt: { lte: addDays(now, -7) },
        },
      },
    },
    select: {
      id: true,
      businessId: true,
      eventDate: true,
      channel: true,
      updates: {
        where: {
          resolutionState: { in: ['UNRESOLVED', 'IN_PROGRESS'] },
          receivedAt: { lte: addDays(now, -7) },
        },
        select: { receivedAt: true, revisionLabel: true },
      },
    },
  })

  for (const order of stalledUpdateOrders) {
    // Skip if already captured at CRITICAL
    if (items.some((i) => i.orderId === order.id && i.priority === 'CRITICAL')) continue

    items.push({
      orderId: order.id,
      businessId: order.businessId,
      eventDate: order.eventDate,
      channel: order.channel,
      reason: 'Update(s) unresolved for more than 7 days',
      priority: 'MEDIUM',
      detail: `${order.updates.length} stalled update(s)`,
    })
  }

  // ── Category 6 (MEDIUM): Required tasks pending with no recent activity ─────
  // Defined as: order confirmed, event > 7 days away, has PENDING tasks
  // with no update in the last 48 hours
  const stalledTaskOrders = await prismaClient.order.findMany({
    where: {
      status: 'CONFIRMED',
      eventDate: { gt: addDays(now, 7) },
      tasks: {
        some: {
          orderUpdateId: null,
          status: 'PENDING',
          updatedAt: { lte: addDays(now, -2) },
        },
      },
    },
    select: {
      id: true,
      businessId: true,
      eventDate: true,
      channel: true,
      tasks: {
        where: {
          orderUpdateId: null,
          status: 'PENDING',
          updatedAt: { lte: addDays(now, -2) },
        },
        select: { taskType: true },
      },
    },
  })

  for (const order of stalledTaskOrders) {
    if (items.some((i) => i.orderId === order.id)) continue

    items.push({
      orderId: order.id,
      businessId: order.businessId,
      eventDate: order.eventDate,
      channel: order.channel,
      reason: 'Confirmed order has stalled tasks (no activity in 48+ hours)',
      priority: 'MEDIUM',
      detail: `Stalled: ${order.tasks.map((t) => t.taskType).join(', ')}`,
    })
  }

  // ── Category 7 (LOW): Confirmed order, no document uploaded within 24 hours──
  const noDocOrders = await prismaClient.order.findMany({
    where: {
      status: 'CONFIRMED',
      eventDate: { gt: now },
      createdAt: { lte: addDays(now, -1) },
      documents: { none: {} },
    },
    select: {
      id: true,
      businessId: true,
      eventDate: true,
      channel: true,
      createdAt: true,
    },
  })

  for (const order of noDocOrders) {
    if (items.some((i) => i.orderId === order.id)) continue

    items.push({
      orderId: order.id,
      businessId: order.businessId,
      eventDate: order.eventDate,
      channel: order.channel,
      reason: 'Confirmed order has no document uploaded (24+ hours since creation)',
      priority: 'LOW',
    })
  }

  // ── Sort: priority rank then event date ascending ───────────────────────────
  const priorityRank: Record<AttentionPriority, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  }

  items.sort((a, b) => {
    const rankDiff = priorityRank[a.priority] - priorityRank[b.priority]
    if (rankDiff !== 0) return rankDiff
    return a.eventDate.getTime() - b.eventDate.getTime()
  })

  const summary: Record<AttentionPriority, number> = {
    CRITICAL: items.filter((i) => i.priority === 'CRITICAL').length,
    HIGH: items.filter((i) => i.priority === 'HIGH').length,
    MEDIUM: items.filter((i) => i.priority === 'MEDIUM').length,
    LOW: items.filter((i) => i.priority === 'LOW').length,
  }

  return { items, computedAt: now, summary }
}
