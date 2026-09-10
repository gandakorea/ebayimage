import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import type { ListingPackage } from '@/lib/automation-types';
import { validateListingPackage } from '@/lib/automation-types';
import { saveListingPackage } from '@/lib/listing-package-store';
import { readWorkBatch, saveWorkBatch } from '@/lib/work-batch-store';

export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.AUTOMATION_ADMIN_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function pngSize(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function verifyImages(pkg: ListingPackage) {
  for (let index = 0; index < pkg.images.length; index += 1) {
    const image = pkg.images[index];
    const expected = index === 0 ? `${pkg.partNumber}.png` : `${pkg.partNumber}_${index}.png`;
    if (image.filename !== expected) throw new Error(`사진 순서/파일명 불일치: ${image.filename} (예상 ${expected})`);
    const stored = await get(image.pathname, { access: 'private' });
    if (!stored || stored.statusCode !== 200 || !stored.stream) throw new Error(`비공개 사진을 읽지 못했습니다: ${image.filename}`);
    const bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer());
    const dimensions = pngSize(bytes);
    if (!dimensions || dimensions.width !== 1000 || dimensions.height !== 1000) throw new Error(`${image.filename}: 1000 x 1000 PNG가 아닙니다.`);
  }
}

async function markReady(pkg: ListingPackage) {
  const batch = await readWorkBatch(pkg.date);
  if (!batch) throw new Error('작업표를 찾지 못했습니다.');
  let found = false;
  const now = new Date().toISOString();
  const groups = batch.groups.map((group) => ({ ...group, items: group.items.map((item) => {
    if (item.id !== pkg.itemId) return item;
    found = true;
    if (item.itemNumber.trim() !== pkg.referenceItemNumber.trim()) throw new Error('참고 아이템 번호가 작업표와 다릅니다.');
    if (item.price.trim().replace(/^\$/, '') !== pkg.usdPrice || item.shippingPolicy !== pkg.shippingPolicy) throw new Error('가격 또는 배송 정책이 검수 패키지와 다릅니다.');
    return { ...item, preparationStatus: 'ready' as const, partNumber: pkg.partNumber, photoCount: pkg.images.length, statusUpdatedAt: now, usResult: { status: 'pending' as const }, auResult: { status: 'pending' as const } };
  }) }));
  if (!found) throw new Error('작업표에서 해당 상품 칸을 찾지 못했습니다.');
  await saveWorkBatch({ ...batch, groups, automationStatus: 'waiting' });
}

export async function PUT(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const pkg = await request.json() as ListingPackage;
    validateListingPackage(pkg);
    await verifyImages(pkg);
    await saveListingPackage(pkg);
    await markReady(pkg);
    return NextResponse.json({ ok: true, date: pkg.date, itemId: pkg.itemId, partNumber: pkg.partNumber, photoCount: pkg.images.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : '등록 패키지 저장 실패' }, { status: 400 });
  }
}
