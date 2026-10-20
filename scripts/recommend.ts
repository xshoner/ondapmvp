// 추천 1건 실행 + 점수 내역 출력
// 사용법: npm run recommend -- <행사> <관계> [1개당 예산]
//   예) npm run recommend -- 장례 상급자/어르신 50000
//       npm run recommend -- funeral senior 50000

import { loadCatalog } from '../src/data/catalog.ts';
import { recommend } from '../src/engine/recommend.ts';
import { parseEvent, parseRelation } from '../src/engine/labels.ts';

const [eventArg, relationArg, budgetArg] = process.argv.slice(2);
const catalog = loadCatalog();
const { config } = catalog;

if (!eventArg || !relationArg) {
  console.log('사용법: npm run recommend -- <행사> <관계> [1개당 예산]');
  console.log(`행사: ${Object.values(config.events).map((e) => e.name).join(', ')}`);
  console.log(`관계: ${Object.values(config.relations).map((r) => r.name).join(', ')}`);
  process.exit(1);
}

const event = parseEvent(config, eventArg);
const relation = parseRelation(config, relationArg);
const budgetMax = budgetArg ? Number(budgetArg) : undefined;
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

const result = recommend(catalog, { event, relation, budgetMax });

console.log(`\n[${config.events[event].name} / ${config.relations[relation].name}${budgetMax ? ` / 1개당 ${won(budgetMax)} 이하` : ''}]`);
if (result.notice) console.log(`※ ${result.notice}`);

result.results.forEach((r, i) => {
  console.log(`\n${i + 1}위  [${r.tier}] ${r.product.name}  (${won(r.product.price)})`);
  console.log(`    ${r.reason}`);
  console.log(`    격식지수 ${r.matchScore}점  = 지표 ${r.formalityIndex}점 + 보너스 ${r.bonuses.reduce((s, b) => s + b.points, 0)}점`);
  for (const c of r.indicators) {
    const target = c.target === null ? '' : ` (목표 ${c.target} → 실효 ${c.effective})`;
    console.log(`      ${c.name.padEnd(6)} ${String(c.score).padStart(2)}/10${target} × 가중치 ${c.weight.toFixed(1)} → ${c.points}점`);
  }
  for (const b of r.bonuses) console.log(`      + ${b.reason} ${b.points}점`);
  console.log(`    ${r.product.url}`);
});

const banned = result.excluded.filter((x) => !x.reason.startsWith('예산 초과'));
console.log(`\n제외된 상품: ${result.excluded.length}개 (예산 초과 ${result.excluded.length - banned.length}개)`);
for (const x of banned) console.log(`  - ${x.name}: ${x.reason}`);
