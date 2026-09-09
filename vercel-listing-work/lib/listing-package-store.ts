import { get, list, put } from '@vercel/blob';
import type { ListingPackage } from './automation-types';
import { validateListingPackage } from './automation-types';

export function packagePath(date: string, itemId: string) {
  return `listing-packages/${date}/${itemId}/manifest.json`;
}

export async function saveListingPackage(value: ListingPackage) {
  validateListingPackage(value);
  return put(packagePath(value.date, value.itemId), JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export async function loadListingPackage(date: string, itemId: string) {
  const result = await list({ prefix: packagePath(date, itemId), limit: 1 });
  const blob = result.blobs.find((candidate) => candidate.pathname === packagePath(date, itemId));
  if (!blob) throw new Error('검수 완료된 등록 패키지를 찾지 못했습니다.');
  const response = await get(blob.url, { access: 'private' });
  if (!response || response.statusCode !== 200 || !response.stream) throw new Error('등록 패키지를 읽지 못했습니다.');
  const value = JSON.parse(await new Response(response.stream).text()) as unknown;
  validateListingPackage(value);
  return value;
}
