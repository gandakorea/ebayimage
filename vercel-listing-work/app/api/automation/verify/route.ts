import { NextRequest, NextResponse } from 'next/server';
import { publishUs } from '@/lib/ebay';
import { validateListingPackage } from '@/lib/automation-types';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  const secret = process.env.AUTOMATION_ADMIN_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const pkg = await request.json();
    validateListingPackage(pkg);
    const result = await publishUs(pkg, pkg.usdPrice, pkg.shippingPolicy, true);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Verification failed' }, { status: 422 });
  }
}
