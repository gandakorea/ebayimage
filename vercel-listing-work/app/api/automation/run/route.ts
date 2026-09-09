import { NextRequest, NextResponse } from 'next/server';
import type { SavedBatch } from '@/lib/listing-work-store';
import { readWorkBatch, saveWorkBatch } from '@/lib/work-batch-store';

export const runtime = 'nodejs';
export const maxDuration = 300;

function koreaClock() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}` };
}

async function notify(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return false;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
  return response.ok;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = koreaClock();
  const batch = await readWorkBatch(now.date);
  if (!batch) return NextResponse.json({ ok: true, state: 'no_batch', ...now });
  if (!batch.automationEnabled) return NextResponse.json({ ok: true, state: 'disabled', ...now });
  if (now.time < '17:00') {
    return NextResponse.json({ ok: true, state: 'waiting', scheduledTime: '17:00', ...now });
  }
  if (batch.automationStatus === 'queued' || batch.automationStatus === 'running'
    || batch.automationStatus === 'needs_attention' || batch.automationStatus === 'completed') {
    return NextResponse.json({ ok: true, state: batch.automationStatus, ...now });
  }

  const items = batch.groups.flatMap((group) => group.items
    .filter((item) => item.itemNumber.trim() && item.preparationStatus === 'ready')
    .map((item) => ({ ...item, agent: group.agent })));
  if (!items.length) return NextResponse.json({ ok: true, state: 'no_ready_items', ...now });

  if (batch.publishMode !== 'automatic') {
    await saveWorkBatch({ ...batch, automationStatus: 'needs_attention' });
    await notify(`[KOREA AUTOPARTS] ${now.date} 등록 패키지가 준비됐습니다. 작업표에서 최종 등록 방식을 자동 등록으로 바꾸면 다음 실행에서 시작합니다.`);
    return NextResponse.json({ ok: true, state: 'awaiting_approval', itemCount: items.length, ...now });
  }

  const workerSecret = process.env.AUTOMATION_WORKER_SECRET;
  if (!workerSecret || !process.env.BLOB_READ_WRITE_TOKEN) {
    await saveWorkBatch({ ...batch, automationStatus: 'needs_attention' });
    await notify(`[KOREA AUTOPARTS] ${now.date} 자동 작업 준비가 필요합니다. 비공개 사진 저장소와 작업 비밀키를 확인해 주세요.`);
    return NextResponse.json({ ok: false, state: 'waiting_configuration', itemCount: items.length, ...now }, { status: 503 });
  }

  const queuedAt = new Date().toISOString();
  const queuedIds = new Set(items.map((item) => item.id));
  const queuedGroups = batch.groups.map((group) => ({
    ...group,
    items: group.items.map((item) => queuedIds.has(item.id)
      ? { ...item, preparationStatus: 'working' as const, statusUpdatedAt: queuedAt }
      : item),
  }));
  await saveWorkBatch({ ...batch, groups: queuedGroups, automationStatus: 'queued' });
  const dispatched = await fetch(new URL('/api/automation/execute', request.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${workerSecret}` },
    body: JSON.stringify({
      date: batch.date,
      scheduledTime: '17:00',
      publishMode: batch.publishMode,
      batchMemo: batch.batchMemo,
      marketplaceOrder: ['EBAY_US', 'EBAY_AU'],
      items,
    }),
  });
  if (!dispatched.ok) {
    const failedAt = new Date().toISOString();
    const failedGroups = batch.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => queuedIds.has(item.id)
        ? { ...item, preparationStatus: 'needs_attention' as const, statusUpdatedAt: failedAt }
        : item),
    }));
    await saveWorkBatch({ ...batch, groups: failedGroups, automationStatus: 'needs_attention' });
    await notify(`[KOREA AUTOPARTS] ${now.date} 자동 작업을 시작하지 못했습니다. 작업 서버를 확인해 주세요.`);
    return NextResponse.json({ ok: false, state: 'dispatch_failed', status: dispatched.status, ...now }, { status: 502 });
  }

  await notify(`[KOREA AUTOPARTS] ${now.date} ${items.length}개 상품 자동 작업을 시작했습니다. 미국 작업 후 호주 작업 순서입니다.`);
  return NextResponse.json({ ok: true, state: 'dispatched', itemCount: items.length, ...now });
}
