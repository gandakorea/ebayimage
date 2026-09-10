import { del, get, list, put } from '@vercel/blob';
import type { SavedBatch } from './listing-work-store';

const legacyStorageUrl = 'https://korea-autoparts-image-studio.kongee7425.chatgpt.site/api/listing-work';
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function path(date: string) {
  if (!datePattern.test(date)) throw new Error('날짜가 올바르지 않습니다.');
  return `work-batches/${date}.json`;
}

function validate(value: unknown): asserts value is SavedBatch {
  if (!value || typeof value !== 'object') throw new Error('작업표가 비어 있습니다.');
  const batch = value as Partial<SavedBatch>;
  if (!batch.date || !datePattern.test(batch.date) || !Array.isArray(batch.groups)
    || typeof batch.batchMemo !== 'string' || typeof batch.automationEnabled !== 'boolean'
    || !['automatic', 'approval'].includes(batch.publishMode ?? '')) throw new Error('작업표 형식이 올바르지 않습니다.');
}

export async function saveWorkBatch(batch: SavedBatch) {
  validate(batch);
  await put(path(batch.date), JSON.stringify(batch), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  return batch;
}

export async function readWorkBatch(date: string, migrateLegacy = true) {
  const pathname = path(date);
  const found = await list({ prefix: pathname, limit: 1 });
  const blob = found.blobs.find((candidate) => candidate.pathname === pathname);
  if (blob) {
    const response = await get(pathname, { access: 'private' });
    if (!response || response.statusCode !== 200 || !response.stream) throw new Error('작업표를 읽지 못했습니다.');
    const batch = JSON.parse(await new Response(response.stream).text()) as unknown;
    validate(batch);
    return batch;
  }
  if (!migrateLegacy) return null;
  const legacy = await fetch(`${legacyStorageUrl}?date=${date}`, { cache: 'no-store' });
  if (!legacy.ok) return null;
  const result = await legacy.json() as { found?: boolean; batch?: unknown };
  if (!result.found || !result.batch) return null;
  validate(result.batch);
  await saveWorkBatch(result.batch);
  return result.batch;
}

export async function deleteWorkBatch(date: string) {
  const pathname = path(date);
  const found = await list({ prefix: pathname, limit: 1 });
  const blob = found.blobs.find((candidate) => candidate.pathname === pathname);
  if (blob) await del(blob.url);
}
