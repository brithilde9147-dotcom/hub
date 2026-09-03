/**
 * Operations Control Hub — Needs Attention Dashboard
 *
 * Three tiers of action required:
 *   1. OVERDUE     — task dueDate is in the past, not yet completed
 *   2. DUE TODAY   — task dueDate is today, not yet completed
 *   3. COMING SOON — task dueDate is within the next 3 days
 *
 * operationallyReady per order is computed inline:
 *   ready = no blocking tasks (isBlockingOperational = true) with completedAt = null
 *
 * Server component — renders with fresh DB data on each request.
 * "Mark Done" uses a server action + form POST (no client JS required).
 */

import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { completeTask } from './actions'

// ─── Label maps ──────────────────────────────────────────────────────────────

const TASK_LABELS: Record<string, string> = {
  DOCUMENT_UPLOAD_AND_REVIEW: 'Upload & review documents',
  ORDER_VERIFICATION: 'Verify order details',
  EZCATER_ACCEPT_IN_PLATFORM: 'Accept order in EZCater',
  CATERNATION_ACCEPT_VIA_EMAIL_OR_TEXT: 'Accept via email/text (CaterNation)',
  SEVENTEEN_HATS_CREATE_OR_UPDATE: 'Create or update 17Hats record',
  CUSTOMER_ACKNOWLEDGMENT: 'Send customer acknowledgment',
  SLACK_CHANNEL_CREATE: 'Create Slack channel',
  SLACK_CHANNEL_NOTIFY: 'Post to Slack channel',
  GOOGLE_CALENDAR_ADD: 'Add event to Google Calendar',
  DRIVER_ASSIGN: 'Assign driver',
  PAYMENT_RETAINER_REQUEST: 'Request retainer payment',
  PAYMENT_BALANCE_FOLLOWUP: 'Follow up on balance payment',
  EOM_PROCESSING: 'End-of-month processing',
}

const CHANNEL_LABELS: Record<string, string> = {
  DIRECT: 'Direct',
  EZCATER: 'EZCater',
  CATERNATION: 'CaterNation',
}

const LIFECYCLE_LABELS: Record<string, string> = {
  INQUIRY_RECEIVED: 'Inquiry Received',
  READY_TO_QUOTE: 'Ready to Quote',
  QUOTE_PRODUCTION: 'Quote Production',
  PRE_SEND_REVIEW: 'Pre-Send Review',
  QUOTE_SENT: 'Quote Sent',
  QUOTE_ACCEPTED: 'Quote Accepted',
  PAYMENT_CONFIRMED: 'Payment Confirmed',
  CONFIRMED: 'Confirmed',
  CLOSED: 'Closed',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysFromNow(d: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function eventUrgency(eventDate: Date): string {
  const d = daysFromNow(eventDate)
  if (d < 0) return `Event was ${Math.abs(d)}d ago`
  if (d === 0) return 'Event TODAY'
  if (d === 1) return 'Event TOMORROW'
  return `Event in ${d}d`
}

function isUrgentEvent(eventDate: Date): boolean {
  return daysFromNow(eventDate) <= 2
}

// ─── Data fetching ────────────────────────────────────────────────────────────

type TaskWithOrder = Awaited<ReturnType<typeof fetchAttentionTasks>>[number]

async function fetchAttentionTasks() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + 4) // captures overdue + 0, 1, 2, 3 days out

  return prisma.task.findMany({
    where: {
      completedAt: null,
      dueDate: { lt: cutoff },
      order: { status: { notIn: ['CANCELLED', 'COMPLETED'] } },
    },
    include: {
      order: {
        include: {
          business: { select: { name: true, slug: true, brandColor: true } },
          customer: { select: { name: true } },
          tasks: {
            select: { isBlockingOperational: true, completedAt: true },
          },
        },
      },
    },
    orderBy: [{ dueDate: 'asc' }, { order: { eventDate: 'asc' } }],
  })
}

function isOperationallyReady(
  orderTasks: { isBlockingOperational: boolean; completedAt: Date | null }[]
) {
  return !orderTasks.some((t) => t.isBlockingOperational && !t.completedAt)
}

function tier(task: TaskWithOrder): 'overdue' | 'today' | 'soon' {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endOfToday = new Date(today)
  endOfToday.setHours(23, 59, 59, 999)
  if (!task.dueDate) return 'soon'
  if (task.dueDate < today) return 'overdue'
  if (task.dueDate <= endOfToday) return 'today'
  return 'soon'
}

// ─── UI Components ────────────────────────────────────────────────────────────

function BusinessBadge({ slug, color }: { slug: string; color: string | null }) {
  const bg = color ?? (slug === 'ronnies' ? '#8B1A1A' : '#2D5A27')
  const label = slug === 'ronnies' ? "Ronnie's BBQ" : 'Le Box'
  return (
    <span style={{
      display: 'inline-block',
      background: bg,
      color: '#fff',
      fontSize: '11px',
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: '4px',
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function ChannelTag({ channel }: { channel: string }) {
  return (
    <span style={{
      display: 'inline-block',
      background: '#f3f4f6',
      color: '#374151',
      fontSize: '11px',
      fontWeight: 500,
      padding: '2px 7px',
      borderRadius: '4px',
      border: '1px solid #e5e7eb',
    }}>
      {CHANNEL_LABELS[channel] ?? channel}
    </span>
  )
}

function ReadinessDot({ ready }: { ready: boolean }) {
  return (
    <span
      title={ready ? 'Operationally ready' : 'Not operationally ready — blocking tasks remain'}
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: ready ? '#16a34a' : '#dc2626',
        flexShrink: 0,
        marginTop: '2px',
      }}
    />
  )
}

function TaskRow({ task, tierColor }: { task: TaskWithOrder; tierColor: string }) {
  const ready = isOperationallyReady(task.order.tasks)
  const taskTier = tier(task)
  const urgentEvent = isUrgentEvent(task.order.eventDate)
  const dueDaysAgo = task.dueDate ? Math.abs(daysFromNow(task.dueDate)) : null
  const action = completeTask.bind(null, task.id)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '12px',
      alignItems: 'start',
      padding: '14px 16px',
      borderBottom: '1px solid #f3f4f6',
      background: urgentEvent ? '#fefce8' : '#fff',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Order header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <BusinessBadge slug={task.order.business.slug} color={task.order.business.brandColor} />
          <span style={{ fontWeight: 600, fontSize: '14px', color: '#111827' }}>
            {task.order.customer.name.replace(' (SYNTHETIC)', '')}
          </span>
          <ChannelTag channel={task.order.channel} />
          <span style={{
            fontSize: '12px',
            fontWeight: urgentEvent ? 700 : 400,
            color: urgentEvent ? '#b45309' : '#6b7280',
          }}>
            {eventUrgency(task.order.eventDate)}
          </span>
          <ReadinessDot ready={ready} />
          {!ready && (
            <span style={{ fontSize: '11px', color: '#dc2626' }}>not ready</span>
          )}
        </div>

        {/* Task label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {task.isBlockingOperational && (
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#7c3aed',
              background: '#f3e8ff',
              padding: '1px 6px',
              borderRadius: '3px',
              border: '1px solid #e9d5ff',
              whiteSpace: 'nowrap',
            }}>
              BLOCKING
            </span>
          )}
          <span style={{ fontSize: '13px', color: '#374151' }}>
            {TASK_LABELS[task.taskType] ?? task.taskType}
          </span>
        </div>

        {/* Due info */}
        <div style={{ fontSize: '12px', color: taskTier === 'overdue' ? '#dc2626' : '#6b7280' }}>
          {taskTier === 'overdue'
            ? `Overdue by ${dueDaysAgo} day${dueDaysAgo === 1 ? '' : 's'} · was due ${task.dueDate ? formatDate(task.dueDate) : '—'}`
            : `Due ${task.dueDate ? formatDate(task.dueDate) : '—'}`}
        </div>

        {/* Lifecycle state */}
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>
          {LIFECYCLE_LABELS[task.order.lifecycleState] ?? task.order.lifecycleState}
        </div>
      </div>

      {/* Mark Done */}
      <form action={action} style={{ paddingTop: '2px' }}>
        <button
          type="submit"
          style={{
            background: '#fff',
            border: `1px solid ${tierColor}`,
            color: tierColor,
            borderRadius: '6px',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Mark Done
        </button>
      </form>
    </div>
  )
}

function TierSection({
  title, emoji, color, tasks, emptyMessage,
}: {
  title: string; emoji: string; color: string
  tasks: TaskWithOrder[]; emptyMessage: string
}) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '16px' }}>{emoji}</span>
        <h2 style={{
          fontSize: '14px', fontWeight: 700, color,
          margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {title}
        </h2>
        <span style={{
          background: tasks.length > 0 ? color : '#9ca3af',
          color: '#fff', borderRadius: '999px',
          fontSize: '11px', fontWeight: 700,
          padding: '1px 8px', minWidth: '20px', textAlign: 'center',
        }}>
          {tasks.length}
        </span>
      </div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
        {tasks.length === 0 ? (
          <div style={{ padding: '20px 16px', color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>
            {emptyMessage}
          </div>
        ) : (
          tasks.map((task) => <TaskRow key={task.id} task={task} tierColor={color} />)
        )}
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const allTasks = await fetchAttentionTasks()

  const overdue = allTasks.filter((t) => tier(t) === 'overdue')
  const dueToday = allTasks.filter((t) => tier(t) === 'today')
  const comingSoon = allTasks.filter((t) => tier(t) === 'soon')
  const totalAttention = allTasks.length

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '0 24px', height: '56px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 700, fontSize: '15px', color: '#111827' }}>
            Operations Control Hub
          </span>
          {totalAttention > 0 && (
            <span style={{
              background: overdue.length > 0 ? '#dc2626' : '#b45309',
              color: '#fff', borderRadius: '999px',
              fontSize: '11px', fontWeight: 700, padding: '2px 8px',
            }}>
              {totalAttention} item{totalAttention !== 1 ? 's' : ''} need attention
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>{session.user?.email}</span>
          <form action="/api/auth/signout" method="POST">
            <button type="submit" style={{
              background: 'none', border: '1px solid #e5e7eb',
              borderRadius: '6px', padding: '4px 10px',
              fontSize: '12px', color: '#6b7280', cursor: 'pointer',
            }}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
            Needs Attention
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            Tasks overdue, due today, or coming due in the next 3 days.
            Blocking tasks prevent an order from being operationally ready.
          </p>
        </div>

        {/* Summary bar */}
        {totalAttention > 0 && (
          <div style={{ display: 'flex', gap: '12px', marginBottom: '28px', flexWrap: 'wrap' }}>
            {[
              { label: 'Overdue', count: overdue.length, color: '#dc2626', bg: '#fef2f2' },
              { label: 'Due Today', count: dueToday.length, color: '#b45309', bg: '#fffbeb' },
              { label: 'Coming Soon', count: comingSoon.length, color: '#1d4ed8', bg: '#eff6ff' },
            ].map(({ label, count, color, bg }) => (
              <div key={label} style={{
                background: bg, border: `1px solid ${color}22`,
                borderRadius: '8px', padding: '12px 20px',
                minWidth: '120px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color }}>{count}</div>
                <div style={{ fontSize: '12px', color, fontWeight: 600 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {totalAttention === 0 && (
          <div style={{
            border: '1px solid #d1fae5', borderRadius: '12px',
            background: '#f0fdf4', padding: '40px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: '16px', color: '#166534', marginBottom: '4px' }}>
              You&apos;re all caught up
            </div>
            <div style={{ fontSize: '13px', color: '#4ade80' }}>
              No tasks overdue or due in the next 3 days.
            </div>
          </div>
        )}

        <TierSection title="Overdue" emoji="🔴" color="#dc2626"
          tasks={overdue} emptyMessage="No overdue tasks — nice work." />
        <TierSection title="Due Today" emoji="🟡" color="#b45309"
          tasks={dueToday} emptyMessage="Nothing due today." />
        <TierSection title="Coming Soon · Next 3 Days" emoji="🔵" color="#1d4ed8"
          tasks={comingSoon} emptyMessage="Nothing coming due in the next 3 days." />

        {/* Legend */}
        <div style={{
          marginTop: '16px', padding: '12px 16px',
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px',
          display: 'flex', gap: '20px', flexWrap: 'wrap',
          fontSize: '12px', color: '#6b7280',
        }}>
          <span>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#16a34a', marginRight: 4 }} />
            Operationally ready
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#dc2626', marginRight: 4 }} />
            Not ready — blocking task(s) remain
          </span>
          <span>
            <span style={{ display: 'inline-block', padding: '0 4px', background: '#f3e8ff', border: '1px solid #e9d5ff', borderRadius: 3, fontSize: 10, fontWeight: 700, color: '#7c3aed', marginRight: 4 }}>BLOCKING</span>
            Completing this affects operational readiness
          </span>
          <span style={{ background: '#fefce8', padding: '0 4px', borderRadius: 3 }}>
            Yellow row = event within 2 days
          </span>
        </div>
      </main>
    </div>
  )
}
