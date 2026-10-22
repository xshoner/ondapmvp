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

// 상품 지표를 저장한다(없으면 추가). 나머지 상품은 그대로 두고, 내용이 바뀐 것만 변경 이력에 남긴다.
export function saveProductAttributes(...list: ProductAttributes[]): void {
  const file = readJson<{ _note?: string; products: ProductAttributes[] }>('product-attributes.json');
  const changes: AttributeChange[] = [];
  const now = new Date().toISOString();
  for (const next of list) {
    const i = file.products.findIndex((a) => a.productNo === next.productNo);
    const before = i === -1 ? null : file.products[i];
    if (before && JSON.stringify(before) === JSON.stringify(next)) continue;
    if (i === -1) file.products.push(next);
    else file.products[i] = next;
    changes.push({ id: `${Date.now().toString(36)}${changes.length}`, productNo: next.productNo, changedAt: now, changedBy: null, op: before ? 'update' : 'insert', before, after: next });
  }
  file.products.sort((a, b) => a.productNo - b.productNo);
  writeJson('product-attributes.json', file);
  if (changes.length) writeJson(HISTORY_FILE, [...loadAttributeHistory(), ...changes].slice(-HISTORY_MAX));
}

// 지표 변경 이력 (로컬 모드). Supabase는 product_attributes_history 표가 트리거로 쌓는다
export interface AttributeChange {
  id: string;
  productNo: number;
  changedAt: string;
  changedBy: string | null; // 바꾼 관리자 이메일 (로컬은 없음)
  op: 'insert' | 'update' | 'delete';
  before: ProductAttributes | null;
  after: ProductAttributes | null;
}

const HISTORY_FILE = 'attribute-history.json';
const HISTORY_MAX = 2000;

export function loadAttributeHistory(): AttributeChange[] {
  const file = join(dataDir, HISTORY_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as AttributeChange[]) : [];
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
