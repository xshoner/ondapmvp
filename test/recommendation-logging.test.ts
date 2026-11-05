import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendationLogRow } from '../src/recommendation/logging.ts';
import { evaluateRecommendation } from '../src/recommendation/evaluate.ts';
import { createDraftPolicy } from '../src/recommendation/policy.ts';
import { sampleInputs } from './fixtures/recommendation-inputs.ts';

test('new recommendation log preserves ranking, quantity, version and tiny total budget', () => {
  const { products, assessments, request } = sampleInputs();
  const result = evaluateRecommendation(products, assessments, request, createDraftPolicy());
  const row = recommendationLogRow(result);
  assert.deepEqual(row.result_product_nos, result.items.map((item) => item.productNo));
  assert.equal(row.quantity, 10);
  assert.equal(row.budget_max, 50000);
  assert.equal(row.model_version, result.algorithmVersion);
  assert.equal(recommendationLogRow({ ...result, request: { ...request, budget: { mode: 'total', amount: 1 } } }).budget_max, 0);
  assert.equal(recommendationLogRow({ ...result, request: { ...request, budget: { mode: 'none' } } }).budget_max, null);
});
