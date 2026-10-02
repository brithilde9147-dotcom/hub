/**
 * Operations Control Hub — Order Detail View
 *
 * Full detail for a single order: items, tasks (all, not just attention-tier),
 * order updates/revisions, payments, delivery, and document metadata.
 *
 * operationallyReady is computed inline (never stored) — same rule as the
 * Needs Attention dashboard.
 */

import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { completeTask } from '../../actions'

// ─── Label maps (kept in sync with dashboard) ────────────────────────────────

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

const STATUS_LABELS: Record<string, string> = {
  INQUIRY: 'Inquiry',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
}

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PENDING: '#b45309',
  RECEIVED: '#16a34a',
  OVERDUE: '#dc2626',
  WAIVED: '#6b7280',
}

const RESOLUTION_COLORS: Record<string, string> = {
  UNRESOLVED: '#dc2626',
  IN_PROGRESS: '#b45309',
  RESOLVED: '#16a34a',
}

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: 'Unassigned',
  ASSIGNED: 'Assigned',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: Date | null) {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(d: Date | null) {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function formatCurrency(amount: unknown) {
  const n = typeof amount === 'number' ? amount : Number(amount)
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function isOperationallyReady(
  tasks: { isBlockingOperational: boolean; completedAt: Date | null }[]
) {
  return !tasks.some((t) => t.isBlockingOperational && !t.completedAt)
}

// ─── Small UI pieces (matching dashboard styling) ────────────────────────────

function BusinessBadge({ slug, color }: { slug: string; color: string | null }) {
  const bg = color ?? (slug === 'ronnies' ? '#8B1A1A' : '#2D5A27')
  const label = slug === 'ronnies' ? "Ronnie's BBQ" : 'Le Box'
  return (
    <span style={{
      display: 'inline-block', background: bg, color: '#fff',
      fontSize: '11px', fontWeight: 600, padding: '2px 8px',
      borderRadius: '4px', letterSpacing: '0.02em', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function ChannelTag({ channel }: { channel: string }) {
  return (
    <span style={{
      display: 'inline-block', background: '#f3f4f6', color: '#374151',
      fontSize: '11px', fontWeight: 500, padding: '2px 7px',
      borderRadius: '4px', border: '1px solid #e5e7eb',
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
        display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%',
        background: ready ? '#16a34a' : '#dc2626', flexShrink: 0,
      }}
    />
  )
}

function Pill({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-block', background: bg, color, fontSize: '11px',
      fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
    }}>
      {children}
    </span>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px',
      padding: '18px 20px', marginBottom: '20px',
    }}>
      <h2 style={{
        fontSize: '13px', fontWeight: 700, color: '#374151', margin: '0 0 14px',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchOrder(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      business: { select: { name: true, slug: true, brandColor: true } },
      customer: true,
      items: { orderBy: { createdAt: 'asc' } },
      tasks: {
        orderBy: [{ completedAt: 'asc' }, { dueDate: 'asc' }],
        include: {
          assignedTo: { select: { name: true, email: true } },
          completedBy: { select: { name: true, email: true } },
        },
      },
      updates: { orderBy: { receivedAt: 'desc' } },
      payments: { orderBy: { createdAt: 'asc' } },
      delivery: true,
      documents: { orderBy: { createdAt: 'asc' } },
    },
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { id } = await params
  const order = await fetchOrder(id)
  if (!order) notFound()

  const ready = isOperationallyReady(order.tasks)
  const openTasks = order.tasks.filter((t) => !t.completedAt)
  const completedTasks = order.tasks.filter((t) => t.completedAt)

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
          <a href="/" style={{ fontSize: '13px', color: '#6b7280', textDecoration: 'none' }}>
            ← Needs Attention
          </a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>{session.user?.email}</span>
          <form action="/api/auth/signout" method="POST">
            <button type="submit" style={{
              background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px',
              padding: '4px 10px', fontSize: '12px', color: '#6b7280', cursor: 'pointer',
            }}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
        {/* Order summary */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <BusinessBadge slug={order.business.slug} color={order.business.brandColor} />
            <ChannelTag channel={order.channel} />
            <Pill
              color={order.status === 'CANCELLED' ? '#dc2626' : order.status === 'COMPLETED' ? '#16a34a' : '#1d4ed8'}
              bg={order.status === 'CANCELLED' ? '#fef2f2' : order.status === 'COMPLETED' ? '#f0fdf4' : '#eff6ff'}
            >
              {STATUS_LABELS[order.status] ?? order.status}
            </Pill>
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>
              {LIFECYCLE_LABELS[order.lifecycleState] ?? order.lifecycleState}
            </span>
          </div>

          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {order.customer.name.replace(' (SYNTHETIC)', '')}
            <ReadinessDot ready={ready} />
          </h1>
          {!ready && (
            <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600, marginBottom: '4px' }}>
              Not operationally ready — blocking task(s) remain
            </div>
          )}

          <div style={{ fontSize: '13px', color: '#6b7280', display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '8px' }}>
            <span>📅 Event: {formatDate(order.eventDate)}</span>
            {order.venue && <span>📍 {order.venue}</span>}
            {order.externalOrderId && <span>Ref: {order.externalOrderId}</span>}
          </div>

          {(order.customer.email || order.customer.phone) && (
            <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
              {order.customer.email && <span>{order.customer.email}</span>}
              {order.customer.email && order.customer.phone && <span> · </span>}
              {order.customer.phone && <span>{order.customer.phone}</span>}
            </div>
          )}

          {order.originalProcessingComplete && (
            <div style={{ marginTop: '8px' }}>
              <Pill color="#166534" bg="#f0fdf4">Original processing complete</Pill>
            </div>
          )}
        </div>

        {/* Tasks */}
        <Card title={`Tasks (${openTasks.length} open, ${completedTasks.length} done)`}>
          {order.tasks.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#9ca3af' }}>No tasks on this order.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {openTasks.map((task) => {
                const action = completeTask.bind(null, task.id)
                return (
                  <div key={task.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px',
                    alignItems: 'center', padding: '10px 0',
                    borderBottom: '1px solid #f3f4f6',
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        {task.isBlockingOperational && (
                          <span style={{
                            fontSize: '10px', fontWeight: 700, color: '#7c3aed', background: '#f3e8ff',
                            padding: '1px 6px', borderRadius: '3px', border: '1px solid #e9d5ff',
                          }}>
                            BLOCKING
                          </span>
                        )}
                        <span style={{ fontSize: '13px', color: '#111827', fontWeight: 500 }}>
                          {TASK_LABELS[task.taskType] ?? task.taskType}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                        {task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No due date set'}
                        {task.assignedTo?.name && ` · Assigned to ${task.assignedTo.name}`}
                      </div>
                    </div>
                    <form action={action}>
                      <button type="submit" style={{
                        background: '#fff', border: '1px solid #d1d5db', color: '#374151',
                        borderRadius: '6px', padding: '6px 12px', fontSize: '12px',
                        fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>
                        Mark Done
                      </button>
                    </form>
                  </div>
                )
              })}
              {completedTasks.map((task) => (
                <div key={task.id} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 0', borderBottom: '1px solid #f3f4f6', opacity: 0.6,
                }}>
                  <span style={{ fontSize: '13px', color: '#16a34a' }}>✓</span>
                  <span style={{ fontSize: '13px', color: '#6b7280', textDecoration: 'line-through' }}>
                    {TASK_LABELS[task.taskType] ?? task.taskType}
                  </span>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                    {formatDate(task.completedAt)}
                    {task.completedBy?.name && ` by ${task.completedBy.name}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Order Items */}
        <Card title="Order Items">
          {order.items.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#9ca3af' }}>No items recorded.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 0', color: '#111827' }}>{item.name}</td>
                    <td style={{ padding: '8px 0', color: '#6b7280', textAlign: 'right' }}>
                      {item.quantity != null ? `${item.quantity} ${item.unit ?? ''}`.trim() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Order Updates / Revisions */}
        {order.updates.length > 0 && (
          <Card title="Order Updates">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {order.updates.map((update) => (
                <div key={update.id} style={{
                  padding: '10px', border: '1px solid #f3f4f6', borderRadius: '6px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    {update.revisionLabel && (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#374151' }}>
                        Rev {update.revisionLabel}
                      </span>
                    )}
                    <Pill
                      color={RESOLUTION_COLORS[update.resolutionState]}
                      bg={`${RESOLUTION_COLORS[update.resolutionState]}15`}
                    >
                      {update.resolutionState.replace('_', ' ')}
                    </Pill>
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                      {formatDateTime(update.receivedAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#374151' }}>{update.description}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Payments */}
        {order.payments.length > 0 && (
          <Card title="Payments">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {order.payments.map((payment) => (
                  <tr key={payment.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 0', color: '#111827' }}>
                      {payment.paymentType.replace('_', ' ')}
                    </td>
                    <td style={{ padding: '8px 0', color: '#6b7280' }}>
                      {formatCurrency(payment.amount)}
                    </td>
                    <td style={{ padding: '8px 0' }}>
                      <Pill
                        color={PAYMENT_STATUS_COLORS[payment.status]}
                        bg={`${PAYMENT_STATUS_COLORS[payment.status]}15`}
                      >
                        {payment.status}
                      </Pill>
                    </td>
                    <td style={{ padding: '8px 0', color: '#9ca3af', textAlign: 'right', fontSize: '12px' }}>
                      {payment.status === 'RECEIVED'
                        ? `Received ${formatDate(payment.receivedAt)}`
                        : `Due ${formatDate(payment.dueDate)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* Delivery */}
        {order.delivery && (
          <Card title="Delivery">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#374151' }}>
              <div>
                <Pill color="#1d4ed8" bg="#eff6ff">
                  {DELIVERY_STATUS_LABELS[order.delivery.status] ?? order.delivery.status}
                </Pill>
              </div>
              {order.delivery.driverName && <div>Driver: {order.delivery.driverName}</div>}
              {order.delivery.deliveryWindowStart && (
                <div>
                  Window: {formatDateTime(order.delivery.deliveryWindowStart)}
                  {order.delivery.deliveryWindowEnd && ` – ${formatDateTime(order.delivery.deliveryWindowEnd)}`}
                </div>
              )}
              {order.delivery.specialInstructions && (
                <div style={{ color: '#6b7280' }}>Notes: {order.delivery.specialInstructions}</div>
              )}
            </div>
          </Card>
        )}

        {/* Documents */}
        {order.documents.length > 0 && (
          <Card title="Documents">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {order.documents.map((doc) => (
                <div key={doc.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: '13px', padding: '6px 0', borderBottom: '1px solid #f3f4f6',
                }}>
                  <span style={{ color: '#111827' }}>{doc.originalFilename}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>{doc.extractionStatus}</span>
                    {doc.isApproved && <Pill color="#166534" bg="#f0fdf4">Approved</Pill>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {order.notes && (
          <Card title="Notes">
            <div style={{ fontSize: '13px', color: '#374151', whiteSpace: 'pre-wrap' }}>{order.notes}</div>
          </Card>
        )}
      </main>
    </div>
  )
}