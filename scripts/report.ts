// 행사 8종 × 관계 4종 = 32개 시나리오를 한 번에 돌려 결과표를 만든다 (알고리즘 검증용)
// 사용법: npm run report -- [1개당 예산, 기본 50000]
// 출력: 화면 + reports/scenario-report.md

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog } from '../src/data/catalog.ts';
import { recommend } from '../src/engine/recommend.ts';
import { projectRoot } from '../src/lib/paths.ts';
import type { EventType, Relation } from '../src/engine/types.ts';

const budgetMax = Number(process.argv[2] ?? 50000);
const catalog = loadCatalog();
const { config } = catalog;
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

const lines: string[] = [
  `# 추천 시나리오 결과 (1개당 ${won(budgetMax)} 이하)`,
  '',
  `상품 ${catalog.products.length}개 · 지표 가안 기준 · 생성 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  '| 행사 | 관계 | 1위 | 2위 | 3위 | 비고 |',
  '| --- | --- | --- | --- | --- | --- |',
];

const firstPlaces = new Set<number>();
const appeared = new Set<number>();

for (const event of Object.keys(config.events) as EventType[]) {
  for (const relation of Object.keys(config.relations) as Relation[]) {
    const r = recommend(catalog, { event, relation, budgetMax });
    if (r.results[0]) firstPlaces.add(r.results[0].product.productNo);
    for (const x of r.results) appeared.add(x.product.productNo);
    const cells = [0, 1, 2].map((i) => {
      const x = r.results[i];
      return x ? `${x.product.name} (${x.matchScore})` : '—';
    });
    lines.push(
      `| ${config.events[event].name} | ${config.relations[relation].name} | ${cells.join(' | ')} | ${r.notice ?? ''} |`,
    );
  }
}

lines.push(
  '',
  `**변별력**: 32개 시나리오의 1위 상품 ${firstPlaces.size}종, 1~3위에 한 번이라도 나온 상품 ${appeared.size}종 / 전체 ${catalog.products.length}종`,
);

const md = lines.join('\n') + '\n';
mkdirSync(join(projectRoot, 'reports'), { recursive: true });
writeFileSync(join(projectRoot, 'reports', 'scenario-report.md'), md);
console.log(md);
console.log('→ reports/scenario-report.md 에 저장했습니다.');
