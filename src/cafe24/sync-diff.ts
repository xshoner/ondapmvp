// 카페24 상품을 다시 가져올 때 무엇이 바뀌었는지 (관리자 요약 문구와 sync 스크립트가 함께 쓴다, 순수 함수)

import type { Cafe24Product } from '../engine/types.ts';

export interface ProductSyncDiff {
  added: Cafe24Product[];
  removed: Cafe24Product[];
  priceChanged: { product: Cafe24Product; from: number }[];
  stopped: Cafe24Product[]; // 새로 품절·미진열·판매중지
  resumed: Cafe24Product[]; // 다시 팔기 시작
}

const onSale = (p: Cafe24Product) => p.display && p.selling && !p.soldOut;

export function diffProducts(before: Cafe24Product[], after: Cafe24Product[]): ProductSyncDiff {
  const old = new Map(before.map((p) => [p.productNo, p]));
  const now = new Set(after.map((p) => p.productNo));
  const diff: ProductSyncDiff = { added: [], removed: before.filter((p) => !now.has(p.productNo)), priceChanged: [], stopped: [], resumed: [] };
  for (const p of after) {
    const o = old.get(p.productNo);
    if (!o) { diff.added.push(p); continue; }
    if (o.price !== p.price) diff.priceChanged.push({ product: p, from: o.price });
    if (onSale(o) && !onSale(p)) diff.stopped.push(p);
    if (!onSale(o) && onSale(p)) diff.resumed.push(p);
  }
  return diff;
}

export function syncSummary(d: ProductSyncDiff): string {
  const parts = [
    d.added.length && `새 상품 ${d.added.length}`,
    d.priceChanged.length && `가격 변경 ${d.priceChanged.length}`,
    d.stopped.length && `품절·판매중지 ${d.stopped.length}`,
    d.resumed.length && `판매 재개 ${d.resumed.length}`,
    d.removed.length && `사라짐 ${d.removed.length}`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '바뀐 상품 없음';
}
