// 로컬 JSON 데이터를 Supabase에 넣는 SQL(supabase/seed.sql)로 만든다.
// 사용법: npm run db:seed-sql → 생성된 파일을 SQL Editor에 붙여넣고 Run
// 여러 번 실행해도 안전하다(같은 상품번호는 덮어씀).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog, loadExpectations } from '../src/data/catalog.ts';
import { projectRoot } from '../src/lib/paths.ts';

const lit = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v.replace(/'/g, "''")}'`);
const json = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;
const textArr = (v: string[]) => (v.length ? `array[${v.map(lit).join(', ')}]::text[]` : `'{}'::text[]`);

const { products, attributes, config } = loadCatalog();
const expectations = loadExpectations();
const out: string[] = [
  '-- 온답 초기 데이터 (npm run db:seed-sql로 생성). SQL Editor에서 Run',
  'begin;',
  '',
  '-- 카페24 상품',
];

for (const p of products) {
  out.push(
    `insert into public.products (product_no, name, price, display, selling, sold_out, image, detail_image, url) values (${p.productNo}, ${lit(p.name)}, ${p.price}, ${p.display}, ${p.selling}, ${p.soldOut}, ${lit(p.image)}, ${lit(p.detailImage)}, ${lit(p.url)})` +
      ` on conflict (product_no) do update set name = excluded.name, price = excluded.price, display = excluded.display, selling = excluded.selling, sold_out = excluded.sold_out, image = excluded.image, detail_image = excluded.detail_image, url = excluded.url, synced_at = now();`,
  );
}

out.push('', '-- 상품별 지표 (가안)');
for (const a of attributes) {
  out.push(
    `insert into public.product_attributes (product_no, region, category, scores, events, relations, excluded_events, meanings, tags, story, reviewed) values (${a.productNo}, ${lit(a.region)}, ${lit(a.category)}, ${json(a.scores)}, ${textArr(a.events)}, ${textArr(a.relations)}, ${json(a.excludedEvents)}, ${json(a.meanings)}, ${textArr(a.tags)}, ${lit(a.story)}, ${a.reviewed})` +
      ` on conflict (product_no) do update set region = excluded.region, category = excluded.category, scores = excluded.scores, events = excluded.events, relations = excluded.relations, excluded_events = excluded.excluded_events, meanings = excluded.meanings, tags = excluded.tags, story = excluded.story, reviewed = excluded.reviewed, updated_at = now();`,
  );
}

out.push(
  '',
  '-- 엔진 설정',
  `insert into public.engine_config (id, config) values ('active', ${json(config)}) on conflict (id) do update set config = excluded.config, updated_at = now();`,
);

const keys = Object.entries(expectations);
if (keys.length) {
  out.push('', '-- 기대 정답');
  for (const [k, no] of keys) {
    out.push(`insert into public.scenario_expectations (scenario_key, product_no) values (${lit(k)}, ${no}) on conflict (scenario_key) do update set product_no = excluded.product_no, updated_at = now();`);
  }
}

out.push('', 'commit;', '');

const dir = join(projectRoot, 'supabase');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'seed.sql'), out.join('\n'));
console.log(`supabase/seed.sql 생성: 상품 ${products.length}, 지표 ${attributes.length}, 설정 1, 기대 정답 ${keys.length}`);
