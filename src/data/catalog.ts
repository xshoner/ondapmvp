// 로컬 JSON 데이터 읽기·쓰기. 4단계에서 Supabase로 교체할 지점.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../lib/paths.ts';
import type { Cafe24Product, Catalog, EngineConfig, ProductAttributes } from '../engine/types.ts';

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;
}

function writeJson(file: string, value: unknown): void {
  const path = join(dataDir, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function loadCatalog(): Catalog {
  const { products } = readJson<{ products: Cafe24Product[] }>('cafe24-products.json');
  const { products: attributes } = readJson<{ products: ProductAttributes[] }>('product-attributes.json');
  const config = readJson<EngineConfig>('config/engine.json');
  return { products, attributes, config };
}

export function loadSyncInfo(): { mallId: string; syncedAt: string } {
  const { mallId, syncedAt } = readJson<{ mallId: string; syncedAt: string }>('cafe24-products.json');
  return { mallId, syncedAt };
}

export function saveCafe24Products(mallId: string, products: Cafe24Product[]): void {
  writeJson('cafe24-products.json', { mallId, syncedAt: new Date().toISOString(), products });
}

// 한 상품의 지표를 저장한다(없으면 추가). 나머지 상품은 그대로 둔다.
export function saveProductAttributes(next: ProductAttributes): void {
  const file = readJson<{ _note?: string; products: ProductAttributes[] }>('product-attributes.json');
  const i = file.products.findIndex((a) => a.productNo === next.productNo);
  if (i === -1) file.products.push(next);
  else file.products[i] = next;
  file.products.sort((a, b) => a.productNo - b.productNo);
  writeJson('product-attributes.json', file);
}

export function saveEngineConfig(config: EngineConfig): void {
  writeJson('config/engine.json', config);
}

// 검증용 기대 정답: "행사:관계" → 1위여야 하는 상품번호
export type Expectations = Record<string, number>;

export function loadExpectations(): Expectations {
  const file = join(dataDir, 'scenario-expectations.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Expectations) : {};
}

export function saveExpectation(key: string, productNo: number | null): void {
  const all = loadExpectations();
  if (productNo === null) delete all[key];
  else all[key] = productNo;
  writeJson('scenario-expectations.json', all);
}
