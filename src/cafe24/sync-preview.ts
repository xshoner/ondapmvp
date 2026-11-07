import { createHash } from 'node:crypto';
import type { Cafe24Product } from '../engine/types.ts';
import { diffProducts, type ProductSyncDiff } from './sync-diff.ts';
import type { ProductSnapshot } from '../recommendation/contracts.ts';

export interface MissingCandidate {
  productNo: number;
  name: string;
  price: number;
  display: boolean;
  selling: boolean;
  soldOut: boolean;
  imageUrl: string | null;
  productUrl: string;
  hasEvidence: boolean;
  reviewed: boolean;
}

export interface SyncPreviewResult {
  currentCount: number;
  newCount: number;
  missingCount: number;
  missingRatio: number;
  exceedsThreshold: boolean;
  expectedSyncedAt: string | null;
  snapshotHash: string;
  diff: ProductSyncDiff;
  missingProducts: MissingCandidate[];
  products: Cafe24Product[];
}

export function computeSnapshotHash(products: Cafe24Product[]): string {
  const sorted = [...products].sort((a, b) => a.productNo - b.productNo);
  const canonical = sorted.map((p) => [
    p.productNo,
    p.name,
    p.price,
    p.display ? 1 : 0,
    p.selling ? 1 : 0,
    p.soldOut ? 1 : 0,
    p.url,
  ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function buildSyncPreview(
  currentProducts: (ProductSnapshot | Cafe24Product)[],
  fetchedProducts: Cafe24Product[],
  evidenceMap: Map<number, { reviewed: boolean; hasEvidence: boolean }>,
  expectedSyncedAt: string | null,
): SyncPreviewResult {
  const normalizedCurrent: Cafe24Product[] = currentProducts.map((p) => ({
    productNo: p.productNo,
    name: p.name,
    price: p.price,
    display: p.display,
    selling: p.selling,
    soldOut: p.soldOut,
    image: 'imageUrl' in p ? p.imageUrl : (p.image ?? null),
    detailImage: 'imageUrl' in p ? p.imageUrl : (p.detailImage ?? null),
    url: 'productUrl' in p ? p.productUrl : p.url,
  }));

  const fetchedMap = new Map(fetchedProducts.map((p) => [p.productNo, p]));
  const diff = diffProducts(normalizedCurrent, fetchedProducts);

  const missingProducts: MissingCandidate[] = normalizedCurrent
    .filter((p) => !fetchedMap.has(p.productNo))
    .map((p) => {
      const ev = evidenceMap.get(p.productNo);
      return {
        productNo: p.productNo,
        name: p.name,
        price: p.price,
        display: p.display,
        selling: p.selling,
        soldOut: p.soldOut,
        imageUrl: p.detailImage ?? p.image ?? null,
        productUrl: p.url,
        hasEvidence: Boolean(ev?.hasEvidence),
        reviewed: Boolean(ev?.reviewed),
      };
    });

  const currentCount = normalizedCurrent.length;
  const newCount = fetchedProducts.length;
  const missingCount = missingProducts.length;
  const missingRatio = currentCount > 0 ? missingCount / currentCount : 0;
  const exceedsThreshold = currentCount > 0 && missingRatio > 0.2;
  const snapshotHash = computeSnapshotHash(fetchedProducts);

  return {
    currentCount,
    newCount,
    missingCount,
    missingRatio,
    exceedsThreshold,
    expectedSyncedAt,
    snapshotHash,
    diff,
    missingProducts,
    products: fetchedProducts,
  };
}
