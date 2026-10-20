// Supabase의 상품·지표·설정을 로컬 JSON(data/)으로 내려받는다.
// 관리자 화면에서 고친 내용을 CLI(report, recommend)와 테스트에 반영할 때 쓴다.
// 사용법: npm run db:pull   (공개 읽기 권한만 쓰므로 로그인 불필요. 기대 정답은 관리자 전용이라 받지 않음)

import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/lib/env.ts';
import { attributesFromRow, productFromRow, type AttributesRow, type ProductRow } from '../src/data/rows.ts';
import { saveCafe24Products, saveEngineConfig } from '../src/data/catalog.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../src/lib/paths.ts';

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error('.env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 필요합니다.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const [p, a, c] = await Promise.all([
  db.from('products').select('*').order('product_no'),
  db.from('product_attributes').select('*').order('product_no'),
  db.from('engine_config').select('config').eq('id', 'active').maybeSingle(),
]);
for (const [name, r] of [['products', p], ['product_attributes', a], ['engine_config', c]] as const) {
  if (r.error) {
    console.error(`${name} 읽기 실패: ${r.error.message}`);
    process.exit(1);
  }
}
if (!c.data) {
  console.error('engine_config가 비어 있습니다. supabase/seed.sql을 먼저 실행하세요.');
  process.exit(1);
}

const products = (p.data as ProductRow[]).map(productFromRow);
const attributes = (a.data as AttributesRow[]).map(attributesFromRow);
saveCafe24Products(env.CAFE24_MALL_ID ?? '', products);
writeFileSync(
  join(dataDir, 'product-attributes.json'),
  JSON.stringify({ _note: 'Supabase에서 내려받은 사본 (npm run db:pull)', products: attributes }, null, 2) + '\n',
);
saveEngineConfig(c.data.config);
console.log(`Supabase → data/: 상품 ${products.length}, 지표 ${attributes.length}, 설정 1`);
