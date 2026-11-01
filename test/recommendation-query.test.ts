import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFromSearchParams, recommendationResultHref } from '../src/recommendation/query.ts';
import { parseRecommendationRequest } from '../src/recommendation/validation.ts';
import { evaluateRecommendation } from '../src/recommendation/evaluate.ts';
import { createDraftPolicy } from '../src/recommendation/policy.ts';
import { sampleInputs, sampleRequest } from './fixtures/recommendation-inputs.ts';

function roundtrip(request: Parameters<typeof recommendationResultHref>[0]) {
  const href = recommendationResultHref(request);
  return requestFromSearchParams(Object.fromEntries(new URL(href, 'http://localhost').searchParams));
}
test('core query: legacy per-item URL and all budget modes roundtrip with quantity and exclusions', () => {
  const legacy = requestFromSearchParams({ event: 'wedding', relation: 'business', qty: '10', budget: '50000', exclude: '27' });
  assert.deepEqual(legacy.budget, { mode: 'per_item', amount: 50000 });
  for (const budget of [{ mode: 'per_item', amount: 50000 }, { mode: 'total', amount: 1000001 }, { mode: 'none' }] as const) {
    const r = { ...sampleRequest, budget, excludedProductNos: [27], sender: 'public' as const, purpose: 'return' as const };
    assert.deepEqual(roundtrip(r), parseRecommendationRequest(r));
  }
});
test('core query: a total budget smaller than quantity remains a budget and excludes positive-price products', () => {
  const request = roundtrip({ ...sampleRequest, budget: { mode: 'total', amount: 1 } });
  assert.deepEqual(request.budget, { mode: 'total', amount: 1 });
  const { products, assessments } = sampleInputs();
  const response = evaluateRecommendation(products, assessments, request, createDraftPolicy());
  assert.equal(response.items.length, 0);
  assert.equal(response.exclusions.every((e) => e.code === 'budget_exceeded'), true);
});
test('core query: quantity changes preserve original total rather than rounded per-item budget', () => {
  const params = { event: 'wedding', relation: 'business', qty: '3', budgetMode: 'total', budget: '333333', totalBudget: '1000001' };
  const r = requestFromSearchParams(params);
  const changed = roundtrip({ ...r, quantity: 7 });
  assert.deepEqual(changed.budget, { mode: 'total', amount: 1000001 });
  assert.equal(changed.quantity, 7);
});
test('core query: missing total source and invalid explicit budgets do not silently become no budget', () => {
  const base = { event: 'wedding', relation: 'business', qty: '10' };
  assert.throws(() => requestFromSearchParams({ ...base, budgetMode: 'total', budget: '50000' }), { code: 'invalid_input' });
  for (const budget of ['abc', '0', '-1', '100000001', '1.2']) assert.throws(() => requestFromSearchParams({ ...base, budget }), { code: 'invalid_input' });
  assert.equal(requestFromSearchParams(base).budget.mode, 'none');
});
