import { NextRequest, NextResponse } from 'next/server';
import { refreshToken, verifyIdentity } from '@/lib/ebay';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Read-only Trading calls keep seller credentials on the server.
export async function POST(request: NextRequest) {
  const secret = process.env.AUTOMATION_ADMIN_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const input = await request.json() as { itemId?: string; action?: string; page?: number; marketplace?: string; sku?: string };
  if (!['store', 'active', 'inventory'].includes(input.action ?? '') && !/^\d{9,15}$/.test(input.itemId ?? '')) {
    return NextResponse.json({ ok: false, error: 'Invalid item ID' }, { status: 400 });
  }
  try {
    const marketplace = input.marketplace === 'AU' ? 'AU' : 'US';
    const token = await refreshToken(marketplace);
    await verifyIdentity(token, marketplace);
    if (input.action === 'inventory') {
      if (marketplace !== 'AU' || !/^[A-Z0-9-]{5,70}$/i.test(input.sku ?? '')) return NextResponse.json({ ok: false }, { status: 400 });
      const sku = encodeURIComponent(input.sku!);
      const headers = { authorization: `Bearer ${token}`, 'x-ebay-c-marketplace-id': 'EBAY_AU', 'accept-language': 'en-AU' };
      const [inventory, compatibility, offers] = await Promise.all([
        `/inventory_item/${sku}`, `/inventory_item/${sku}/product_compatibility`, `/offer?sku=${sku}`,
      ].map(async (path) => {
        const result = await fetch(`https://api.ebay.com/sell/inventory/v1${path}`, { headers, cache: 'no-store' });
        return { status: result.status, data: await result.json() };
      }));
      return NextResponse.json({ ok: true, seller: 'sihooshop', inventory, compatibility, offers });
    }
    const call = input.action === 'active' ? 'GetMyeBaySelling' : input.action === 'store' ? 'GetStore' : 'GetItem';
    const fields = call === 'GetStore' ? '<CategoryStructureOnly>true</CategoryStructureOnly>'
      : call === 'GetMyeBaySelling' ? `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${Number.isInteger(input.page) && Number(input.page) > 0 ? input.page : 1}</PageNumber></Pagination></ActiveList>`
      : `<ItemID>${input.itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>`;
    const response = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST', headers: { 'content-type': 'text/xml; charset=utf-8',
        'x-ebay-api-call-name': call, 'x-ebay-api-siteid': marketplace === 'AU' ? '15' : '0',
        'x-ebay-api-compatibility-level': '1193', 'x-ebay-api-iaf-token': token },
      body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${fields}</${call}Request>`,
    });
    const body = await response.text();
    if (!response.ok || /<Ack>(Failure|PartialFailure)<\/Ack>/.test(body)) {
      return NextResponse.json({ ok: false, error: `${call} failed` }, { status: 422 });
    }
    return new NextResponse(body, { headers: { 'content-type': 'application/xml', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'Reference lookup failed' }, { status: 422 });
  }
}
