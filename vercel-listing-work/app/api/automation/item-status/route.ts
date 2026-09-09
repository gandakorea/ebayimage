import { NextRequest, NextResponse } from 'next/server';
import type { PreparationStatus, SavedBatch } from '@/lib/listing-work-store';
import { readWorkBatch, saveWorkBatch } from '@/lib/work-batch-store';

export const runtime = 'nodejs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WORKER_STATUSES: PreparationStatus[] = ['working', 'completed', 'needs_attention'];

type StatusRequest = {
  date?: unknown;
  itemId?: unknown;
  status?: unknown;
  partNumber?: unknown;
  photoCount?: unknown;
};

export async function POST(request: NextRequest) {
  const secret = process.env.AUTOMATION_STATUS_SECRET ?? process.env.AUTOMATION_WORKER_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as StatusRequest;
  if (typeof body.date !== 'string' || !DATE_PATTERN.test(body.date)
    || typeof body.itemId !== 'string'
    || typeof body.status !== 'string'
    || !WORKER_STATUSES.includes(body.status as PreparationStatus)
    || (body.partNumber !== undefined && typeof body.partNumber !== 'string')
    || (body.photoCount !== undefined && (!Number.isInteger(body.photoCount) || Number(body.photoCount) < 0))) {
    return NextResponse.json({ ok: false, error: '작업 상태 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const storedBatch = await readWorkBatch(body.date);
  if (!storedBatch) {
    return NextResponse.json({ ok: false, error: '작업표를 찾지 못했습니다.' }, { status: 404 });
  }

  let found = false;
  const statusUpdatedAt = new Date().toISOString();
  const groups = storedBatch.groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      if (item.id !== body.itemId) return item;
      found = true;
      return {
        ...item,
        preparationStatus: body.status as PreparationStatus,
        partNumber: typeof body.partNumber === 'string' ? body.partNumber : item.partNumber,
        photoCount: typeof body.photoCount === 'number' ? body.photoCount : item.photoCount,
        statusUpdatedAt,
      };
    }),
  }));
  if (!found) return NextResponse.json({ ok: false, error: '상품을 찾지 못했습니다.' }, { status: 404 });

  const activeItems = groups.flatMap((group) => group.items).filter((item) => item.itemNumber.trim());
  const automationStatus = activeItems.every((item) => item.preparationStatus === 'completed')
    ? 'completed'
    : activeItems.some((item) => item.preparationStatus === 'needs_attention')
      ? 'needs_attention'
      : activeItems.some((item) => item.preparationStatus === 'working')
        ? 'running'
        : storedBatch.automationStatus;
  const batch: SavedBatch = { ...storedBatch, groups, automationStatus };
  await saveWorkBatch(batch);

  return NextResponse.json({ ok: true, date: body.date, itemId: body.itemId, status: body.status, statusUpdatedAt });
}
