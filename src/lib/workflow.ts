/**
 * Operations Control Hub — Workflow Task Generation
 *
 * Generates Task records from the WorkflowDefinition for a given
 * Business × Channel × RecordContext combination.
 *
 * Called when:
 *   - A new Order is created (recordContext: NEW_ORDER)
 *   - A new OrderUpdate is received (recordContext: ORDER_UPDATE)
 *
 * This function is the only place Task records are created from workflow
 * definitions. Tasks may also be created individually by staff for
 * ad-hoc work not covered by the workflow definition.
 */

import { PrismaClient, Channel, RecordContext, TaskType } from '@prisma/client'

// Module-level singleton. Pass a different client in tests.
const defaultPrisma = new PrismaClient()

export interface GenerateTasksOptions {
  orderId: string
  businessId: string
  channel: Channel
  recordContext: RecordContext
  /** Set when generating tasks for an OrderUpdate. */
  orderUpdateId?: string
  prismaClient?: PrismaClient
}

export interface GenerateTasksResult {
  workflowDefinitionId: string | null
  tasksCreated: number
  taskTypes: TaskType[]
  skipped: boolean
  skipReason?: string
}

/**
 * Finds the active WorkflowDefinition for the given Business × Channel × RecordContext
 * and creates a Task record for each required task type.
 *
 * If a task of that type already exists for this order (or orderUpdate), it is
 * not duplicated. This makes the function safe to call idempotently.
 */
export async function generateTasksForWorkflow(
  options: GenerateTasksOptions
): Promise<GenerateTasksResult> {
  const {
    orderId,
    businessId,
    channel,
    recordContext,
    orderUpdateId,
    prismaClient = defaultPrisma,
  } = options

  // Find the active definition for this combination
  const workflowDef = await prismaClient.workflowDefinition.findFirst({
    where: { businessId, channel, recordContext, isActive: true },
  })

  if (!workflowDef) {
    return {
      workflowDefinitionId: null,
      tasksCreated: 0,
      taskTypes: [],
      skipped: true,
      skipReason: `No active WorkflowDefinition found for businessId=${businessId} channel=${channel} recordContext=${recordContext}`,
    }
  }

  // Find task types already present for this scope (order or update)
  const existingTasks = await prismaClient.task.findMany({
    where: {
      orderId,
      orderUpdateId: orderUpdateId ?? null,
    },
    select: { taskType: true },
  })

  const existingTypes = new Set(existingTasks.map((t) => t.taskType))
  const toCreate = workflowDef.requiredTaskTypes.filter((t) => !existingTypes.has(t))

  if (toCreate.length === 0) {
    return {
      workflowDefinitionId: workflowDef.id,
      tasksCreated: 0,
      taskTypes: [],
      skipped: true,
      skipReason: 'All required task types already exist for this order/update scope',
    }
  }

  await prismaClient.task.createMany({
    data: toCreate.map((taskType) => ({
      orderId,
      orderUpdateId: orderUpdateId ?? null,
      taskType,
      status: 'PENDING' as const,
    })),
  })

  return {
    workflowDefinitionId: workflowDef.id,
    tasksCreated: toCreate.length,
    taskTypes: toCreate,
    skipped: false,
  }
}

/**
 * Returns the ordered list of required task types for a given
 * Business × Channel × RecordContext, without creating any records.
 * Useful for display and validation.
 */
export async function getRequiredTaskTypes(
  businessId: string,
  channel: Channel,
  recordContext: RecordContext,
  prismaClient: PrismaClient = defaultPrisma
): Promise<TaskType[]> {
  const workflowDef = await prismaClient.workflowDefinition.findFirst({
    where: { businessId, channel, recordContext, isActive: true },
    select: { requiredTaskTypes: true },
  })

  return workflowDef?.requiredTaskTypes ?? []
}
