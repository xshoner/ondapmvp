import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFormality, parseWorkspace, type FormalityInput } from '../src/engine/eligibility.ts';
import { formalitySamples, SAMPLE_INPUT } from '../src/engine/formality-samples.ts';
import { catalog } from './fixtures.ts';

const fixture = () => formalitySamples(catalog([], []));
const evaluate = (f = fixture(), patch: Partial<FormalityInput> = {}) => evaluateFormality(f.catalog, f.workspace, { ...SAMPLE_INPUT, ...patch });

test('고격식 샘플: 행사 85점·희소 0.7 이상, 2개만 통과하고 높은 순위 재료로 부적격을 복구하지 않는다', () => {
  const r = evaluate();
  assert.equal(r.event.score, 85);
  assert.deepEqual(r.decisions.map((d) => d.rarity.value), [0.86, 0.74, 0.28]);
  assert.deepEqual(r.selected.map((d) => d.product.productNo), [900002, 900001]);
  assert.equal(r.decisions[2].code, 'rarity_outside');
  assert.equal(r.decisions[2].ranking, null);
  assert.equal(r.decisions[2].rankScore, null);
  assert.match(r.notice!, /2개/);
});

test('행사 값은 상품에 독립적이고 희소값은 행사·가격에 독립적이다', () => {
  const f = fixture(), before = evaluate(f);
  f.catalog.products[0].price = 1000;
  f.workspace.evidence[0].factors.skill!.score = 5;
  const after = evaluate(f);
  assert.deepEqual(before.event, after.event);
  assert.deepEqual(evaluate(f, { event: 'birthday' }).decisions.map((d) => d.rarity), after.decisions.map((d) => d.rarity));
  assert.notEqual(before.decisions[0].rarity.value, after.decisions[0].rarity.value);
});

test('낮은 격식에서는 샘플 3개가 모두 적격이다', () => {
  const r = evaluate(fixture(), { event: 'birthday', relation: 'family', sender: 'personal' });
  assert.equal(r.event.score, 25);
  assert.equal(r.selected.length, 3);
  assert.equal(r.notice, null);
});

test('미검수·근거 부족은 후보에서 제외하고 누락은 0점으로 합산하지 않는다', () => {
  const f = fixture();
  f.workspace.evidence[0].reviewed = false;
  f.workspace.evidence[1].factors = { skill: { score: 9, basis: '확인 자료' }, locality: { score: 9, basis: '  ' } };
  const r = evaluate(f);
  assert.equal(r.decisions[0].code, 'unreviewed');
  assert.equal(r.decisions[1].code, 'evidence_missing');
  f.workspace.evidence[1].factors.locality!.basis = '두 번째 확인 자료';
  const complete = evaluate(f).decisions[1];
  assert.equal(complete.rarity.value, 0.9);
  assert.equal(complete.rarity.coverage, 0.4);
  assert.equal(complete.eligible, true);
});

test('희소값 경계·상한·가중치 0 및 재정규화', () => {
  const f = fixture();
  f.workspace.evidence[0].factors = { skill: { score: 7, basis: '자료1' }, locality: { score: 7, basis: '자료2' }, story: { score: 0, basis: '자료3' } };
  f.workspace.policy.rarityWeights.story = 0;
  assert.equal(evaluate(f).decisions[0].eligible, true);
  f.workspace.policy.bands[3].max = 0.7;
  assert.equal(evaluate(f).decisions[1].eligible, false);
});

test('품절·행사 금지·예산 초과는 희소값이 높아도 복구하지 않는다', () => {
  const f = fixture();
  f.catalog.products[0].soldOut = true;
  f.catalog.attributes[1].excludedEvents = [{ event: 'funeral', reason: '장례 금지' }];
  assert.equal(evaluate(f).decisions[0].code, 'unavailable');
  assert.equal(evaluate(f, { event: 'funeral' }).decisions[1].code, 'event_banned');
  f.catalog.products[0].soldOut = false;
  const r = evaluate(f, { budget: 10000 });
  assert.equal(r.selected.length, 0);
  assert.equal(r.decisions[0].code, 'budget_exceeded');
  assert.equal(r.decisions[1].rankScore, null);
});

test('예산 없는 평가·지표 누락·금액 오류·미입력 경고', () => {
  const f = fixture();
  let r = evaluate(f, { budget: null, sender: 'unknown' });
  assert.equal(r.event.incomplete, true);
  assert.equal(r.decisions[1].rankScore, 90);
  assert.equal(Object.hasOwn(r.decisions[1].ranking!, 'price'), false);
  delete f.catalog.attributes[1].scores.trust;
  assert.equal(evaluate(f).decisions[1].code, 'ranking_missing');
  f.catalog.products[0].price = NaN;
  assert.equal(evaluate(f).decisions[0].code, 'price_invalid');
});

test('근거 값이 달라도 순위 점수에 희소값을 다시 합산하지 않는다', () => {
  const f = fixture(), before = evaluate(f).decisions[0].rankScore;
  f.workspace.evidence[0].factors.skill!.score = 10;
  assert.equal(evaluate(f).decisions[0].rankScore, before);
});

test('정렬·카테고리 다양성과 동점 결과가 입력 순서에 독립적이다', () => {
  const f = fixture();
  f.catalog.products.forEach((p) => { p.price = 20000; });
  f.catalog.attributes.forEach((a) => { a.scores = { trust: 8, practicality: 8 }; a.category = '같은 종류'; });
  const input: Partial<FormalityInput> = { event: 'birthday', relation: 'family', sender: 'personal' };
  const a = evaluate(f, input).selected.map((d) => d.product.productNo);
  f.catalog.products.reverse();
  assert.deepEqual(evaluate(f, input).selected.map((d) => d.product.productNo), a);
  assert.deepEqual(a, [900001, 900002, 900003]);
});

test('파일 경계: 형식·숫자·범위·중복·구간·버전·미입력 보정 검증', () => {
  const mutations = [
    (w: any) => { w.policy.version = ''; },
    (w: any) => { w.source = ['sample']; },
    (w: any) => { w.policy.eventBase.ceremony = NaN; },
    (w: any) => { w.policy.senderShift.unknown = 1; },
    (w: any) => { w.evidence.push(w.evidence[0]); },
    (w: any) => { w.evidence[0].factors.skill.score = 11; },
    (w: any) => { w.policy.bands[1].from = 0; },
    (w: any) => { w.policy.bands[0].from = 1; },
    (w: any) => { w.policy.bands[3].min = 0.2; },
    (w: any) => { w.policy.bands[3].max = 0.1; },
    (w: any) => { w.policy.rarityWeights = { skill: 1, locality: 0, distribution: 0, history: 0, story: 0 }; },
    (w: any) => { w.policy.rankWeights = { price: 1, trust: 0, practicality: 0 }; },
  ];
  for (const change of mutations) { const w = fixture().workspace; change(w); assert.throws(() => parseWorkspace(w)); }
});

test('주소 위조·수량 오류를 거부하고 입력·정책을 변경하지 않으며 결과 스냅샷을 재현한다', () => {
  const f = fixture(), original = structuredClone(f);
  for (const patch of [{ quantity: 1.5 }, { quantity: 0 }, { budget: Infinity }, { event: 'constructor' }, { sender: '__proto__' }]) assert.throws(() => evaluate(f, patch as Partial<FormalityInput>));
  const result = evaluate(f);
  assert.deepEqual(f, original);
  f.workspace.evidence[0].factors.skill!.score = 0;
  assert.equal(result.snapshot.workspace.evidence[0].factors.skill!.score, 9);
  const replay = evaluateFormality(result.snapshot.catalog, result.snapshot.workspace, result.input);
  assert.deepEqual(replay, result);
});
