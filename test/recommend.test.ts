import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/engine/recommend.ts';
import { attrs, catalog, product } from './fixtures.ts';

const nos = (r: ReturnType<typeof recommend>) => r.results.map((x) => x.product.productNo);

test('미진열·판매중지·품절·지표 미입력 상품은 제외', () => {
  const c = catalog(
    [
      product(1, 10000),
      product(2, 10000, { display: false }),
      product(3, 10000, { selling: false }),
      product(4, 10000, { soldOut: true }),
      product(5, 10000),
    ],
    [attrs(1), attrs(2), attrs(3), attrs(4)],
  );
  const r = recommend(c, { event: 'funeral', relation: 'senior' });
  assert.deepEqual(nos(r), [1]);
  assert.deepEqual(r.excluded.map((x) => x.reason), ['미진열 또는 판매중지', '미진열 또는 판매중지', '품절', '지표 미입력']);
});

test('해당 행사 금지 상품은 점수와 관계없이 제외', () => {
  const c = catalog(
    [product(1, 10000), product(2, 10000)],
    [attrs(1, { scores: { rarity: 10, formality: 9 }, excludedEvents: [{ event: 'funeral', reason: '생물' }] }), attrs(2)],
  );
  assert.deepEqual(nos(recommend(c, { event: 'funeral', relation: 'senior' })), [2]);
  assert.deepEqual(nos(recommend(c, { event: 'wedding', relation: 'senior' })), [1, 2]);
});

test('예산 초과 상품은 제외하고, 3개가 안 되면 예산을 1.3배까지 넓힌다', () => {
  const c = catalog(
    [product(1, 40000), product(2, 50000), product(3, 60000), product(4, 90000)],
    [attrs(1), attrs(2), attrs(3), attrs(4)],
  );
  const r = recommend(c, { event: 'funeral', relation: 'senior', budgetMax: 50000 });
  assert.equal(r.relaxedBudget, 65000);
  assert.deepEqual(nos(r).sort(), [1, 2, 3]);
  assert.match(r.notice ?? '', /65,000원까지 넓혀/);
});

test('넓혀도 부족하면 있는 만큼만 주고 안내한다', () => {
  const c = catalog([product(1, 40000), product(2, 200000)], [attrs(1), attrs(2)]);
  const r = recommend(c, { event: 'funeral', relation: 'senior', budgetMax: 50000 });
  assert.deepEqual(nos(r), [1]);
  assert.equal(r.relaxedBudget, null);
  assert.match(r.notice ?? '', /1개뿐/);
});

test('점수 순으로 정렬된다', () => {
  const c = catalog(
    [product(1, 10000), product(2, 10000), product(3, 10000)],
    [
      attrs(1, { scores: { rarity: 3, formality: 8 } }),
      attrs(2, { scores: { rarity: 9, formality: 8 } }),
      attrs(3, { scores: { rarity: 6, formality: 8 } }),
    ],
  );
  const r = recommend(c, { event: 'funeral', relation: 'senior' });
  assert.deepEqual(nos(r), [2, 3, 1]);
  assert.ok(r.results.every((x, i, a) => i === 0 || a[i - 1].matchScore >= x.matchScore));
});

test('같은 카테고리는 1개씩만 고르고, 모자라면 순위대로 채운다', () => {
  const high = { rarity: 9, formality: 8 };
  const c = catalog(
    [product(1, 10000), product(2, 10000), product(3, 10000), product(4, 10000)],
    [
      attrs(1, { category: '수산', scores: high }),
      attrs(2, { category: '수산', scores: high }),
      attrs(3, { category: '수산', scores: high }),
      attrs(4, { category: '과일', scores: { rarity: 2, formality: 8 } }),
    ],
  );
  // 수산 1개 + 과일 1개를 먼저 고르고, 남은 1자리는 수산 2위로 채운다
  assert.deepEqual(nos(recommend(c, { event: 'funeral', relation: 'senior' })), [1, 2, 4]);
});

test('같은 입력이면 항상 같은 결과', () => {
  const c = catalog(
    [product(1, 30000), product(2, 30000), product(3, 30000), product(4, 30000)],
    [attrs(1), attrs(2), attrs(3), attrs(4)],
  );
  const a = recommend(c, { event: 'thanks', relation: 'business', budgetMax: 50000 });
  const b = recommend(c, { event: 'thanks', relation: 'business', budgetMax: 50000 });
  assert.deepEqual(a, b);
});
