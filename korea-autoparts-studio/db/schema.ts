import { sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const listingWorkBatches = sqliteTable('listing_work_batches', {
  date: text('date').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
