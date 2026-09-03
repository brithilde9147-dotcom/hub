/**
 * Operations Control Hub — Prisma Seed
 *
 * Seeds:
 *   1. Two Business records (Ronnie's BBQ, Le Box Lunch Cafe)
 *   2. WorkflowDefinitions for all 8 Business × Channel × RecordContext combos
 *   3. FulfillmentRules (cookie, mac & cheese, Le Box supporting items)
 *   4. Two synthetic test users (SYNTHETIC — not real staff)
 *   5. Synthetic orders + items + tasks for dashboard testing
 *
 * Privacy constraint: NO real customer, order, pricing, document,
 * or operational data in this file. All customer names, companies,
 * and order data below are entirely fictitious (SYNTHETIC TEST DATA).
 * Business names and workflow logic are configuration, not customer data.
 *
 * Run: npx prisma db seed
 * Requires: DATABASE_URL set in .env with sslmode=require
 */

import {
  PrismaClient,
  TaskType,
  Channel,
  RecordContext,
  TaskStatus,
  OrderStatus,
  OrderLifecycleState,
  TaskDueWindowType,
  TaskVerificationMethod,
} from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// ─── Business × Channel × RecordContext → required task types ────────────────

const WORKFLOW_DEFINITIONS: Array<{
  businessSlug: 'ronnies' | 'lebox'
  channel: Channel
  recordContext: RecordContext
  requiredTaskTypes: TaskType[]
}> = [
  {
    businessSlug: 'ronnies',
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
  },
  {
    businessSlug: 'ronnies',
    channel: 'DIRECT',
    recordContext: 'ORDER_UPDATE',
    requiredTaskTypes: [
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'CUSTOMER_ACKNOWLEDGMENT',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_NOTIFY',
    ],
  },
  {
    businessSlug: 'ronnies',
    channel: 'EZCATER',
    recordContext: 'NEW_ORDER',
    requiredTaskTypes: [
      'EZCATER_ACCEPT_IN_PLATFORM',
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_CREATE',
      'SLACK_CHANNEL_NOTIFY',
      'GOOGLE_CALENDAR_ADD',
      'DRIVER_ASSIGN',
    ],
  },
  {
    businessSlug: 'ronnies',
    channel: 'EZCATER',
    recordContext: 'ORDER_UPDATE',
    requiredTaskTypes: [
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_NOTIFY',
    ],
  },
  {
    businessSlug: 'lebox',
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
  },
  {
    businessSlug: 'lebox',
    channel: 'DIRECT',
    recordContext: 'ORDER_UPDATE',
    requiredTaskTypes: [
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'CUSTOMER_ACKNOWLEDGMENT',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_NOTIFY',
    ],
  },
  {
    businessSlug: 'lebox',
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
  },
  {
    businessSlug: 'lebox',
    channel: 'CATERNATION',
    recordContext: 'ORDER_UPDATE',
    requiredTaskTypes: [
      'DOCUMENT_UPLOAD_AND_REVIEW',
      'ORDER_VERIFICATION',
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_NOTIFY',
    ],
  },
]

// ─── Fulfillment Rules ────────────────────────────────────────────────────────

const FULFILLMENT_RULES: Array<{
  businessSlug: 'ronnies' | 'lebox' | null
  name: string
  description: string
  triggerConfig: object
  requiredActionDescription: string
}> = [
  {
    businessSlug: null,
    name: 'Cookie Request',
    description:
      'Triggered when an order includes a cookie item. Cookies require vendor ' +
      'confirmation before the order can be accepted and processed.',
    triggerConfig: {
      type: 'ITEM_KEYWORD',
      keyword: 'cookie',
      matchFields: ['orderNotes', 'extractedText'],
      caseSensitive: false,
    },
    requiredActionDescription:
      'Contact cookie vendor to confirm availability and quantity for the event ' +
      'date before marking this rule satisfied.',
  },
  {
    businessSlug: 'ronnies',
    name: "Mac & Cheese Communication",
    description:
      "Triggered when a Ronnie's BBQ order includes mac & cheese. Kitchen requires " +
      'advance notice of quantity to manage prep capacity.',
    triggerConfig: {
      type: 'ITEM_KEYWORD',
      keyword: 'mac',
      matchFields: ['orderNotes', 'extractedText'],
      caseSensitive: false,
    },
    requiredActionDescription:
      'Communicate mac & cheese quantity and event date to the kitchen. ' +
      'Confirm acknowledgment before marking satisfied.',
  },
  {
    businessSlug: 'lebox',
    name: 'Le Box Supporting Items',
    description:
      'Triggered when a Le Box order requires supporting items sourced externally.',
    triggerConfig: {
      type: 'ITEM_KEYWORD',
      keyword: 'supporting',
      matchFields: ['orderNotes', 'extractedText'],
      caseSensitive: false,
    },
    requiredActionDescription:
      'Initiate supporting item procurement. Confirm availability and sourcing timeline.',
  },
]

// ─── Synthetic order scenarios for dashboard testing ──────────────────────────
//
// All names, companies, and details are entirely fictitious.
// Dates are relative to approximate seed date (early Sept 2026) so the
// Needs Attention dashboard has realistic overdue/due-today/coming-due data.
// Re-seed periodically as event dates age out.

const today = new Date()
today.setHours(0, 0, 0, 0)

function daysFromToday(n: number): Date {
  const d = new Date(today)
  d.setDate(d.getDate() + n)
  return d
}

// ─── Seed function ────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding Operations Control Hub...')

  // 1. Businesses
  const ronnies = await prisma.business.upsert({
    where: { slug: 'ronnies' },
    update: {},
    create: {
      name: "Ronnie's BBQ",
      slug: 'ronnies',
      brandColor: '#8B1A1A',
      isActive: true,
    },
  })

  const lebox = await prisma.business.upsert({
    where: { slug: 'lebox' },
    update: {},
    create: {
      name: 'Le Box Lunch Cafe',
      slug: 'lebox',
      brandColor: '#2D5A27',
      isActive: true,
    },
  })

  const businessMap: Record<string, typeof ronnies> = { ronnies, lebox }
  console.log('  ✓ Businesses seeded')

  // 2. WorkflowDefinitions
  for (const def of WORKFLOW_DEFINITIONS) {
    const business = businessMap[def.businessSlug]
    await prisma.workflowDefinition.upsert({
      where: {
        businessId_channel_recordContext: {
          businessId: business.id,
          channel: def.channel,
          recordContext: def.recordContext,
        },
      },
      update: { requiredTaskTypes: def.requiredTaskTypes, isActive: true },
      create: {
        businessId: business.id,
        channel: def.channel,
        recordContext: def.recordContext,
        requiredTaskTypes: def.requiredTaskTypes,
        isActive: true,
      },
    })
  }
  console.log(`  ✓ WorkflowDefinitions seeded (${WORKFLOW_DEFINITIONS.length})`)

  // 3. FulfillmentRules
  for (const rule of FULFILLMENT_RULES) {
    const businessId = rule.businessSlug ? businessMap[rule.businessSlug].id : null
    const existing = await prisma.fulfillmentRule.findFirst({
      where: { name: rule.name, businessId: businessId ?? undefined },
    })
    if (existing) {
      await prisma.fulfillmentRule.update({
        where: { id: existing.id },
        data: {
          description: rule.description,
          triggerConfig: rule.triggerConfig,
          requiredActionDescription: rule.requiredActionDescription,
          isActive: true,
        },
      })
    } else {
      await prisma.fulfillmentRule.create({
        data: {
          businessId,
          name: rule.name,
          description: rule.description,
          triggerConfig: rule.triggerConfig,
          requiredActionDescription: rule.requiredActionDescription,
          isActive: true,
        },
      })
    }
  }
  console.log(`  ✓ FulfillmentRules seeded (${FULFILLMENT_RULES.length})`)

  // 4. Synthetic test users
  const BCRYPT_ROUNDS = 12
  const adminHash = await bcrypt.hash('Kx7#mQp2$vLwZ9nR', BCRYPT_ROUNDS)
  const collabHash = await bcrypt.hash('Kx7#mQp2$vLwZ9nR', BCRYPT_ROUNDS)

  await prisma.user.upsert({
    where: { email: 'synthetic-admin@example.test' },
    update: { passwordHash: adminHash },
    create: {
      name: 'Synthetic Admin (TEST ONLY)',
      email: 'synthetic-admin@example.test',
      passwordHash: adminHash,
      role: 'ADMIN',
      isActive: true,
    },
  })

  await prisma.user.upsert({
    where: { email: 'synthetic-collab@example.test' },
    update: { passwordHash: collabHash },
    create: {
      name: 'Synthetic Collaborator (TEST ONLY)',
      email: 'synthetic-collab@example.test',
      passwordHash: collabHash,
      role: 'COLLABORATOR',
      isActive: true,
    },
  })
  console.log('  ✓ Synthetic test users seeded')

  // 5. Synthetic customers (FICTITIOUS — not real people)
  const customers = await Promise.all([
    prisma.customer.upsert({
      where: { id: 'syn-cust-001' },
      update: {},
      create: {
        id: 'syn-cust-001',
        name: 'Acme Corp (SYNTHETIC)',
        email: 'events@acme.example.test',
        phone: '555-0101',
      },
    }),
    prisma.customer.upsert({
      where: { id: 'syn-cust-002' },
      update: {},
      create: {
        id: 'syn-cust-002',
        name: 'Widgets Inc (SYNTHETIC)',
        email: 'catering@widgets.example.test',
        phone: '555-0102',
      },
    }),
    prisma.customer.upsert({
      where: { id: 'syn-cust-003' },
      update: {},
      create: {
        id: 'syn-cust-003',
        name: 'Sample Industries (SYNTHETIC)',
        email: 'admin@sampleindustries.example.test',
        phone: '555-0103',
      },
    }),
    prisma.customer.upsert({
      where: { id: 'syn-cust-004' },
      update: {},
      create: {
        id: 'syn-cust-004',
        name: 'Test Co (SYNTHETIC)',
        email: 'office@testco.example.test',
        phone: '555-0104',
      },
    }),
  ])

  const [acme, widgets, sampleIndustries, testCo] = customers
  console.log('  ✓ Synthetic customers seeded')

  // 6. Synthetic orders + items + tasks
  //
  // Scenario design — covers all three Needs Attention tiers:
  //   Tier 1 OVERDUE:      dueDate < today, completedAt = null
  //   Tier 2 DUE TODAY:    dueDate = today, completedAt = null
  //   Tier 3 COMING SOON:  dueDate within next 3 days, completedAt = null
  //
  // Also includes a healthy order (all tasks complete) to verify
  // it does NOT appear on the Needs Attention dashboard.

  // Clear existing synthetic orders so re-seed is idempotent
  await prisma.task.deleteMany({ where: { orderId: { in: ['syn-ord-001','syn-ord-002','syn-ord-003','syn-ord-004','syn-ord-005'] } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ['syn-ord-001','syn-ord-002','syn-ord-003','syn-ord-004','syn-ord-005'] } } })
  await prisma.order.deleteMany({ where: { id: { in: ['syn-ord-001','syn-ord-002','syn-ord-003','syn-ord-004','syn-ord-005'] } } })

  // ── Order 1: Ronnie's Direct — fall corporate lunch (OVERDUE task) ──────────
  // Event: Sept 19. Retainer was due Aug 28 — overdue.
  const ord1 = await prisma.order.create({
    data: {
      id: 'syn-ord-001',
      businessId: ronnies.id,
      customerId: acme.id,
      channel: 'DIRECT',
      eventDate: daysFromToday(17), // Sept 19 ≈ 17 days out
      venue: 'Acme Corp HQ (SYNTHETIC)',
      status: 'CONFIRMED',
      lifecycleState: 'CONFIRMED',
      notes: 'SYNTHETIC TEST DATA. Pulled pork, brisket, sides for 80 pax.',
    },
  })

  await prisma.orderItem.createMany({
    data: [
      { orderId: ord1.id, name: 'Pulled Pork (SYNTHETIC)', quantity: 20, unit: 'lbs' },
      { orderId: ord1.id, name: 'Beef Brisket (SYNTHETIC)', quantity: 15, unit: 'lbs' },
      { orderId: ord1.id, name: 'Mac & Cheese (SYNTHETIC)', quantity: 4, unit: 'pans' },
      { orderId: ord1.id, name: 'Coleslaw (SYNTHETIC)', quantity: 2, unit: 'pans' },
    ],
  })

  await prisma.task.createMany({
    data: [
      {
        orderId: ord1.id,
        taskType: 'SLACK_CHANNEL_CREATE',
        status: 'COMPLETED',
        completedAt: daysFromToday(-10),
        dueWindowType: 'IMMEDIATE',
        isBlockingOperational: false,
        verificationMethod: 'MANUAL',
      },
      {
        orderId: ord1.id,
        taskType: 'GOOGLE_CALENDAR_ADD',
        status: 'COMPLETED',
        completedAt: daysFromToday(-9),
        dueWindowType: 'IMMEDIATE',
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
      },
      {
        orderId: ord1.id,
        taskType: 'PAYMENT_RETAINER_REQUEST',
        status: 'PENDING',
        dueWindowType: 'IMMEDIATE',
        dueDate: daysFromToday(-5), // Was due 5 days ago — OVERDUE
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
        notes: 'SYNTHETIC: Order > $2,500 — retainer required.',
      },
      {
        orderId: ord1.id,
        taskType: 'DRIVER_ASSIGN',
        status: 'PENDING',
        dueWindowType: 'DAYS_BEFORE_EVENT',
        dueWindowValue: 14,
        dueDate: daysFromToday(3), // Due in 3 days — coming soon
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
      },
    ],
  })

  // ── Order 2: Le Box CaterNation — team lunch (DUE TODAY + OVERDUE tasks) ────
  // Event: Sept 10. Small window. 17Hats overdue, calendar due today.
  const ord2 = await prisma.order.create({
    data: {
      id: 'syn-ord-002',
      businessId: lebox.id,
      customerId: widgets.id,
      channel: 'CATERNATION',
      externalOrderId: 'CN-SYN-00291',
      eventDate: daysFromToday(8), // Sept 10 ≈ 8 days out
      venue: 'Widgets Inc Downtown (SYNTHETIC)',
      status: 'CONFIRMED',
      lifecycleState: 'PAYMENT_CONFIRMED',
      notes: 'SYNTHETIC TEST DATA. CaterNation order, 45 pax, sandwich build-your-own.',
    },
  })

  await prisma.orderItem.createMany({
    data: [
      { orderId: ord2.id, name: 'Turkey Sandwich (SYNTHETIC)', quantity: 20, unit: 'each' },
      { orderId: ord2.id, name: 'Veggie Wrap (SYNTHETIC)', quantity: 15, unit: 'each' },
      { orderId: ord2.id, name: 'Mixed Green Salad (SYNTHETIC)', quantity: 3, unit: 'pans' },
    ],
  })

  await prisma.task.createMany({
    data: [
      {
        orderId: ord2.id,
        taskType: 'CATERNATION_ACCEPT_VIA_EMAIL_OR_TEXT',
        status: 'COMPLETED',
        completedAt: daysFromToday(-6),
        dueWindowType: 'IMMEDIATE',
        isBlockingOperational: false,
        verificationMethod: 'MANUAL',
      },
      {
        orderId: ord2.id,
        taskType: 'SEVENTEEN_HATS_CREATE_OR_UPDATE',
        status: 'PENDING',
        dueWindowType: 'IMMEDIATE',
        dueDate: daysFromToday(-2), // OVERDUE by 2 days
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
        notes: 'SYNTHETIC: Create 17Hats record for CN-SYN-00291.',
      },
      {
        orderId: ord2.id,
        taskType: 'GOOGLE_CALENDAR_ADD',
        status: 'PENDING',
        dueWindowType: 'IMMEDIATE',
        dueDate: today, // DUE TODAY
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
      },
      {
        orderId: ord2.id,
        taskType: 'DRIVER_ASSIGN',
        status: 'PENDING',
        dueWindowType: 'DAYS_BEFORE_EVENT',
        dueWindowValue: 7,
        dueDate: daysFromToday(1), // Due tomorrow — coming soon
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
      },
    ],
  })

  // ── Order 3: Ronnie's EZCater — engineering team lunch (URGENT, event close) ─
  // Event: Sept 9. Verification overdue; driver due today. Very close.
  const ord3 = await prisma.order.create({
    data: {
      id: 'syn-ord-003',
      businessId: ronnies.id,
      customerId: sampleIndustries.id,
      channel: 'EZCATER',
      externalOrderId: 'EZC-SYN-77842',
      eventDate: daysFromToday(7), // Sept 9 ≈ 7 days out
      venue: 'Sample Industries Campus (SYNTHETIC)',
      status: 'CONFIRMED',
      lifecycleState: 'QUOTE_ACCEPTED',
      notes: 'SYNTHETIC TEST DATA. EZCater. 60 pax, BBQ spread.',
    },
  })

  await prisma.orderItem.createMany({
    data: [
      { orderId: ord3.id, name: 'Pulled Pork (SYNTHETIC)', quantity: 18, unit: 'lbs' },
      { orderId: ord3.id, name: 'Chicken Quarters (SYNTHETIC)', quantity: 30, unit: 'each' },
      { orderId: ord3.id, name: 'Baked Beans (SYNTHETIC)', quantity: 3, unit: 'pans' },
    ],
  })

  await prisma.task.createMany({
    data: [
      {
        orderId: ord3.id,
        taskType: 'EZCATER_ACCEPT_IN_PLATFORM',
        status: 'COMPLETED',
        completedAt: daysFromToday(-4),
        dueWindowType: 'IMMEDIATE',
        isBlockingOperational: false,
        verificationMethod: 'MANUAL',
      },
      {
        orderId: ord3.id,
        taskType: 'ORDER_VERIFICATION',
        status: 'PENDING',
        dueWindowType: 'IMMEDIATE',
        dueDate: daysFromToday(-3), // OVERDUE by 3 days
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
        notes: 'SYNTHETIC: Verify headcount and delivery address.',
      },
      {
        orderId: ord3.id,
        taskType: 'DRIVER_ASSIGN',
        status: 'PENDING',
        dueWindowType: 'DAYS_BEFORE_EVENT',
        dueWindowValue: 7,
        dueDate: today, // DUE TODAY
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
      },
    ],
  })

  // ── Order 4: Le Box Direct — breakfast tomorrow (URGENT, event is tomorrow) ──
  const ord4 = await prisma.order.create({
    data: {
      id: 'syn-ord-004',
      businessId: lebox.id,
      customerId: testCo.id,
      channel: 'DIRECT',
      eventDate: daysFromToday(1), // TOMORROW — very urgent
      venue: 'Test Co Office (SYNTHETIC)',
      status: 'CONFIRMED',
      lifecycleState: 'CONFIRMED',
      notes: 'SYNTHETIC TEST DATA. Executive breakfast, 20 pax.',
    },
  })

  await prisma.orderItem.createMany({
    data: [
      { orderId: ord4.id, name: 'Breakfast Boxes (SYNTHETIC)', quantity: 20, unit: 'each' },
      { orderId: ord4.id, name: 'Coffee Service (SYNTHETIC)', quantity: 1, unit: 'setup' },
    ],
  })

  await prisma.task.createMany({
    data: [
      {
        orderId: ord4.id,
        taskType: 'DRIVER_ASSIGN',
        status: 'PENDING',
        dueWindowType: 'DAYS_BEFORE_EVENT',
        dueWindowValue: 1,
        dueDate: today, // DUE TODAY — event is tomorrow, driver must be locked now
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
        notes: 'SYNTHETIC: Event is tomorrow — driver must be confirmed today.',
      },
      {
        orderId: ord4.id,
        taskType: 'CUSTOMER_ACKNOWLEDGMENT',
        status: 'PENDING',
        dueWindowType: 'DAYS_BEFORE_EVENT',
        dueWindowValue: 1,
        dueDate: today, // DUE TODAY
        isBlockingOperational: false,
        verificationMethod: 'MANUAL',
      },
    ],
  })

  // ── Order 5: Ronnie's Direct — fall event (COMING SOON, healthy-ish) ─────────
  // Event: Oct 15. All is under control — tasks coming due in 2-5 days.
  const ord5 = await prisma.order.create({
    data: {
      id: 'syn-ord-005',
      businessId: ronnies.id,
      customerId: acme.id,
      channel: 'DIRECT',
      eventDate: daysFromToday(43), // Oct 15
      venue: 'Acme Corp Offsite Venue (SYNTHETIC)',
      status: 'CONFIRMED',
      lifecycleState: 'PAYMENT_CONFIRMED',
      notes: 'SYNTHETIC TEST DATA. Annual fall event, 150 pax.',
    },
  })

  await prisma.orderItem.createMany({
    data: [
      { orderId: ord5.id, name: 'Brisket (SYNTHETIC)', quantity: 40, unit: 'lbs' },
      { orderId: ord5.id, name: 'Pulled Pork (SYNTHETIC)', quantity: 35, unit: 'lbs' },
      { orderId: ord5.id, name: 'Ribs (SYNTHETIC)', quantity: 10, unit: 'racks' },
      { orderId: ord5.id, name: 'Chocolate Chip Cookies (SYNTHETIC)', quantity: 5, unit: 'dozen' },
    ],
  })

  await prisma.task.createMany({
    data: [
      {
        orderId: ord5.id,
        taskType: 'SEVENTEEN_HATS_CREATE_OR_UPDATE',
        status: 'COMPLETED',
        completedAt: daysFromToday(-5),
        dueWindowType: 'IMMEDIATE',
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
      },
      {
        orderId: ord5.id,
        taskType: 'SLACK_CHANNEL_CREATE',
        status: 'COMPLETED',
        completedAt: daysFromToday(-5),
        dueWindowType: 'IMMEDIATE',
        isBlockingOperational: false,
        verificationMethod: 'MANUAL',
      },
      {
        orderId: ord5.id,
        taskType: 'PAYMENT_RETAINER_REQUEST',
        status: 'COMPLETED',
        completedAt: daysFromToday(-3),
        dueWindowType: 'IMMEDIATE',
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
      },
      {
        orderId: ord5.id,
        taskType: 'ORDER_VERIFICATION',
        status: 'PENDING',
        dueWindowType: 'IMMEDIATE',
        dueDate: daysFromToday(2), // Due in 2 days — COMING SOON
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
        notes: 'SYNTHETIC: Confirm final headcount and menu selections.',
      },
      {
        orderId: ord5.id,
        taskType: 'DRIVER_ASSIGN',
        status: 'PENDING',
        dueWindowType: 'DAYS_BEFORE_EVENT',
        dueWindowValue: 14,
        dueDate: daysFromToday(29), // Oct 1 — not urgent yet
        isBlockingOperational: true,
        verificationMethod: 'MANUAL',
      },
    ],
  })

  console.log('  ✓ Synthetic orders + items + tasks seeded (5 orders, 3 tiers covered)')
  console.log('\nSeed complete.')
  console.log('\nTest credentials:')
  console.log('  synthetic-admin@example.test  /  Kx7#mQp2$vLwZ9nR')
  console.log('  synthetic-collab@example.test /  Kx7#mQp2$vLwZ9nR')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
