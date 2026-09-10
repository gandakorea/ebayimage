import { get } from '@vercel/blob';
import type { ListingPackage, CompatibilityRow } from './automation-types';
import type { ShippingPolicy } from './listing-work-store';

type Marketplace = 'US' | 'AU';

const apiBase = 'https://api.ebay.com';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 설정이 없습니다.`);
  return value;
}

function xml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function xmlList(values: Record<string, string[]>) {
  return Object.entries(values).flatMap(([name, rows]) => rows.map((value) =>
    `<NameValueList><Name>${xml(name)}</Name><Value>${xml(value)}</Value></NameValueList>`)).join('');
}

function compatibilityXml(rows: CompatibilityRow[]) {
  return rows.map((row) => `<Compatibility>${Object.entries(row).map(([name, value]) =>
    `<NameValueList><Name>${xml(name)}</Name><Value>${xml(value)}</Value></NameValueList>`).join('')}<CompatibilityNotes></CompatibilityNotes></Compatibility>`).join('');
}

export async function refreshToken(marketplace: Marketplace) {
  const prefix = marketplace === 'US' ? 'EBAY_US' : 'EBAY_AU';
  const clientId = required(`${prefix}_CLIENT_ID`);
  const clientSecret = required(`${prefix}_CLIENT_SECRET`);
  const refresh = required(`${prefix}_REFRESH_TOKEN`);
  const scope = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.stores',
    'https://api.ebay.com/oauth/api_scope/sell.listing',
  ].join(' ');
  const response = await fetch(`${apiBase}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, scope }),
  });
  const body = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(`${marketplace} 토큰 갱신 실패: ${body.error_description ?? response.status}`);
  return body.access_token;
}

export async function verifyIdentity(token: string, marketplace: Marketplace) {
  const response = await fetch('https://apiz.ebay.com/commerce/identity/v1/user/', {
    headers: { authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  const body = await response.json() as { username?: string; registrationMarketplaceId?: string };
  const expectedUser = marketplace === 'US' ? 'gandakorea' : 'sihooshop';
  const expectedMarket = marketplace === 'US' ? 'EBAY_US' : 'EBAY_AU';
  if (!response.ok || body.username !== expectedUser || body.registrationMarketplaceId !== expectedMarket) {
    throw new Error(`${marketplace} 계정 불일치: ${body.username ?? 'unknown'} / ${body.registrationMarketplaceId ?? 'unknown'}`);
  }
  return body;
}

async function uploadImages(token: string, item: ListingPackage) {
  const urls: string[] = [];
  for (const image of item.images) {
    const stored = await get(image.pathname, { access: 'private' });
    if (!stored || stored.statusCode !== 200 || !stored.stream) throw new Error(`사진 읽기 실패: ${image.filename}`);
    const bytes = await new Response(stored.stream).arrayBuffer();
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: 'image/png' }), image.filename);
    const response = await fetch('https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, body: form,
    });
    const body = await response.json() as { maxDimensionImageUrl?: string; imageUrl?: string };
    const url = body.maxDimensionImageUrl ?? body.imageUrl;
    if (!response.ok || !url) throw new Error(`eBay 사진 업로드 실패: ${image.filename}`);
    urls.push(url);
  }
  return urls;
}

async function tradingCall(token: string, call: string, siteId: string, body: string) {
  const response = await fetch(`${apiBase}/ws/api.dll`, {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      'x-ebay-api-call-name': call,
      'x-ebay-api-siteid': siteId,
      'x-ebay-api-compatibility-level': '1193',
      'x-ebay-api-iaf-token': token,
    },
    body,
  });
  const text = await response.text();
  if (!response.ok || /<Ack>(Failure|PartialFailure)<\/Ack>/.test(text)) {
    const message = [...text.matchAll(/<LongMessage>([\s\S]*?)<\/LongMessage>/g)].map((match) => match[1]).join(' | ');
    throw new Error(`${call} 실패: ${message || response.status}`);
  }
  return text;
}

export async function publishUs(item: ListingPackage, price: string, shipping: ShippingPolicy, dryRun = false) {
  const token = await refreshToken('US');
  await verifyIdentity(token, 'US');
  const imageUrls = await uploadImages(token, item);
  const sku = `${item.partNumber}-US-${item.date.replaceAll('-', '')}-${item.itemId.slice(0, 8)}`;
  const store = item.us.storeCategoryIds.slice(0, 2);
  const request = `<?xml version="1.0" encoding="utf-8"?><${dryRun ? 'VerifyAddFixedPriceItem' : 'AddFixedPriceItem'}Request xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${xml(token)}</eBayAuthToken></RequesterCredentials><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel><Item><SKU>${xml(sku)}</SKU><Title>${xml(item.title)}</Title><Description><![CDATA[${item.descriptionHtml}]]></Description><PrimaryCategory><CategoryID>${xml(item.us.categoryId)}</CategoryID></PrimaryCategory><StartPrice currencyID="USD">${xml(price)}</StartPrice><CategoryMappingAllowed>true</CategoryMappingAllowed><ConditionID>1000</ConditionID><Country>KR</Country><Currency>USD</Currency><DispatchTimeMax>3</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType><Quantity>5</Quantity><PostalCode>${xml(process.env.EBAY_SHIP_POSTAL_CODE ?? '16975')}</PostalCode><PictureDetails>${imageUrls.map((url) => `<PictureURL>${xml(url)}</PictureURL>`).join('')}</PictureDetails><SellerProfiles><SellerPaymentProfile><PaymentProfileID>${xml(required('EBAY_US_PAYMENT_POLICY_ID'))}</PaymentProfileID></SellerPaymentProfile><SellerReturnProfile><ReturnProfileID>${xml(required('EBAY_US_RETURN_POLICY_ID'))}</ReturnProfileID></SellerReturnProfile><SellerShippingProfile><ShippingProfileID>${xml(shipping === '7day fast' ? required('EBAY_US_FAST_POLICY_ID') : required('EBAY_US_NORMAL_POLICY_ID'))}</ShippingProfileID></SellerShippingProfile></SellerProfiles><ItemSpecifics>${xmlList(item.us.itemSpecifics)}</ItemSpecifics>${item.us.compatibility.length ? `<ItemCompatibilityList>${compatibilityXml(item.us.compatibility)}</ItemCompatibilityList>` : ''}${store.length ? `<Storefront>${store.map((id, index) => `<${index ? 'StoreCategory2ID' : 'StoreCategoryID'}>${xml(id)}</${index ? 'StoreCategory2ID' : 'StoreCategoryID'}>`).join('')}</Storefront>` : ''}</Item></${dryRun ? 'VerifyAddFixedPriceItem' : 'AddFixedPriceItem'}Request>`;
  const response = await tradingCall(token, dryRun ? 'VerifyAddFixedPriceItem' : 'AddFixedPriceItem', '0', request);
  if (dryRun) return { listingId: 'DRY-RUN', listingUrl: '' };
  const listingId = response.match(/<ItemID>(\d+)<\/ItemID>/)?.[1];
  if (!listingId) throw new Error('미국 등록 후 ItemID를 확인하지 못했습니다.');
  return { listingId, listingUrl: `https://www.ebay.com/itm/${listingId}` };
}

async function ebayJson(token: string, marketplaceId: string, url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'content-language': marketplaceId === 'EBAY_AU' ? 'en-AU' : 'en-US',
      'x-ebay-c-marketplace-id': marketplaceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) throw new Error(`eBay ${method} 실패 (${response.status}): ${text.slice(0, 600)}`);
  return value;
}

async function audPrice(usd: string) {
  const manual = process.env.USD_AUD_RATE;
  let rate = manual ? Number(manual) : NaN;
  if (!Number.isFinite(rate)) {
    const response = await fetch('https://api.frankfurter.app/latest?from=USD&to=AUD', { cache: 'no-store' });
    const body = await response.json() as { rates?: { AUD?: number } };
    rate = Number(body.rates?.AUD);
  }
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('USD→AUD 환율을 확인하지 못했습니다.');
  return { value: (Number(usd) * rate).toFixed(2), rate };
}

export async function publishAu(item: ListingPackage, usd: string, shipping: ShippingPolicy, dryRun = false) {
  const token = await refreshToken('AU');
  await verifyIdentity(token, 'AU');
  const imageUrls = await uploadImages(token, item);
  const converted = await audPrice(usd);
  const sku = `${item.partNumber}-AU-${item.date.replaceAll('-', '')}-${item.itemId.slice(0, 8)}`;
  const inventoryUrl = `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
  const aspects = { ...item.au.itemSpecifics, Brand: ['Genuine Hyundai Mobis'], 'Manufacturer Part Number': [item.partNumber], 'Country of Origin': ['Korea, Republic of'] };
  const inventory = { availability: { shipToLocationAvailability: { quantity: 5 } }, condition: 'NEW', product: { title: item.title, brand: 'Genuine Hyundai Mobis', mpn: item.partNumber, imageUrls, aspects } };
  const compatibility = { compatibleProducts: item.au.compatibility.map((row) => ({ compatibilityProperties: Object.entries(row).map(([name, value]) => ({ name, value })) })) };
  if (dryRun) return { listingId: 'DRY-RUN', listingUrl: '', audPrice: converted.value, exchangeRate: converted.rate };
  await ebayJson(token, 'EBAY_AU', inventoryUrl, 'PUT', inventory);
  if (item.au.compatibility.length) await ebayJson(token, 'EBAY_AU', `${inventoryUrl}/product_compatibility`, 'PUT', compatibility);
  const offer = {
    sku, marketplaceId: 'EBAY_AU', format: 'FIXED_PRICE', availableQuantity: 5,
    categoryId: item.au.categoryId, merchantLocationKey: required('EBAY_AU_MERCHANT_LOCATION_KEY'),
    listingDescription: item.descriptionHtml,
    listingPolicies: {
      paymentPolicyId: required('EBAY_AU_PAYMENT_POLICY_ID'), returnPolicyId: required('EBAY_AU_RETURN_POLICY_ID'),
      fulfillmentPolicyId: shipping === '7day fast' ? required('EBAY_AU_FAST_POLICY_ID') : required('EBAY_AU_NORMAL_POLICY_ID'),
    },
    pricingSummary: { price: { value: converted.value, currency: 'AUD' } },
    storeCategoryNames: item.au.storeCategoryNames.slice(0, 2), listingDuration: 'GTC', includeCatalogProductDetails: true,
  };
  const created = await ebayJson(token, 'EBAY_AU', `${apiBase}/sell/inventory/v1/offer`, 'POST', offer);
  const offerId = String(created.offerId ?? '');
  if (!offerId) throw new Error('호주 offerId를 확인하지 못했습니다.');
  const published = await ebayJson(token, 'EBAY_AU', `${apiBase}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, 'POST', {});
  const listingId = String(published.listingId ?? '');
  if (!listingId) throw new Error('호주 등록 후 listingId를 확인하지 못했습니다.');
  return { listingId, listingUrl: `https://www.ebay.com.au/itm/${listingId}`, audPrice: converted.value, exchangeRate: converted.rate };
}
