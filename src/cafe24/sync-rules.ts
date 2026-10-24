import type { Cafe24Product } from '../engine/types.ts';

export function validateProductSnapshot(products: Cafe24Product[], before: Cafe24Product[] = []): void {
  if (!Array.isArray(products) || products.length === 0 || products.length > 20000) throw new Error('상품 목록이 비었거나 허용 범위를 넘었습니다. 기존 목록을 유지합니다.');
  const ids = new Set<number>();
  for (const p of products) {
    if (!Number.isInteger(p.productNo) || p.productNo <= 0 || ids.has(p.productNo) || !p.name?.trim()
      || !Number.isSafeInteger(p.price) || p.price < 0 || p.price > 2147483647
      || ![p.display, p.selling, p.soldOut].every((v) => typeof v === 'boolean') || !/^https:\/\//.test(p.url)) {
      throw new Error('유효하지 않거나 중복된 상품 응답입니다. 기존 목록을 유지합니다.');
    }
    ids.add(p.productNo);
  }
  const removed = before.filter((p) => !ids.has(p.productNo)).length;
  if (before.length && removed / before.length > 0.2) throw new Error('상품의 20% 넘게 사라진 응답이라 갱신을 중단했습니다. 카페24 상품 수와 권한을 먼저 확인해 주세요.');
}
