/**
 * Operations Control Hub — Prisma Seed
 *
 * Seeds:
 *   1. Two Business records (Ronnie's BBQ, Le Box Lunch Cafe)
 *   2. WorkflowDefinitions for all 8 Business × Channel × RecordContext combos
 *   3. FulfillmentRules (cookie, mac & cheese, Le Box supporting items)
 *   4. Two synthetic test users (SYNTHETIC — not real staff)
 *
 * Privacy constraint: NO real customer, order, pricing, document,
 * or operational data in this file. Business names and workflow logic
 * are configuration, not customer data.
 *
 * Run: npx prisma db seed
 * Requires: DATABASE_URL set in .env with sslmode=require
 */

import { PrismaClient, TaskType, Channel, RecordContext } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// ─── Business × Channel × RecordContext → required task types ────────────────
//
// Task order reflects recommended completion sequence.
// SKIPPABLE tasks (e.g., DRIVER_ASSIGN for pickup orders) must still
// appear here — staff mark them SKIPPED when not applicable.
// Conditional tasks that genuinely never apply to a channel are omitted.

const WORKFLOW_DEFINITIONS: Array<{
  businessSlug: 'ronnies' | 'lebox'
  channel: Channel
  recordContext: RecordContext
  requiredTaskTypes: TaskType[]
}> = [
  // ── Ronnie's BBQ × DIRECT × NEW_ORDER ──────────────────────────────────────
  {
    businessSlug: 'ronnies',
    channel: 'DIRECT',
    recordContext: 'NEW_ORDER',
    requiredTaskTypes: [
      'DOCUMENT_UPLOAD_AND_REVIEW',   // Intake: upload inquiry/contract docs
      'ORDER_VERIFICATION',            // Verify event details, headcount, items
      'SEVENTEEN_HATS_CREATE_OR_UPDATE', // Create 17hats record
      'SLACK_CHANNEL_CREATE',          // Create order Slack channel
      'SLACK_CHANNEL_NOTIFY',          // Post order details to channel
      'GOOGLE_CALENDAR_ADD',           // Add event to production calendar
      'DRIVER_ASSIGN',                 // Assign driver (mark SKIPPED for pickup)
      'PAYMENT_RETAINER_REQUEST',      // Request retainer if threshold met (mark SKIPPED if not)
    ],
  },

  // ── Ronnie's BBQ × DIRECT × ORDER_UPDATE ───────────────────────────────────
  {
    businessSlug: 'ronnies',
    channel: 'DIRECT',
    recordContext: 'ORDER_UPDATE',
    requiredTaskTypes: [
      'DOCUMENT_UPLOAD_AND_REVIEW',      // Upload any updated contract/paperwork
      'ORDER_VERIFICATION',               // Verify the change details
      'CUSTOMER_ACKNOWLEDGMENT',          // Confirm change with customer
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',  // Update 17hats record
      'SLACK_CHANNEL_NOTIFY',             // Notify Slack channel of the change
    ],
  },

  // ── Ronnie's BBQ × EZCATER × NEW_ORDER ────────────────────────────────────
  {
    businessSlug: 'ronnies',
    channel: 'EZCATER',
    recordContext: 'NEW_ORDER',
    requiredTaskTypes: [
      'EZCATER_ACCEPT_IN_PLATFORM',        // Accept/decline in EZCater platform
      'DOCUMENT_UPLOAD_AND_REVIEW',         // Download & upload order details
      'ORDER_VERIFICATION',                 // Verify items, delivery window, address
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',    // Create 17hats record
      'SLACK_CHANNEL_CREATE',               // Create order Slack channel
      'SLACK_CHANNEL_NOTIFY',               // Post order details to channel
      'GOOGLE_CALENDAR_ADD',                // Add event to production calendar
      'DRIVER_ASSIGN',                      // Assign in-house driver first; mark SKIPPED if 3PD used instead
    ],
  },

  // ── Ronnie's BBQ × EZCATER × ORDER_UPDATE ─────────────────────────────────
  {
    businessSlug: 'ronnies',
    channel: 'EZCATER',
    recordContext: 'ORDER_UPDATE',
    requiredTaskTypes: [
      'DOCUMENT_UPLOAD_AND_REVIEW',       // Upload updated order doc from EZCater
      'ORDER_VERIFICATION',                // Verify the change details
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',   // Update 17hats record
      'SLACK_CHANNEL_NOTIFY',              // Notify Slack channel of the change
    ],
  },

  // ── Le Box Lunch Cafe × DIRECT × NEW_ORDER ────────────────────────────────
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
      'DRIVER_ASSIGN',                  // Mark SKIPPED for pickup orders
      'PAYMENT_RETAINER_REQUEST',       // Mark SKIPPED if threshold not met
    ],
  },

  // ── Le Box Lunch Cafe × DIRECT × ORDER_UPDATE ─────────────────────────────
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

  // ── Le Box Lunch Cafe × CATERNATION × NEW_ORDER ───────────────────────────
  {
    businessSlug: 'lebox',
    channel: 'CATERNATION',
    recordContext: 'NEW_ORDER',
    requiredTaskTypes: [
      'CATERNATION_ACCEPT_VIA_EMAIL_OR_TEXT', // Accept via email or text (not in platform)
      'DOCUMENT_UPLOAD_AND_REVIEW',            // Le Box downloads & uploads revised invoice
      'ORDER_VERIFICATION',                    // Verify items, headcount, delivery details
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',
      'SLACK_CHANNEL_CREATE',
      'SLACK_CHANNEL_NOTIFY',
      'GOOGLE_CALENDAR_ADD',
      'DRIVER_ASSIGN',                         // CaterNation does not manage Hub drivers
    ],
  },

  // ── Le Box Lunch Cafe × CATERNATION × ORDER_UPDATE ────────────────────────
  {
    businessSlug: 'lebox',
    channel: 'CATERNATION',
    recordContext: 'ORDER_UPDATE',
    // CaterNation revision letters (12-345A, 12-345B) each require the full
    // eight-step update resolution process. Each revision is a separate
    // OrderUpdate record; resolving one does not affect others.
    requiredTaskTypes: [
      'DOCUMENT_UPLOAD_AND_REVIEW',        // Le Box downloads revised CaterNation invoice
      'ORDER_VERIFICATION',                // Verify what changed in this revision
      'SEVENTEEN_HATS_CREATE_OR_UPDATE',   // Update 17hats record
      'SLACK_CHANNEL_NOTIFY',              // Notify Slack channel
    ],
  },
]

// ─── Fulfillment Rules ────────────────────────────────────────────────────────
//
// triggerConfig.type values in V1:
//   ITEM_KEYWORD:      match keyword against order notes or extracted document text
//   BUSINESS_SPECIFIC: always triggered for a specific business (when businessId set)
//
// In V1, triggering may be manual (staff creates the OrderFulfillmentRule
// record directly) or keyword-based. See src/lib/fulfillment.ts for evaluation.

const FULFILLMENT_RULES: Array<{
  businessSlug: 'ronnies' | 'lebox' | null // null = all businesses
  name: string
  description: string
  triggerConfig: object
  requiredActionDescription: string
}> = [
  {
    businessSlug: null, // Applies to Ronnie's and Le Box
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
      'date before marking this rule satisfied. Document confirmation in notes.',
  },
  {
    businessSlug: 'ronnies',
    name: "Mac & Cheese Communication",
    description:
      "Triggered when a Ronnie's BBQ order includes mac & cheese. The kitchen " +
      'requires advance notice of mac & cheese quantity to manage prep capacity.',
    triggerConfig: {
      type: 'ITEM_KEYWORD',
      keyword: 'mac',
      matchFields: ['orderNotes', 'extractedText'],
      caseSensitive: false,
    },
    requiredActionDescription:
      'Communicate the mac & cheese quantity and event date to the kitchen. ' +
      'Confirm kitchen acknowledgment before marking this rule satisfied.',
  },
  {
    businessSlug: 'lebox',
    name: 'Le Box Supporting Items',
    description:
      'Triggered when a Le Box order requires supporting items that must be ' +
      'sourced externally (e.g., specialty items not in standard inventory).',
    triggerConfig: {
      type: 'ITEM_KEYWORD',
      keyword: 'supporting',
      matchFields: ['orderNotes', 'extractedText'],
      caseSensitive: false,
    },
    requiredActionDescription:
      'Initiate supporting item procurement process. Confirm item availability ' +
      'and sourcing timeline. Document procurement status in notes.',
  },
]

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
      brandColor: '#8B1A1A', // Deep red — placeholder, update to match actual brand
      isActive: true,
    },
  })

  const lebox = await prisma.business.upsert({
    where: { slug: 'lebox' },
    update: {},
    create: {
      name: 'Le Box Lunch Cafe',
      slug: 'lebox',
      brandColor: '#2D5A27', // Forest green — placeholder, update to match actual brand
      isActive: true,
    },
  })

  const businessMap: Record<string, typeof ronnies> = {
    ronnies,
    lebox,
  }

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
      update: {
        requiredTaskTypes: def.requiredTaskTypes,
        isActive: true,
      },
      create: {
        businessId: business.id,
        channel: def.channel,
        recordContext: def.recordContext,
        requiredTaskTypes: def.requiredTaskTypes,
        isActive: true,
      },
    })
  }

  console.log(`  ✓ WorkflowDefinitions seeded (${WORKFLOW_DEFINITIONS.length} definitions)`)

  // 3. FulfillmentRules
  for (const rule of FULFILLMENT_RULES) {
    const businessId = rule.businessSlug ? businessMap[rule.businessSlug].id : null

    // Look up by name (no natural unique key; upsert by name + businessId)
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

  console.log(`  ✓ FulfillmentRules seeded (${FULFILLMENT_RULES.length} rules)`)

  // 4. Synthetic test users
  // SYNTHETIC DATA — not real staff accounts.
  // Real user accounts are created via the Admin UI after go-live.
  const BCRYPT_ROUNDS = 12

  const adminHash = await bcrypt.hash('britbook24!!', BCRYPT_ROUNDS)
  const collabHash = await bcrypt.hash('britbook24!!', BCRYPT_ROUNDS)

  await prisma.user.upsert({
    where: { email: 'synthetic-admin@example.test' },
    update: {},
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
    update: {},
    create: {
      name: 'Synthetic Collaborator (TEST ONLY)',
      email: 'synthetic-collab@example.test',
      passwordHash: collabHash,
      role: 'COLLABORATOR',
      isActive: true,
    },
  })

  console.log('  ✓ Synthetic test users seeded (synthetic only — not real accounts)')
  console.log('\nSeed complete.')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
