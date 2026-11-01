import { parseResultQuery, resultHref } from '../lib/result-query.ts';
import type { RecommendationRequest } from './contracts.ts';
import { ContractError, parseRecommendationRequest } from './validation.ts';

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;

// 기존 URL의 전체 예산 원본을 사용한다. 나눈 개당 값으로 총액을 역산하지 않는다.
export function requestFromSearchParams(params: SearchParams): RecommendationRequest {
  const q = parseResultQuery(params);
  if (q.budgetMode === 'total' && q.totalBudget == null) throw new ContractError('totalBudget', '전체 예산 원본이 필요합니다. 예산을 다시 입력해 주세요.');
  const rawAmount = first(q.budgetMode === 'total' ? params.totalBudget : params.budget);
  if (rawAmount !== undefined && rawAmount !== '' && (!Number.isSafeInteger(Number(rawAmount)) || Number(rawAmount) < 1 || Number(rawAmount) > 100000000)) throw new ContractError('budget.amount', '예산 금액을 확인해 주세요.');
  return parseRecommendationRequest({
    event: q.event, relation: q.relation, quantity: q.qty,
    budget: q.budgetMode === 'total' ? { mode: 'total', amount: q.totalBudget } : q.budget === null ? { mode: 'none' } : { mode: 'per_item', amount: q.budget },
    excludedProductNos: q.exclude, sender: first(params.sender), purpose: first(params.purpose),
  });
}

export function recommendationResultHref(raw: RecommendationRequest): string {
  const request = parseRecommendationRequest(raw);
  const budget = request.budget;
  const href = resultHref({
    event: request.event, relation: request.relation, qty: request.quantity, exclude: request.excludedProductNos,
    budget: budget.mode === 'none' ? null : budget.mode === 'per_item' ? budget.amount : Math.floor(budget.amount / request.quantity) || null,
    ...(budget.mode === 'total' ? { budgetMode: 'total', totalBudget: budget.amount } : budget.mode === 'per_item' ? { budgetMode: 'per_item' } : {}),
  });
  const [path, search] = href.split('?');
  const params = new URLSearchParams(search);
  if (request.sender !== 'unknown') params.set('sender', request.sender!);
  if (request.purpose !== 'unknown') params.set('purpose', request.purpose!);
  return `${path}?${params}`;
}
