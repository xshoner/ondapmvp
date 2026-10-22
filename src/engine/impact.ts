// 관리자 진단: 상품 지표를 바꾸면 어느 상황의 추천이 달라지는지(바꾸면 무엇이 달라지나),
// 이 상품이 상황마다 몇 위이고 왜 빠지는지(이 상품은 왜 추천 안 되나). 엔진을 그대로 돌리는 순수 함수다.

import { eventIds, relationIds } from './labels.ts';
import { filterAndScore, recommend } from './recommend.ts';
import type { Catalog, EventType, ProductAttributes, Relation } from './types.ts';

export interface Scenario { event: EventType; relation: Relation }

// 행사 × 관계 전부 (알고리즘 검증 화면과 같은 32가지)
export function allScenarios(catalog: Catalog): Scenario[] {
  return eventIds(catalog.config).flatMap((event) => relationIds(catalog.config).map((relation) => ({ event, relation })));
}

// 한 상품의 지표만 바꾼 카탈로그
export function withAttributes(catalog: Catalog, next: ProductAttributes): Catalog {
  const others = catalog.attributes.filter((a) => a.productNo !== next.productNo);
  return { ...catalog, attributes: [...others, next] };
}

export interface ImpactRow extends Scenario {
  before: number[]; // 바꾸기 전 추천 상품번호 (순위대로)
  after: number[];
  firstChanged: boolean;
  entered: boolean; // 이 상품이 새로 추천에 들어감
  left: boolean; // 이 상품이 추천에서 빠짐
}

// 저장된 지표와 고치는 중인 지표로 모든 상황을 돌려 결과가 달라지는 상황만 돌려준다
export function changeImpact(catalog: Catalog, draft: ProductAttributes, budgetMax?: number): ImpactRow[] {
  const next = withAttributes(catalog, draft);
  const rows: ImpactRow[] = [];
  for (const s of allScenarios(catalog)) {
    const input = { ...s, budgetMax };
    const before = recommend(catalog, input).results.map((x) => x.product.productNo);
    const after = recommend(next, input).results.map((x) => x.product.productNo);
    const had = before.includes(draft.productNo);
    const has = after.includes(draft.productNo);
    const firstChanged = before[0] !== after[0];
    if (firstChanged || had !== has) rows.push({ ...s, before, after, firstChanged, entered: !had && has, left: had && !has });
  }
  return rows;
}

export type Standing =
  | { kind: 'shown'; rank: number } // 추천 결과 n위
  | { kind: 'diversity'; rank: number } // 점수로는 n위지만 같은 분류 상품이 먼저 들어가 빠짐
  | { kind: 'below'; rank: number; gap: number } // 점수 n위, 마지막 추천과 gap점 차이
  | { kind: 'excluded'; reason: string }; // 거르기에서 빠짐 (품절, 행사 제외, 예산 초과 등)

export function standing(catalog: Catalog, productNo: number, s: Scenario, budgetMax?: number): Standing {
  const result = recommend(catalog, { ...s, budgetMax });
  const shown = result.results.findIndex((x) => x.product.productNo === productNo);
  if (shown !== -1) return { kind: 'shown', rank: shown + 1 };
  const excluded = result.excluded.find((x) => x.productNo === productNo);
  if (excluded) return { kind: 'excluded', reason: excluded.reason };
  // 엔진이 예산을 넓혀 찾았으면 같은 예산으로 순위를 다시 매긴다
  const { candidates } = filterAndScore(catalog, { ...s, budgetMax }, result.relaxedBudget ?? budgetMax);
  const i = candidates.findIndex((x) => x.product.productNo === productNo);
  if (i === -1) return { kind: 'excluded', reason: '추천 대상 아님' };
  if (i < catalog.config.resultCount) return { kind: 'diversity', rank: i + 1 };
  const last = result.results[result.results.length - 1];
  const gap = last ? Math.round((last.matchScore - candidates[i].matchScore) * 10) / 10 : 0;
  return { kind: 'below', rank: i + 1, gap };
}
