export type CompatibilityRow = Record<string, string>;

export type BlobImage = {
  pathname: string;
  url: string;
  filename: string;
  size: number;
};

export type ListingPackage = {
  version: 1;
  date: string;
  itemId: string;
  referenceItemNumber: string;
  partNumber: string;
  usdPrice: string;
  shippingPolicy: ShippingPolicy;
  title: string;
  descriptionHtml: string;
  type: string;
  images: BlobImage[];
  us: {
    categoryId: string;
    storeCategoryIds: string[];
    itemSpecifics: Record<string, string[]>;
    compatibility: CompatibilityRow[];
  };
  au: {
    categoryId: string;
    storeCategoryNames: string[];
    itemSpecifics: Record<string, string[]>;
    compatibility: CompatibilityRow[];
  };
  preparedAt: string;
};

export function validateListingPackage(value: unknown): asserts value is ListingPackage {
  if (!value || typeof value !== 'object') throw new Error('등록 패키지가 비어 있습니다.');
  const item = value as Partial<ListingPackage>;
  if (item.version !== 1 || !item.date || !item.itemId || !item.referenceItemNumber
    || !item.partNumber || !/^\d+(\.\d{1,2})?$/.test(item.usdPrice ?? '')
    || !['7day normal', '7day fast'].includes(item.shippingPolicy ?? '')
    || !item.title || !item.descriptionHtml || !item.type
    || !Array.isArray(item.images) || item.images.length === 0 || !item.us || !item.au) {
    throw new Error('등록 패키지의 필수 정보가 빠졌습니다.');
  }
  if (!item.title.startsWith('⭐Genuine ') || [...item.title].length > 80) {
    throw new Error('제목이 별표/Genuine/80자 규칙과 맞지 않습니다.');
  }
  if (!item.descriptionHtml.includes(item.title)) {
    throw new Error('본문에 현재 상품 제목이 없습니다.');
  }
  if (item.images.some((image) => !image.url || !image.pathname || !image.filename)) {
    throw new Error('완성 사진 정보가 올바르지 않습니다.');
  }
  if (!item.us.categoryId || !item.au.categoryId) throw new Error('미국 또는 호주 카테고리가 없습니다.');
  if (!Array.isArray(item.us.compatibility) || !Array.isArray(item.au.compatibility)) {
    throw new Error('미국 또는 호주 호환표가 없습니다.');
  }
}
import type { ShippingPolicy } from './listing-work-store';
