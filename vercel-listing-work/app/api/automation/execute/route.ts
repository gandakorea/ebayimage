import { NextRequest, NextResponse } from 'next/server';
import { runAutomation } from '@/lib/run-automation';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.AUTOMATION_WORKER_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const input = await request.json() as { date?: string; dryRun?: boolean };
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return NextResponse.json({ ok: false, error: '날짜가 올바르지 않습니다.' }, { status: 400 });
  }
  const result = await runAutomation(input.date, Boolean(input.dryRun));
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
