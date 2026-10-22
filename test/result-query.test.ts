import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResultQuery, perItemBudget, resultHref, shippingFee } from '../src/lib/result-query.ts';
import { recommend } from '../src/engine/recommend.ts';
import { attrs, catalog, product } from './fixtures.ts';

test('결과 주소: 고쳐 보낸 값도 안전한 범위로 읽는다', () => {
  const q = parseResultQuery({ event: 'wedding', relation: 'business', budget: 'abc', qty: '250000', exclude: '27,x,27,-3,33,' });
  assert.equal(q.budget, null); // 숫자가 아니면 예산 상관없음 (예전에는 NaN이 예산 필터를 통과)
  assert.equal(q.qty, 100000);
  assert.deepEqual(q.exclude, [27, 33]);
  assert.equal(parseResultQuery({ budget: '0', qty: '2.6' }).budget, null);
  assert.equal(parseResultQuery({ qty: '2.6' }).qty, 3);
  assert.equal(parseResultQuery({ exclude: Array.from({ length: 15 }, (_, i) => i + 1).join(',') }).exclude.length, 10);
});

test('결과 주소 만들기: 바꾼 값만 반영하고 빈 값은 뺀다', () => {
  const q = parseResultQuery({ event: 'wedding', relation: 'business', budget: '50000', qty: '10' });
  assert.equal(resultHref(q), '/result?event=wedding&relation=business&qty=10&budget=50000');
  assert.equal(resultHref(q, { budget: null, exclude: [27] }), '/result?event=wedding&relation=business&qty=10&exclude=27');
});

test('전체 예산을 수량으로 나누면 원 단위로 내린다', () => {
  assert.equal(perItemBudget(1500000, 30), 50000);
  assert.equal(perItemBudget(1000000, 3), 333333);
  assert.equal(perItemBudget('', 3), null);
  assert.equal(perItemBudget(2, 3), null); // 1개당 0원은 예산으로 쓰지 않는다
});

test('배송비: 무료 기준 이상이면 0원', () => {
  assert.equal(shippingFee(49999), 2500);
  assert.equal(shippingFee(50000), 0);
  assert.equal(shippingFee(30000, { fee: 3000, freeOver: 100000 }), 3000);
});

test('고객이 뺀 상품은 제외하고 다음 후보를 보여 준다', () => {
  const c = catalog(
    [product(1, 10000), product(2, 10000), product(3, 10000), product(4, 10000)],
    [
      attrs(1, { scores: { rarity: 9, formality: 8 } }),
      attrs(2, { scores: { rarity: 7, formality: 8 } }),
      attrs(3, { scores: { rarity: 5, formality: 8 } }),
      attrs(4, { scores: { rarity: 3, formality: 8 } }),
    ],
  );
  const r = recommend(c, { event: 'funeral', relation: 'senior', exclude: [1] });
  assert.deepEqual(r.results.map((x) => x.product.productNo), [2, 3, 4]);
  assert.equal(r.excluded.find((x) => x.productNo === 1)?.reason, '고객이 뺀 상품');
  assert.deepEqual(r, recommend(c, { event: 'funeral', relation: 'senior', exclude: [1] })); // 같은 입력이면 같은 결과
});
