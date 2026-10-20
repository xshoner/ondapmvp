// 실제 쇼핑몰 데이터(data/)로 32개 시나리오의 불변 조건을 검사한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../src/data/catalog.ts';
import { recommend } from '../src/engine/recommend.ts';
import type { EventType, Relation } from '../src/engine/types.ts';

const catalog = loadCatalog();
const events = Object.keys(catalog.config.events) as EventType[];
const relations = Object.keys(catalog.config.relations) as Relation[];
const BUDGET = 60000;

for (const event of events) {
  for (const relation of relations) {
    const label = `${catalog.config.events[event].name} / ${catalog.config.relations[relation].name}`;

    test(label, () => {
      const r = recommend(catalog, { event, relation, budgetMax: BUDGET });

      assert.equal(r.results.length, catalog.config.resultCount, '추천 3개');
      assert.ok(r.results.every((x, i, a) => i === 0 || a[i - 1].matchScore >= x.matchScore), '점수 내림차순');

      const limit = r.relaxedBudget ?? BUDGET;
      assert.ok(r.results.every((x) => x.product.price <= limit), '예산 이내');

      for (const x of r.results) {
        assert.ok(!x.attributes.excludedEvents.some((e) => e.event === event), `${x.product.name}은 ${label}에서 제외돼야 함`);
        assert.ok(x.matchScore >= 0 && x.matchScore <= 100);
      }

      const categories = new Set(r.results.map((x) => x.attributes.category));
      assert.equal(categories.size, r.results.length, '카테고리 중복 없음');
    });
  }
}

test('장례 추천에는 신선·냉장 상품과 복숭아가 나오지 않는다', () => {
  for (const relation of relations) {
    const r = recommend(catalog, { event: 'funeral', relation, budgetMax: 200000 });
    for (const x of r.results) {
      assert.ok(!/한우|한돈|활전복|생물|대게|복숭아/.test(x.product.name), x.product.name);
    }
  }
});

test('모든 쇼핑몰 상품에 지표가 입력돼 있다', () => {
  const known = new Set(catalog.attributes.map((a) => a.productNo));
  const missing = catalog.products.filter((p) => !known.has(p.productNo)).map((p) => p.productNo);
  assert.deepEqual(missing, []);
});
