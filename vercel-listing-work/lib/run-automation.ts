import type { SavedBatch, WorkItem } from './listing-work-store';
import { loadListingPackage } from './listing-package-store';
import { publishAu, publishUs } from './ebay';
import { readWorkBatch, saveWorkBatch } from './work-batch-store';
import { readExecutionLedger, saveExecutionLedger } from './execution-ledger';

async function notify(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
}

function updateItem(batch: SavedBatch, id: string, change: Partial<WorkItem>, automationStatus = batch.automationStatus) {
  return {
    ...batch, automationStatus,
    groups: batch.groups.map((group) => ({ ...group, items: group.items.map((item) => item.id === id ? { ...item, ...change } : item) })),
  } satisfies SavedBatch;
}

export async function runAutomation(date: string, dryRun = false) {
  const storedBatch = await readWorkBatch(date);
  if (!storedBatch) throw new Error('작업표를 찾지 못했습니다.');
  let batch: SavedBatch = { ...storedBatch, automationStatus: 'running' };
  await saveWorkBatch(batch);
  const items = batch.groups.flatMap((group) => group.items)
    .filter((item) => item.itemNumber.trim() && ['ready', 'working'].includes(item.preparationStatus ?? ''));
  const report: Array<Record<string, unknown>> = [];

  // Account separation is structural: every US item finishes before the first AU mutation starts.
  for (const item of items) {
    const existing = await readExecutionLedger(date, item.id);
    if (existing?.us?.status === 'completed') {
      batch = updateItem(batch, item.id, { usResult: existing.us });
      await saveWorkBatch(batch);
      continue;
    }
    const now = new Date().toISOString();
    batch = updateItem(batch, item.id, { preparationStatus: 'working', statusUpdatedAt: now, usResult: { status: 'working', checkedAt: now } }, 'running');
    await saveWorkBatch(batch);
    try {
      const pkg = await loadListingPackage(date, item.id);
      if (pkg.usdPrice !== item.price.replace(/^\$/, '') || pkg.shippingPolicy !== item.shippingPolicy) throw new Error('작업표의 가격 또는 배송 정책이 검수 패키지와 달라 등록을 중단했습니다.');
      const published = await publishUs(pkg, item.price.replace(/^\$/, ''), item.shippingPolicy, dryRun);
      const usResult = { status: 'completed' as const, ...published, checkedAt: new Date().toISOString() };
      await saveExecutionLedger({ date, itemId: item.id, referenceItemNumber: item.itemNumber, partNumber: pkg.partNumber, us: usResult, au: existing?.au, updatedAt: new Date().toISOString() });
      batch = updateItem(batch, item.id, { usResult });
      await saveWorkBatch(batch);
      report.push({ itemId: item.id, marketplace: 'EBAY_US', ...published });
    } catch (error) {
      const message = error instanceof Error ? error.message : '미국 등록 실패';
      batch = updateItem(batch, item.id, { preparationStatus: 'needs_attention', statusUpdatedAt: new Date().toISOString(), usResult: { status: 'needs_attention', error: message, checkedAt: new Date().toISOString() } }, 'needs_attention');
      await saveWorkBatch(batch);
      await notify(`[KOREA AUTOPARTS] ${item.partNumber ?? item.itemNumber} 미국 등록 확인 필요: ${message}`);
      return { ok: false as const, phase: 'EBAY_US', report, error: message };
    }
  }

  for (const item of items) {
    const existing = await readExecutionLedger(date, item.id);
    if (existing?.au?.status === 'completed') {
      batch = updateItem(batch, item.id, { preparationStatus: 'completed', auResult: existing.au });
      await saveWorkBatch(batch);
      continue;
    }
    const current = batch.groups.flatMap((group) => group.items).find((candidate) => candidate.id === item.id) ?? item;
    if (current.usResult?.status !== 'completed') {
      const message = '미국 등록 완료 전에는 호주 등록을 시작할 수 없습니다.';
      batch = updateItem(batch, item.id, { preparationStatus: 'needs_attention', statusUpdatedAt: new Date().toISOString() }, 'needs_attention');
      await saveWorkBatch(batch);
      return { ok: false as const, phase: 'EBAY_AU', report, error: message };
    }
    const now = new Date().toISOString();
    batch = updateItem(batch, item.id, { auResult: { status: 'working', checkedAt: now } }, 'running');
    await saveWorkBatch(batch);
    try {
      const pkg = await loadListingPackage(date, item.id);
      if (pkg.usdPrice !== item.price.replace(/^\$/, '') || pkg.shippingPolicy !== item.shippingPolicy) throw new Error('작업표의 가격 또는 배송 정책이 검수 패키지와 달라 등록을 중단했습니다.');
      const published = await publishAu(pkg, item.price.replace(/^\$/, ''), item.shippingPolicy, dryRun);
      const auResult = { status: 'completed' as const, ...published, checkedAt: new Date().toISOString() };
      await saveExecutionLedger({ date, itemId: item.id, referenceItemNumber: item.itemNumber, partNumber: pkg.partNumber, us: existing?.us ?? current.usResult, au: auResult, updatedAt: new Date().toISOString() });
      batch = updateItem(batch, item.id, { preparationStatus: 'completed', statusUpdatedAt: new Date().toISOString(), auResult });
      await saveWorkBatch(batch);
      report.push({ itemId: item.id, marketplace: 'EBAY_AU', ...published });
    } catch (error) {
      const message = error instanceof Error ? error.message : '호주 등록 실패';
      batch = updateItem(batch, item.id, { preparationStatus: 'needs_attention', statusUpdatedAt: new Date().toISOString(), auResult: { status: 'needs_attention', error: message, checkedAt: new Date().toISOString() } }, 'needs_attention');
      await saveWorkBatch(batch);
      await notify(`[KOREA AUTOPARTS] ${item.partNumber ?? item.itemNumber} 호주 등록 확인 필요: ${message}`);
      return { ok: false as const, phase: 'EBAY_AU', report, error: message };
    }
  }

  batch = { ...batch, automationStatus: 'completed' };
  await saveWorkBatch(batch);
  await notify(`[KOREA AUTOPARTS] ${date} 자동 등록 완료. 미국 ${items.length}개 후 호주 ${items.length}개를 검수했습니다.`);
  return { ok: true as const, state: dryRun ? 'dry_run_completed' : 'completed', report };
}
