// 카페24 쇼핑몰 상품을 data/cafe24-products.json으로 가져온다.
// 사용법: npm run sync

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../src/lib/env.ts';
import { dataDir } from '../src/lib/paths.ts';
import { cafe24ConfigFromEnv, fetchAllProducts } from '../src/cafe24/client.ts';
import { diffProducts, syncSummary } from '../src/cafe24/sync-diff.ts';
import type { Cafe24Product } from '../src/engine/types.ts';
import type { ProductAttributes } from '../src/engine/types.ts';

const config = cafe24ConfigFromEnv(loadEnv());
const products = await fetchAllProducts(config);

mkdirSync(dataDir, { recursive: true });
const out = join(dataDir, 'cafe24-products.json');
const before: Cafe24Product[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')).products : [];
writeFileSync(
  out,
  JSON.stringify({ mallId: config.mallId, syncedAt: new Date().toISOString(), products }, null, 2) + '\n',
);

console.log(`쇼핑몰 ${config.mallId}에서 상품 ${products.length}개를 가져왔습니다 → data/cafe24-products.json`);
if (before.length) console.log(`바뀐 것: ${syncSummary(diffProducts(before, products))}`);

const attrFile = join(dataDir, 'product-attributes.json');
if (existsSync(attrFile)) {
  const attrs = JSON.parse(readFileSync(attrFile, 'utf8')) as { products: ProductAttributes[] };
  const known = new Set(attrs.products.map((a) => a.productNo));
  const missing = products.filter((p) => !known.has(p.productNo));
  const gone = attrs.products.filter((a) => !products.some((p) => p.productNo === a.productNo));
  if (missing.length) {
    console.log(`\n지표가 입력되지 않은 상품 ${missing.length}개 (추천에서 제외됨):`);
    for (const p of missing) console.log(`  ${p.productNo}  ${p.name}`);
  }
  if (gone.length) {
    console.log(`\n쇼핑몰에서 사라진 상품의 지표 ${gone.length}개: ${gone.map((a) => a.productNo).join(', ')}`);
  }
}
