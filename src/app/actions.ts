'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

/**
 * Mark a task as manually completed.
 * V1: MANUAL verification only — staff confirms inside the Hub.
 * Extensible: when integrations are approved, add cases here
 * without changing the Task model.
 */
export async function completeTask(taskId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { completedAt: true, status: true },
  })

  if (!task) throw new Error('Task not found')
  if (task.completedAt) return // already done — idempotent

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      completedById: session.user.id,
    },
  })

  revalidatePath('/')
}
