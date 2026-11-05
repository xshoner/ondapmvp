import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTOR_IDS } from '../src/recommendation/contracts.ts';
import { evaluateRecommendation } from '../src/recommendation/evaluate.ts';
import { createDraftPolicy } from '../src/recommendation/policy.ts';
import { ContractError, parseProductAssessment, parseRecommendationPolicy, parseRecommendationRequest } from '../src/recommendation/validation.ts';
import { sampleAssessment, sampleInputs, sampleProduct, sampleRequest } from './fixtures/recommendation-inputs.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const evaluate = () => { const f = sampleInputs(); return evaluateRecommendation(f.products, f.assessments, f.request, createDraftPolicy()); };
const near = (actual: number | null, expected: number) => { assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); };

test('가격 점수 경계와 세 선택안은 예산을 넘지 않고 중복되지 않는다', () => {
  const policy = createDraftPolicy();
  const request = { ...sampleRequest, budget: { mode: 'per_item', amount: 10000 } };
  for (const [price, expected] of [[1, 30.01], [4000, 70], [6999, 99.99], [7000, 100], [9500, 100], [10000, 70]]) {
    const result = evaluateRecommendation([sampleProduct(1, price)], [sampleAssessment(1)], request, policy);
    near(result.items[0].priceValueScore, expected);
  }
  const products = [4000, 8000, 9500, 10001].map((price, i) => sampleProduct(i + 1, price));
  const result = evaluateRecommendation(products, products.map((p) => sampleAssessment(p.productNo)), request, policy);
  assert.deepEqual(result.items.map((i) => i.slot), ['standard', 'practical', 'formal']);
  assert.equal(new Set(result.items.map((i) => i.productNo)).size, 3);
  assert.equal(result.exclusions.find((x) => x.productNo === 4)?.code, 'budget_exceeded');
  assert.equal(result.items[1].unitPrice, 4000);
  const two = evaluateRecommendation(products.slice(0, 2), products.slice(0, 2).map((p) => sampleAssessment(p.productNo)), request, policy);
  assert.deepEqual(two.items.map((i) => i.slot), ['standard', 'practical']);
});

test('설계안의 F/R/E/V/S를 별개로 계산하고 더 싼 상품보다 행사 적합 상품이 앞선다', () => {
  const { items } = evaluate();
  assert.deepEqual(items.map((i) => i.productNo), [900003, 900002, 900001]);
  assert.deepEqual(items.map((i) => i.slot), ['standard', 'practical', 'formal']);
  const expected = [[75, 95, 90, 93.5], [90, 90, 66, 82.8], [80, 100, 74, 92.2]];
  for (const [index, item] of items.entries()) {
    assert.equal(item.eventFormality, 80);
    [item.rarityValue, item.eventFitScore, item.priceValueScore, item.recommendationScore].forEach((n, j) => near(n, expected[index][j]));
    assert.equal(item.rank, index + 1);
    assert.equal(item.itemSubtotal, item.unitPrice * 10);
  }
});

test('예산 미입력은 가격 미평가이며 추천점수는 행사 적합도다', () => {
  const f = sampleInputs();
  f.request.budget = { mode: 'none' };
  const r = evaluateRecommendation(f.products, f.assessments, f.request, createDraftPolicy());
  assert.deepEqual(r.items.map((i) => i.productNo), [900001, 900002, 900003]);
  for (const i of r.items) { assert.equal(i.priceValueScore, null); assert.equal(i.recommendationScore, i.eventFitScore); }
});

test('전체 예산은 원본과 수량으로 직접 계산하고 개당 한도가 0이어도 예산 없음으로 바뀌지 않는다', () => {
  const f = sampleInputs();
  f.request.budget = { mode: 'total', amount: 500000 };
  const total = evaluateRecommendation(f.products, f.assessments, f.request, createDraftPolicy());
  assert.deepEqual(total.items, evaluate().items);
  f.request.budget = { mode: 'total', amount: 1 };
  const tiny = evaluateRecommendation(f.products, f.assessments, f.request, createDraftPolicy());
  assert.equal(tiny.items.length, 0);
  assert.ok(tiny.exclusions.every((x) => x.code === 'budget_exceeded'));
  assert.deepEqual(tiny.request.budget, { mode: 'total', amount: 1 });
});

test('예산 경계는 상품비 이하이며 자동 예산 완화가 없다', () => {
  const p = sampleProduct(1, 22000);
  const a = sampleAssessment(1);
  const req = { ...sampleRequest, budget: { mode: 'per_item', amount: 22000 } };
  const r = evaluateRecommendation([p], [a], req, createDraftPolicy());
  assert.equal(r.items.length, 1); near(r.items[0].priceValueScore, 70);
  const over = evaluateRecommendation([{ ...p, price: 22001 }], [a], req, createDraftPolicy());
  assert.equal(over.items.length, 0); assert.equal(over.exclusions[0].code, 'budget_exceeded');
});

test('과거 수준형 자료는 조회 변환만 하고 원본·평가 방법을 보존한다', () => {
  const raw = { productNo: 1, reviewed: true, factors: { skill: { level: 'high', basis: ' 과거 근거 원문 ' }, locality: { level: 'high', basis: '과거 근거' } } };
  const copy = structuredClone(raw);
  const a = parseProductAssessment(raw);
  assert.equal(a.factors.skill.score, 8);
  assert.equal(a.factors.skill.method, 'legacy-level');
  assert.equal(a.factors.skill.basis, ' 과거 근거 원문 ');
  const r = evaluateRecommendation([sampleProduct(1, 22000)], [raw], sampleRequest, createDraftPolicy());
  assert.equal(r.items[0].rarityValue, 80);
  assert.equal(r.items[0].assessmentMethod, 'legacy-level');
  assert.ok(r.notices.some((n) => n.code === 'legacy_assessment'));
  assert.deepEqual(raw, copy);
  assert.deepEqual(parseProductAssessment(a), a);
});

test('확인된 0점은 유효하고 미입력·공백 근거·가중치 0은 근거 수를 채우지 않는다', () => {
  const policy = createDraftPolicy();
  const a = sampleAssessment(1, 0);
  const req = { ...sampleRequest, event: 'birthday', relation: 'family', budget: { mode: 'none' } };
  const zero = evaluateRecommendation([sampleProduct(1, 10000)], [a], req, policy);
  assert.equal(zero.items[0].rarityValue, 0); assert.equal(zero.items[0].evidenceCount, 5);
  for (const key of FACTOR_IDS) a.factors[key].score = null;
  a.factors.skill.score = 8;
  const missing = evaluateRecommendation([sampleProduct(1, 10000)], [a], req, policy);
  assert.equal(missing.exclusions[0].code, 'insufficient_evidence');
  a.factors.locality.score = 8; a.factors.locality.basis = '   ';
  assert.equal(evaluateRecommendation([sampleProduct(1, 10000)], [a], req, policy).items.length, 0);
  a.factors.locality.basis = '근거'; policy.rarityWeights.locality = 0;
  assert.equal(evaluateRecommendation([sampleProduct(1, 10000)], [a], req, policy).items.length, 0);
});

test('행사 기준 탈락·미검수·품절·고객 제외 상품을 높은 점수로 복구하지 않는다', () => {
  const products = [1, 2, 3, 4, 5].map((n) => sampleProduct(n, 100));
  const assessments = [1, 2, 3, 4, 5].map((n) => sampleAssessment(n));
  assessments[0] = sampleAssessment(1, 1);
  assessments[1].reviewed = false; products[2].soldOut = true;
  products[4].excludedEvents = ['wedding'];
  const r = evaluateRecommendation(products, assessments, { ...sampleRequest, excludedProductNos: [4] }, createDraftPolicy());
  assert.equal(r.items.length, 0);
  assert.deepEqual(r.exclusions.map((x) => x.code), ['rarity_outside', 'unreviewed', 'unavailable', 'customer_excluded', 'event_excluded']);
});

test('동점은 E→판매가→상품번호로 고정하고 입력·정책·평가를 변경하지 않는다', () => {
  const products = [sampleProduct(3, 10000), sampleProduct(2, 10000), sampleProduct(1, 10000)];
  const assessments = [3, 2, 1].map((n) => sampleAssessment(n));
  const policy = createDraftPolicy();
  const before = structuredClone({ products, assessments, request: sampleRequest, policy });
  const a = evaluateRecommendation(products, assessments, sampleRequest, policy);
  const b = evaluateRecommendation([...products].reverse(), [...assessments].reverse(), sampleRequest, policy);
  assert.deepEqual(a, b); assert.deepEqual(a.items.map((i) => i.productNo), [1, 2, 3]);
  assert.deepEqual({ products, assessments, request: sampleRequest, policy }, before);
});

test('소수 표시 반올림은 순위를 바꾸지 않고 최대 3개만 반환한다', () => {
  const products = [sampleProduct(1, 10001), sampleProduct(2, 10000), sampleProduct(3, 10002), sampleProduct(4, 10003)];
  const r = evaluateRecommendation(products, products.map((p) => sampleAssessment(p.productNo)), sampleRequest, createDraftPolicy());
  assert.deepEqual(r.items.map((i) => i.productNo), [4, 2, 1]);
  assert.equal(r.items[0].recommendationScore.toFixed(1), r.items[1].recommendationScore.toFixed(1));
});

test('잘못된 예산·수량·행사 및 프로토타입 키를 조용히 기본값으로 바꾸지 않는다', () => {
  for (const patch of [{ quantity: 0 }, { quantity: 1.2 }, { quantity: '10' }, { event: '__proto__' }, { relation: 'constructor' }, { budget: { mode: 'total', amount: 0 } }, { budget: { mode: 'none', amount: 10 } }, { budget: { mode: 'per_item', amount: Infinity } }]) {
    assert.throws(() => parseRecommendationRequest({ ...sampleRequest, ...patch }), ContractError);
  }
});

test('이중 점수·범위 밖 숫자·잘못된 정책·중복 상품·실행 URL을 검증한다', () => {
  assert.throws(() => parseProductAssessment({ productNo: 1, reviewed: true, factors: { skill: { score: 8, level: 'high' } } }), ContractError);
  const a = sampleAssessment(1); a.factors.skill.score = 10.1;
  assert.throws(() => parseProductAssessment(a), ContractError);
  const policy = createDraftPolicy(); policy.scoreWeights.eventFit = 0;
  assert.throws(() => parseRecommendationPolicy(policy), ContractError);
  assert.throws(() => evaluateRecommendation([sampleProduct(1, 100), sampleProduct(1, 100)], [], sampleRequest, createDraftPolicy()), ContractError);
  const r = evaluateRecommendation([{ ...sampleProduct(1, 100), productUrl: 'javascript:alert(1)' }], [sampleAssessment(1)], sampleRequest, createDraftPolicy());
  assert.equal(r.exclusions[0].code, 'invalid_product');
});

test('소수 가중치에서도 희소값 허용 경계와 0~100 점수 범위를 지킨다', () => {
  const policy = createDraftPolicy();
  policy.rarityWeights = { skill: 0.1, locality: 0.2, distribution: 0.3, history: 0.4, story: 0.5 };
  const a = sampleAssessment(1, 7);
  const r = evaluateRecommendation([sampleProduct(1, 10000)], [a], sampleRequest, policy);
  assert.equal(r.items[0].rarityValue, 70);
  for (const score of [0, 10]) {
    const result = evaluateRecommendation([sampleProduct(1, 0)], [sampleAssessment(1, score)], { ...sampleRequest, event: 'birthday', relation: 'family' }, policy);
    assert.ok(result.items.every((i) => i.recommendationScore >= 0 && i.recommendationScore <= 100));
  }
});

test('부가 수동점수·상품 v1 속성·가격순 출력으로 되돌아가지 않으며 응답에 원자료를 노출하지 않는다', () => {
  const f = sampleInputs();
  const result = evaluateRecommendation(f.products, f.assessments, f.request, createDraftPolicy());
  const extra = f.assessments.map((a) => ({ ...a, scores: { trust: 0, practicality: 0 }, recommendation: { trust: 0, practicality: 0 } }));
  assert.deepEqual(evaluateRecommendation(f.products, extra, f.request, createDraftPolicy()), result);
  const text = JSON.stringify(result);
  assert.ok(!text.includes('확인 근거'));
  assert.ok(!text.includes('description'));
});

test('혼합 평가와 새 평가 버전을 구분하고 새 점수에 평가 기준이 없으면 사용하지 않는다', () => {
  const a = sampleAssessment(1);
  a.factors.skill = { score: 8, basis: '과거 근거', method: 'legacy-level', rubricVersion: 'legacy-level-v1' };
  const r = evaluateRecommendation([sampleProduct(1, 10000)], [a], sampleRequest, createDraftPolicy());
  assert.equal(r.items[0].assessmentMethod, 'mixed');
  assert.deepEqual(r.items[0].rubricVersions, ['legacy-level-v1', 'numeric-draft-1']);
  for (const key of FACTOR_IDS) a.factors[key].rubricVersion = null;
  const missing = evaluateRecommendation([sampleProduct(1, 10000)], [a], sampleRequest, createDraftPolicy());
  assert.equal(missing.items.length, 0);
});

test('UI 가상 fixture는 공통 엔진과 일치하고 예산·오류·과거 평가 사례를 포함한다', () => {
  const f = JSON.parse(readFileSync(join(process.cwd(), 'docs/fixtures/recommendation-core-v1.json'), 'utf8'));
  assert.equal(f.fictional, true);
  const response = (id: string) => f.recommendations.find((c: { id: string }) => c.id === id).response;
  assert.deepEqual(response('three'), evaluate());
  assert.equal(response('one').items.length, 1);
  assert.equal(response('none').items.length, 0);
  assert.equal(response('tiny-total-budget').items.length, 0);
  assert.ok(response('no-budget').items.every((i: { priceValueScore: number | null }) => i.priceValueScore === null));
  assert.equal(response('legacy').items[0].assessmentMethod, 'legacy-level');
  assert.equal(response('mixed').items[0].assessmentMethod, 'mixed');
  assert.equal(response('unreviewed').items.length, 0);
  assert.equal(f.errors.aiFailed.error.code, 'ai_failed');
  assert.equal(f.errors.saveConflict.error.code, 'revision_conflict');
});
