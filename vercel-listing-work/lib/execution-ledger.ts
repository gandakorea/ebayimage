import { get, list, put } from '@vercel/blob';
import type { MarketplaceResult } from './listing-work-store';

export type ExecutionLedger = {
  date: string;
  itemId: string;
  referenceItemNumber: string;
  partNumber: string;
  us?: MarketplaceResult;
  au?: MarketplaceResult;
  updatedAt: string;
};

function pathname(date: string, itemId: string) {
  return `execution-ledgers/${date}/${itemId}.json`;
}

export async function readExecutionLedger(date: string, itemId: string) {
  const path = pathname(date, itemId);
  const found = await list({ prefix: path, limit: 1 });
  const blob = found.blobs.find((candidate) => candidate.pathname === path);
  if (!blob) return null;
  const response = await get(blob.pathname, { access: 'private' });
  if (!response || response.statusCode !== 200 || !response.stream) throw new Error('비공개 실행 기록을 읽지 못했습니다.');
  return JSON.parse(await new Response(response.stream).text()) as ExecutionLedger;
}

export async function saveExecutionLedger(ledger: ExecutionLedger) {
  await put(pathname(ledger.date, ledger.itemId), JSON.stringify(ledger), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}
