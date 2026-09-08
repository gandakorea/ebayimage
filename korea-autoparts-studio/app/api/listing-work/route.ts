import { NextRequest, NextResponse } from 'next/server';
import {
  deleteListingWorkBatch,
  getListingWorkBatch,
  saveListingWorkBatch,
  type SavedBatch,
} from '@/lib/listing-work-store';

export const runtime = 'edge';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validBatch(value: unknown): value is SavedBatch {
  if (!value || typeof value !== 'object') return false;
  const batch = value as Partial<SavedBatch>;
  if (typeof batch.date !== 'string' || !DATE_PATTERN.test(batch.date)) return false;
  if (typeof batch.batchMemo !== 'string' || !Array.isArray(batch.groups)) return false;
  return batch.groups.every((group) => group
    && [1, 2, 3].includes(Number(group.agent))
    && Array.isArray(group.items)
    && group.items.every((item) => item
      && typeof item.id === 'string'
      && typeof item.itemNumber === 'string'
      && typeof item.price === 'string'
      && (item.shippingPolicy === '7day normal' || item.shippingPolicy === '7day fast')
      && typeof item.memo === 'string'));
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date') ?? '';
  if (!DATE_PATTERN.test(date)) {
    return NextResponse.json({ error: '날짜는 YYYY-MM-DD 형식이어야 합니다.' }, { status: 400 });
  }
  const saved = await getListingWorkBatch(date);
  if (!saved) return NextResponse.json({ found: false, date });
  return NextResponse.json({ found: true, ...saved });
}

export async function PUT(request: NextRequest) {
  const batch: unknown = await request.json();
  if (!validBatch(batch)) {
    return NextResponse.json({ error: '작업표 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const updatedAt = await saveListingWorkBatch(batch);
  return NextResponse.json({
    saved: true,
    date: batch.date,
    itemCount: batch.groups.reduce(
      (total, group) => total + group.items.filter((item) => item.itemNumber.trim()).length,
      0,
    ),
    updatedAt,
  });
}

export async function DELETE(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date') ?? '';
  if (!DATE_PATTERN.test(date)) {
    return NextResponse.json({ error: '날짜는 YYYY-MM-DD 형식이어야 합니다.' }, { status: 400 });
  }
  await deleteListingWorkBatch(date);
  return NextResponse.json({ deleted: true, date });
}
