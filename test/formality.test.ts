import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseIndex, formalityTarget, indicatorWeights, scoreForSituation } from '../src/engine/formality.ts';
import { attrs, testConfig } from './fixtures.ts';

test('가중치 = 행사 가중치 × 관계 보정', () => {
  assert.deepEqual(indicatorWeights(testConfig, 'funeral', 'senior'), { rarity: 1, formality: 4.5 });
});

test('격식 목표 = 행사 목표 + 관계 보정, 0~만점으로 제한', () => {
  assert.equal(formalityTarget(testConfig, 'funeral', 'senior', 10), 8.5);
  assert.equal(formalityTarget(testConfig, 'birthday', 'family', 10), 2.5);
  const extreme = { ...testConfig, events: { ...testConfig.events, longevity: { ...testConfig.events.longevity, formalityTarget: 10 } } };
  assert.equal(formalityTarget(extreme, 'longevity', 'senior', 10), 10);
});

test('target 지표는 목표에 가까울수록 실효 점수가 높다', () => {
  // 장례/상급자 목표 8.5
  const near = scoreForSituation(testConfig, attrs(1, { scores: { rarity: 5, formality: 8 } }), 'funeral', 'senior');
  const far = scoreForSituation(testConfig, attrs(2, { scores: { rarity: 5, formality: 3 } }), 'funeral', 'senior');
  const nearF = near.indicators.find((c) => c.id === 'formality')!;
  const farF = far.indicators.find((c) => c.id === 'formality')!;
  assert.equal(nearF.target, 8.5);
  assert.equal(nearF.effective, 9.3); // 10 - 0.5 × 1.5 = 9.25
  assert.equal(farF.effective, 1.8); // 10 - 5.5 × 1.5 = 1.75
  assert.ok(near.formalityIndex > far.formalityIndex);
});

test('격식이 너무 높아도 가벼운 자리에서는 손해를 본다', () => {
  // 생일/가족 목표 2.5: 격식 10짜리보다 격식 3짜리가 유리
  const formal = scoreForSituation(testConfig, attrs(1, { scores: { rarity: 5, formality: 10 } }), 'birthday', 'family');
  const casual = scoreForSituation(testConfig, attrs(2, { scores: { rarity: 5, formality: 3 } }), 'birthday', 'family');
  assert.ok(casual.formalityIndex > formal.formalityIndex);
});

test('지표별 기여 점수의 합이 formalityIndex와 같다', () => {
  const s = scoreForSituation(testConfig, attrs(1, { scores: { rarity: 7, formality: 6 } }), 'wedding', 'business');
  const sum = s.indicators.reduce((acc, c) => acc + c.points, 0);
  assert.ok(Math.abs(sum - s.formalityIndex) < 0.2);
});

test('행사 태그 일치는 가산, 불일치는 감점, 관계 일치는 가산', () => {
  const fit = scoreForSituation(testConfig, attrs(1, { events: ['funeral'], relations: ['senior'] }), 'funeral', 'senior');
  assert.deepEqual(fit.bonuses.map((b) => b.points), [8, 4]);
  const miss = scoreForSituation(testConfig, attrs(1, { events: ['birthday'], relations: [] }), 'funeral', 'senior');
  assert.deepEqual(miss.bonuses.map((b) => b.points), [-12]);
});

test('matchScore는 0~100 사이', () => {
  const top = scoreForSituation(testConfig, attrs(1, { scores: { rarity: 10, formality: 8.5 } }), 'funeral', 'senior');
  assert.equal(top.matchScore, 100);
  const bottom = scoreForSituation(testConfig, attrs(2, { scores: { rarity: 0, formality: 0 }, events: [] }), 'funeral', 'peer');
  assert.ok(bottom.matchScore >= 0);
});

test('baseIndex는 상황과 무관한 지표 평균(100점 환산)', () => {
  assert.equal(baseIndex(testConfig, attrs(1, { scores: { rarity: 8, formality: 6 } })), 70);
});
