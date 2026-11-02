import type { RecommendationResponse } from './contracts.ts';

// 기존 실적 집계용 열에 새 추천 결과를 기록한다. 점수를 다른 의미의 열에 복사하지 않는다.
export function recommendationLogRow(result: RecommendationResponse) {
  const { request, items } = result;
  return {
    event: request.event,
    relation: request.relation,
    budget_max: request.budget.mode === 'none' ? null : request.budget.mode === 'per_item' ? request.budget.amount : Math.floor(request.budget.amount / request.quantity),
    quantity: request.quantity,
    result_product_nos: items.map((item) => item.productNo),
    // shortcut: 기존 기록 열은 20자 한도다. 정책별 과거 결과 복원이 필요하면 별도 사본 저장을 추가한다.
    model_version: result.contractVersion,
  };
}
