/**
 * Operations Control Hub — Computed Operational Readiness
 *
 * operationalReadiness is NEVER stored in the database. It is computed on
 * demand from the current state of Tasks, OrderUpdates, FulfillmentRules,
 * Payments, and DeliveryRecords.
 *
 * Six checks must ALL pass for an order to be operationally ready:
 *
 *   1. originalProcessingComplete  — staff has explicitly confirmed intake is done
 *   2. allRequiredTasksComplete    — every task in the NEW_ORDER workflow is COMPLETED or SKIPPED
 *   3. allFulfillmentRulesSatisfied — every triggered rule is SATISFIED or WAIVED
 *   4. noOverduePayments           — no Payment record has status OVERDUE
 *   5. deliveryAssignedIfNeeded    — if a DeliveryRecord exists, it is not UNASSIGNED
 *                                    within 7 days of the event
 *   6. noBlockingUpdates           — no OrderUpdate is in state UNRESOLVED or IN_PROGRESS
 *
 * hasUnresolvedUpdates is also computed here (derived from check 6).
 */

import { PrismaClient } from '@prisma/client'

const defaultPrisma = new PrismaClient()

export interface ReadinessCheck {
  name: string
  passed: boolean
  detail?: string
}

export interface OperationalReadinessResult {
  orderId: string
  isReady: boolean
  hasUnresolvedUpdates: boolean
  checks: ReadinessCheck[]
  computedAt: Date
}

const DAYS_MS = 24 * 60 * 60 * 1000

/**
 * Compute operational readiness for a single order.
 * All six checks are always evaluated (even after an earlier one fails),
 * so the result surfaces every issue at once.
 */
export async function computeOperationalReadiness(
  orderId: string,
  prismaClient: PrismaClient = defaultPrisma
): Promise<OperationalReadinessResult> {
  const checks: ReadinessCheck[] = []

  // Fetch the order with everything we need in one query
  const order = await prismaClient.order.findUnique({
    where: { id: orderId },
    include: {
      tasks: {
        where: { orderUpdateId: null }, // Original-order tasks only (not update tasks)
        select: { taskType: true, status: true },
      },
      updates: {
        select: { id: true, resolutionState: true, revisionLabel: true },
      },
      orderFulfillmentRules: {
        select: { status: true, fulfillmentRule: { select: { name: true } } },
      },
      payments: {
        select: { status: true, paymentType: true },
      },
      delivery: {
        select: { status: true },
      },
      business: {
        select: { id: true },
      },
    },
  })

  if (!order) {
    throw new Error(`Order not found: ${orderId}`)
  }

  // ── Check 1: originalProcessingComplete ────────────────────────────────────
  checks.push({
    name: 'originalProcessingComplete',
    passed: order.originalProcessingComplete,
    detail: order.originalProcessingComplete
      ? 'Original processing marked complete'
      : 'Original processing not yet confirmed by staff',
  })

  // ── Check 2: allRequiredTasksComplete ──────────────────────────────────────
  // Fetch the WorkflowDefinition to know which task types are required.
  const workflowDef = await prismaClient.workflowDefinition.findFirst({
    where: {
      businessId: order.businessId,
      channel: order.channel,
      recordContext: 'NEW_ORDER',
      isActive: true,
    },
    select: { requiredTaskTypes: true },
  })

  if (!workflowDef) {
    checks.push({
      name: 'allRequiredTasksComplete',
      passed: false,
      detail: `No active WorkflowDefinition found for ${order.channel} NEW_ORDER — cannot verify tasks`,
    })
  } else {
    const completedOrSkipped = new Set(
      order.tasks
        .filter((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED')
        .map((t) => t.taskType)
    )

    const incomplete = workflowDef.requiredTaskTypes.filter(
      (required) => !completedOrSkipped.has(required)
    )

    checks.push({
      name: 'allRequiredTasksComplete',
      passed: incomplete.length === 0,
      detail:
        incomplete.length === 0
          ? 'All required tasks completed or skipped'
          : `Incomplete tasks: ${incomplete.join(', ')}`,
    })
  }

  // ── Check 3: allFulfillmentRulesSatisfied ──────────────────────────────────
  const unsatisfiedRules = order.orderFulfillmentRules.filter(
    (r) => r.status !== 'SATISFIED' && r.status !== 'WAIVED'
  )

  checks.push({
    name: 'allFulfillmentRulesSatisfied',
    passed: unsatisfiedRules.length === 0,
    detail:
      unsatisfiedRules.length === 0
        ? 'All fulfillment rules satisfied or waived'
        : `Unsatisfied rules: ${unsatisfiedRules.map((r) => r.fulfillmentRule.name).join(', ')}`,
  })

  // ── Check 4: noOverduePayments ─────────────────────────────────────────────
  const overduePayments = order.payments.filter((p) => p.status === 'OVERDUE')

  checks.push({
    name: 'noOverduePayments',
    passed: overduePayments.length === 0,
    detail:
      overduePayments.length === 0
        ? 'No overdue payments'
        : `Overdue payment(s): ${overduePayments.map((p) => p.paymentType).join(', ')}`,
  })

  // ── Check 5: deliveryAssignedIfNeeded ──────────────────────────────────────
  // Only fails if: a DeliveryRecord exists AND its status is UNASSIGNED
  // AND the event is within 7 days. No DeliveryRecord = delivery not needed.
  let deliveryCheck: ReadinessCheck

  if (!order.delivery) {
    deliveryCheck = {
      name: 'deliveryAssignedIfNeeded',
      passed: true,
      detail: 'No delivery record — pickup or channel-managed delivery',
    }
  } else if (order.delivery.status !== 'UNASSIGNED') {
    deliveryCheck = {
      name: 'deliveryAssignedIfNeeded',
      passed: true,
      detail: `Delivery status: ${order.delivery.status}`,
    }
  } else {
    const daysUntilEvent =
      (new Date(order.eventDate).getTime() - Date.now()) / DAYS_MS
    const isUrgent = daysUntilEvent <= 7

    deliveryCheck = {
      name: 'deliveryAssignedIfNeeded',
      passed: !isUrgent,
      detail: isUrgent
        ? `Driver unassigned with event in ${Math.ceil(daysUntilEvent)} day(s)`
        : `Driver not yet assigned (${Math.ceil(daysUntilEvent)} days until event — not yet urgent)`,
    }
  }

  checks.push(deliveryCheck)

  // ── Check 6: noBlockingUpdates ─────────────────────────────────────────────
  const blockingUpdates = order.updates.filter(
    (u) => u.resolutionState === 'UNRESOLVED' || u.resolutionState === 'IN_PROGRESS'
  )

  const hasUnresolvedUpdates = blockingUpdates.length > 0

  checks.push({
    name: 'noBlockingUpdates',
    passed: !hasUnresolvedUpdates,
    detail: hasUnresolvedUpdates
      ? `Unresolved updates: ${blockingUpdates
          .map((u) => (u.revisionLabel ? `Rev ${u.revisionLabel}` : u.id.slice(0, 8)))
          .join(', ')}`
      : 'No unresolved order updates',
  })

  const isReady = checks.every((c) => c.passed)

  return {
    orderId,
    isReady,
    hasUnresolvedUpdates,
    checks,
    computedAt: new Date(),
  }
}

/**
 * Batch compute readiness for multiple orders.
 * Returns a map of orderId → OperationalReadinessResult.
 */
export async function computeReadinessBatch(
  orderIds: string[],
  prismaClient: PrismaClient = defaultPrisma
): Promise<Map<string, OperationalReadinessResult>> {
  const results = new Map<string, OperationalReadinessResult>()

  // Sequential for now. For large batches, parallelize with Promise.all
  // after validating that concurrent Prisma queries don't cause connection pressure.
  for (const orderId of orderIds) {
    results.set(orderId, await computeOperationalReadiness(orderId, prismaClient))
  }

  return results
}
