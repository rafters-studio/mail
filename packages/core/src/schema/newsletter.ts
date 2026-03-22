import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const requiredTimestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

const deletedAt = () => integer('deleted_at', { mode: 'timestamp_ms' });

// ===== PLATFORM AUDIENCE =====

export const platformAudience = sqliteTable(
  'platform_audience',
  {
    id: id(),
    providerListId: text('provider_list_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    slug: text('slug').notNull(),
    createdAt: requiredTimestamp('created_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('platform_audience_provider_list_id_idx').on(table.providerListId),
    uniqueIndex('platform_audience_slug_idx').on(table.slug),
  ],
);

// ===== PLATFORM SUBSCRIBER =====

export const platformSubscriber = sqliteTable(
  'platform_subscriber',
  {
    id: id(),
    userId: text('user_id').notNull(),
    audienceId: text('audience_id')
      .notNull()
      .references(() => platformAudience.id, { onDelete: 'cascade' }),
    providerSubscriberId: text('provider_subscriber_id').notNull(),
    subscribedAt: requiredTimestamp('subscribed_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('unique_platform_subscriber').on(table.userId, table.audienceId),
    index('platform_subscriber_user_id_idx').on(table.userId),
    index('platform_subscriber_audience_id_idx').on(table.audienceId),
  ],
);

// ===== BROADCAST AUDIT =====

export const broadcastAudit = sqliteTable(
  'broadcast_audit',
  {
    id: id(),
    providerCampaignId: text('provider_campaign_id').notNull(),
    subject: text('subject').notNull(),
    contentHash: text('content_hash'),
    sentBy: text('sent_by'),
    audienceName: text('audience_name').notNull(),
    audienceId: text('audience_id'),
    recipientCount: integer('recipient_count'),
    sentAt: requiredTimestamp('sent_at'),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('broadcast_audit_provider_campaign_id_idx').on(table.providerCampaignId),
    index('broadcast_audit_sent_by_idx').on(table.sentBy),
    index('broadcast_audit_sent_at_idx').on(table.sentAt),
    index('broadcast_audit_audience_id_idx').on(table.audienceId),
  ],
);
