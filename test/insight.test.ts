import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetBand, unmetDemand } from '../src/stats/summary.ts';
import { isFeedbackReason, summarizeFeedback } from '../src/lib/feedback.ts';

const rec = (event: string, relation: string, budgetMax: number | null, nos: number[]) => ({ createdAt: '2026-10-22T00:00:00Z', event, relation, budgetMax, resultProductNos: nos });

test('찾았지만 없던 것: 결과 부족·예산 넓힘을 조건별로 센다', () => {
  const prices = new Map([[1, 25000], [2, 28000], [3, 39000], [4, 90000]]);
  const rows = unmetDemand([
    rec('funeral', 'senior', 30000, [1, 2]), // 부족
    rec('funeral', 'senior', 30000, [1, 2, 3]), // 3번이 3만 원 넘음 → 예산 넓힘
    rec('funeral', 'senior', 28000, [1, 2]), // 같은 '3만 원 이하' 묶음, 부족
    rec('wedding', 'peer', null, [1, 2, 4]), // 문제없음
    rec('wedding', 'peer', 100000, [1, 2, 4]),
  ], prices, 3);
  assert.deepEqual(rows, [{ event: 'funeral', relation: 'senior', band: '3만 원 이하', total: 3, short: 2, relaxed: 1 }]);
  assert.equal(budgetBand(null), '예산 상관없음');
  assert.equal(budgetBand(50000), '5만 원 이하');
  assert.equal(budgetBand(300000), '20만 원 넘게');
});

test('고객 목소리 집계: 도움 비율, 아쉬운 이유 순위, 행사별', () => {
  const s = summarizeFeedback([
    { createdAt: '', event: 'funeral', relation: 'senior', helpful: true, reasons: [] },
    { createdAt: '', event: 'funeral', relation: 'senior', helpful: false, reasons: ['price', 'kind'] },
    { createdAt: '', event: 'wedding', relation: 'peer', helpful: false, reasons: ['price', '모르는 이유'] },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.helpful, 1);
  assert.deepEqual(s.reasons, [{ id: 'price', count: 2 }, { id: 'kind', count: 1 }]);
  assert.deepEqual(s.byEvent[0], { id: 'funeral', total: 2, helpful: 1 });
  assert.equal(isFeedbackReason('price'), true);
  assert.equal(isFeedbackReason('__proto__'), false);
});

test('행사·관계 확인은 설정의 자체 키만 (constructor·__proto__ 거름)', async () => {
  const { isEvent, isRelation } = await import('../src/engine/labels.ts');
  const { testConfig } = await import('./fixtures.ts');
  assert.equal(isEvent(testConfig, 'funeral'), true);
  for (const bad of ['constructor', '__proto__', 'toString', '', null, 3]) {
    assert.equal(isEvent(testConfig, bad), false, String(bad));
    assert.equal(isRelation(testConfig, bad), false, String(bad));
  }
});
