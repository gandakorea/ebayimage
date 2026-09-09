import { NextRequest, NextResponse } from 'next/server';
import { refreshToken, verifyIdentity } from '@/lib/ebay';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const secret = process.env.AUTOMATION_ADMIN_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const us = await verifyIdentity(await refreshToken('US'), 'US');
    const au = await verifyIdentity(await refreshToken('AU'), 'AU');
    return NextResponse.json({
      ok: true,
      us: { username: us.username, marketplace: us.registrationMarketplaceId },
      au: { username: au.username, marketplace: au.registrationMarketplaceId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '계정 확인 실패';
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
