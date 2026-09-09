import { env } from 'cloudflare:workers';

export type ShippingPolicy = '7day normal' | '7day fast';
export type PreparationStatus = 'waiting' | 'ready' | 'working' | 'completed' | 'needs_attention';

export type WorkItem = {
  id: string;
  itemNumber: string;
  price: string;
  shippingPolicy: ShippingPolicy;
  memo: string;
  preparationStatus?: PreparationStatus;
  partNumber?: string;
  photoCount?: number;
  statusUpdatedAt?: string;
};

export type AgentGroup = {
  agent: number;
  items: WorkItem[];
};

export type SavedBatch = {
  date: string;
  batchMemo: string;
  groups: AgentGroup[];
};

type BatchRow = {
  payload: string;
  updated_at: string;
};

function database() {
  return (env as { DB: D1Database }).DB;
}

export async function getListingWorkBatch(date: string) {
  const row = await database()
    .prepare('SELECT payload, updated_at FROM listing_work_batches WHERE date = ?1')
    .bind(date)
    .first<BatchRow>();

  if (!row) return null;
  return {
    batch: JSON.parse(row.payload) as SavedBatch,
    updatedAt: row.updated_at,
  };
}

export async function saveListingWorkBatch(batch: SavedBatch) {
  const updatedAt = new Date().toISOString();
  await database()
    .prepare(`INSERT INTO listing_work_batches (date, payload, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(date) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
    .bind(batch.date, JSON.stringify(batch), updatedAt)
    .run();
  return updatedAt;
}

export async function deleteListingWorkBatch(date: string) {
  await database()
    .prepare('DELETE FROM listing_work_batches WHERE date = ?1')
    .bind(date)
    .run();
}
