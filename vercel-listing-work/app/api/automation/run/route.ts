import { NextRequest, NextResponse } from 'next/server';
import type { SavedBatch } from '@/lib/listing-work-store';

export const runtime = 'nodejs';
export const maxDuration = 60;

const storageUrl = 'https://korea-autoparts-image-studio.kongee7425.chatgpt.site/api/listing-work';

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

async function saveBatch(batch: SavedBatch) {
  const response = await fetch(storageUrl, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch),
  });
  if (!response.ok) throw new Error('작업 상태 저장 실패');
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = koreaClock();
  const stored = await fetch(`${storageUrl}?date=${now.date}`, { cache: 'no-store' });
  if (!stored.ok) return NextResponse.json({ ok: false, error: '작업표 조회 실패' }, { status: 502 });
  const result = await stored.json() as { found: boolean; batch?: SavedBatch };
  if (!result.found || !result.batch) return NextResponse.json({ ok: true, state: 'no_batch', ...now });

  const batch = result.batch;
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

  const workerUrl = process.env.AUTOMATION_WORKER_URL;
  const workerSecret = process.env.AUTOMATION_WORKER_SECRET;
  if (!workerUrl || !workerSecret) {
    await saveBatch({ ...batch, automationStatus: 'needs_attention' });
    await notify(`[KOREA AUTOPARTS] ${now.date} 자동 작업 준비가 필요합니다. Vercel 작업 서버 연결값을 확인해 주세요.`);
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
  await saveBatch({ ...batch, groups: queuedGroups, automationStatus: 'queued' });
  const dispatched = await fetch(workerUrl, {
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
    await saveBatch({ ...batch, groups: failedGroups, automationStatus: 'needs_attention' });
    await notify(`[KOREA AUTOPARTS] ${now.date} 자동 작업을 시작하지 못했습니다. 작업 서버를 확인해 주세요.`);
    return NextResponse.json({ ok: false, state: 'dispatch_failed', status: dispatched.status, ...now }, { status: 502 });
  }

  await notify(`[KOREA AUTOPARTS] ${now.date} ${items.length}개 상품 자동 작업을 시작했습니다. 미국 작업 후 호주 작업 순서입니다.`);
  return NextResponse.json({ ok: true, state: 'dispatched', itemCount: items.length, ...now });
}
