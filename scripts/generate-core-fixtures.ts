import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionResult, RecommendationRequest, RecommendationResponse } from '../src/recommendation/contracts.ts';
import { evaluateRecommendation } from '../src/recommendation/evaluate.ts';
import { createDraftPolicy } from '../src/recommendation/policy.ts';
import { createDraftRubric } from '../src/recommendation/rubric.ts';
import { parseProductAssessment } from '../src/recommendation/validation.ts';
import { sampleInputs } from '../test/fixtures/recommendation-inputs.ts';

const policy = createDraftPolicy();
const inputs = sampleInputs();
const legacy = { productNo: 900001, reviewed: true, description: '[가상] 과거 수준형 자료', factors: { skill: { level: 'high', basis: '[가상] 과거 숙련 근거' }, locality: { level: 'high', basis: '[가상] 과거 지역 근거' } } };
const mixed = parseProductAssessment(legacy);
mixed.factors.story = { score: 9, basis: '[가상] 새 이야기 근거', method: 'numeric', rubricVersion: 'numeric-draft-1' };

function response(request: RecommendationRequest, assessments: readonly unknown[] = inputs.assessments, products = inputs.products): RecommendationResponse {
  return evaluateRecommendation(products, assessments, request, policy);
}
const errors = {
  aiFailed: { ok: false, error: { code: 'ai_failed', message: 'AI 제안을 받지 못했습니다. 작성 내용은 유지됩니다.' } },
  saveConflict: { ok: false, error: { code: 'revision_conflict', message: '다른 저장 내용이 있습니다. 현재 입력을 보존하고 최신 자료를 확인해 주세요.' } },
  saveFailed: { ok: false, error: { code: 'save_failed', message: '저장하지 못했습니다. 입력을 유지한 상태로 다시 시도해 주세요.' } },
  invalidInput: { ok: false, error: { code: 'invalid_input', message: '예산을 확인해 주세요.', fields: { 'budget.amount': '1원 이상의 정수 금액이 필요합니다.' } } },
} satisfies Record<string, ActionResult<never>>;
const fixture = {
  fixtureVersion: 'core-contract-v1', fictional: true,
  warning: '실상품·실제 평가·운영 정책이 아닌 UI 개발용 가상 자료입니다. 운영 DB에 저장하지 마세요.',
  rubric: createDraftRubric(), policy: { policy, updatedAt: '2026-11-01T00:00:00.000Z' },
  products: inputs.products,
  workspace: { products: inputs.products, assessments: inputs.assessments, policy: { policy, updatedAt: '2026-11-01T00:00:00.000Z' }, rubric: createDraftRubric() },
  assessments: { numeric: inputs.assessments[0], legacy: parseProductAssessment(legacy), mixed },
  recommendations: [
    { id: 'three', response: response(inputs.request) },
    { id: 'one', response: response({ ...inputs.request, excludedProductNos: [900002, 900003] }) },
    { id: 'none', response: response({ ...inputs.request, budget: { mode: 'per_item', amount: 1 } }) },
    { id: 'no-budget', response: response({ ...inputs.request, budget: { mode: 'none' } }) },
    { id: 'total-budget', response: response({ ...inputs.request, budget: { mode: 'total', amount: 500000 } }) },
    { id: 'tiny-total-budget', response: response({ ...inputs.request, budget: { mode: 'total', amount: 1 } }) },
    { id: 'legacy', response: response(inputs.request, [legacy], [inputs.products[0]]) },
    { id: 'mixed', response: response(inputs.request, [mixed], [inputs.products[0]]) },
    { id: 'unreviewed', response: response(inputs.request, inputs.assessments.map((a) => ({ ...a, reviewed: false }))) },
  ],
  errors,
};
const dir = join(process.cwd(), 'docs', 'fixtures');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'recommendation-core-v1.json'), JSON.stringify(fixture, null, 2) + '\n');
console.log('가상 UI fixture 9종과 오류 4종을 docs/fixtures/recommendation-core-v1.json에 생성했습니다.');
