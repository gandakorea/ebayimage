import { NextRequest, NextResponse } from 'next/server';
import type { SavedBatch } from '@/lib/listing-work-store';
import { deleteWorkBatch, readWorkBatch, saveWorkBatch } from '@/lib/work-batch-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') ?? '';
    const batch = await readWorkBatch(date);
    return NextResponse.json(batch ? { found: true, batch } : { found: false });
  } catch (error) {
    console.error('listing-work GET failed:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ found: false, error: error instanceof Error ? error.message : '작업표 조회 실패' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const batch = await request.json() as SavedBatch;
    await saveWorkBatch(batch);
    const itemCount = batch.groups.flatMap((group) => group.items).filter((item) => item.itemNumber.trim()).length;
    return NextResponse.json({ saved: true, itemCount, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('listing-work PUT failed:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ saved: false, error: error instanceof Error ? error.message : '작업표 저장 실패' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') ?? '';
    await deleteWorkBatch(date);
    return NextResponse.json({ deleted: true, date });
  } catch (error) {
    return NextResponse.json({ deleted: false, error: error instanceof Error ? error.message : '작업표 삭제 실패' }, { status: 400 });
  }
}
