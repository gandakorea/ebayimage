import { get } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { getAuCompatibility, publishAu, type AuCompatibilityTarget } from '@/lib/ebay';
import type { ListingPackage } from '@/lib/automation-types';
import { validateListingPackage } from '@/lib/automation-types';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = process.env.AUTOMATION_ADMIN_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

async function verifyImages(pkg: ListingPackage) {
  for (let index = 0; index < pkg.images.length; index += 1) {
    const image = pkg.images[index];
    const expected = index === 0 ? `${pkg.partNumber}.png` : `${pkg.partNumber}_${index}.png`;
    if (image.filename !== expected) throw new Error(`사진 순서/파일명 불일치: ${image.filename}`);
    const stored = await get(image.pathname, { access: 'private' });
    if (!stored || stored.statusCode !== 200 || !stored.stream) throw new Error(`비공개 사진을 읽지 못했습니다: ${image.filename}`);
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const input = await request.json() as {
      action?: 'compatibility' | 'publish';
      categoryId?: string;
      targets?: AuCompatibilityTarget[];
      package?: ListingPackage;
    };
    if (input.action === 'compatibility') {
      if (!input.categoryId || !Array.isArray(input.targets) || !input.targets.length) throw new Error('호주 호환표 조건이 없습니다.');
      const result = await getAuCompatibility(input.categoryId, input.targets);
      return NextResponse.json({ ok: true, ...result });
    }
    if (input.action === 'publish') {
      validateListingPackage(input.package);
      await verifyImages(input.package);
      const result = await publishAu(input.package, input.package.usdPrice, input.package.shippingPolicy, false);
      return NextResponse.json({ ok: true, ...result });
    }
    throw new Error('지원하지 않는 작업입니다.');
  } catch (error) {
    const message = error instanceof Error ? error.message : '호주 작업 실패';
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
