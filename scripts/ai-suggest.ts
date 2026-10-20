// AI 점수 제안을 터미널에서 시험한다 (저장하지 않음)
// 사용법: npm run ai:suggest -- <상품번호>     예) npm run ai:suggest -- 23
// 필요: .env.local에 ondap_ai (Gemini API 키), 선택 ONDAP_AI_MODEL

import { loadEnv } from '../src/lib/env.ts';
import { loadCatalog } from '../src/data/catalog.ts';
import { buildPrompt, normalizeSuggestion, suggestionSchema } from '../src/ai/suggest.ts';
import { generateJson } from '../src/ai/gemini.ts';

const env = loadEnv();
for (const k of ['ondap_ai', 'ONDAP_AI_MODEL']) if (env[k] && !process.env[k]) process.env[k] = env[k];

const productNo = Number(process.argv[2]);
const catalog = loadCatalog();
const product = catalog.products.find((p) => p.productNo === productNo);
if (!product) {
  console.error(`상품번호를 확인하세요. 예: npm run ai:suggest -- ${catalog.products[0]?.productNo ?? 23}`);
  process.exit(1);
}
const attrs = catalog.attributes.find((a) => a.productNo === productNo);
const { system, user } = buildPrompt(catalog.config, {
  productName: product.name,
  price: product.price,
  region: attrs?.region ?? '',
  category: attrs?.category ?? '',
  story: attrs?.story ?? '',
  tags: attrs?.tags ?? [],
});

const started = Date.now();
const { data, model } = await generateJson({ system, user, schema: suggestionSchema(catalog.config) });
const s = normalizeSuggestion(data, catalog.config, model);

console.log(`\n${product.name} — ${model} (${((Date.now() - started) / 1000).toFixed(1)}초)`);
console.log(s.summary);
for (const ind of catalog.config.indicators) {
  const cur = attrs?.scores[ind.id];
  console.log(`  ${ind.name.padEnd(6)} 현재 ${cur ?? '-'} → 제안 ${s.scores[ind.id] ?? '-'}  ${s.reasons[ind.id] ?? ''}`);
}
const name = (id: string) => catalog.config.events[id as keyof typeof catalog.config.events]?.name ?? id;
console.log(`  행사: ${s.events.map(name).join(', ') || '-'} / 관계: ${s.relations.join(', ') || '-'}`);
if (s.excludedEvents.length) console.log(`  제외: ${s.excludedEvents.map((x) => `${name(x.event)}(${x.reason})`).join(', ')}`);
if (Object.keys(s.meanings).length) console.log(`  의미: ${Object.entries(s.meanings).map(([e, m]) => `${name(e)}: ${m}`).join(' / ')}`);
console.log(`  태그: ${s.tags.join(', ') || '-'} / 산지: ${s.region ?? '-'}`);
