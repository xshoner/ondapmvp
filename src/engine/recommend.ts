// 추천 엔진: 행사 정보 → 상위 N개 상품
//
// 1) 거르기: 고객이 뺀 상품, 미진열·판매중지·품절, 지표 미입력, 해당 행사 금지 상품, 예산 초과
// 2) 점수: scoreForSituation (격식지수 + 상황 적합 보너스)
// 3) 순위: matchScore ↓ → 격식 적합도 ↓ → 예산과 가까운 가격 → 상품번호 ↑  (같은 입력이면 항상 같은 결과)
// 4) 다양성: 순위대로 고르되 같은 카테고리는 maxPerCategory개까지. 모자라면 남은 순위대로 채운다
// 5) 결과가 부족하면 예산을 budgetRelaxRatio배까지 한 번 늘려 다시 찾는다
//
// AI는 순위를 바꾸지 않는다. 추천 이유 문구는 결과의 점수 내역으로 별도 생성한다.

import { baseIndex, scoreForSituation } from './formality.ts';
import { buildReason, tierFor } from './explain.ts';
import type {
  Catalog,
  Exclusion,
  ProductAttributes,
  RecommendInput,
  RecommendResult,
  ScoredProduct,
} from './types.ts';

// 거르기 + 점수순 전체 순위 (다양성 고르기 전). 관리자 진단 화면도 쓴다
export function filterAndScore(
  catalog: Catalog,
  input: RecommendInput,
  budgetMax: number | undefined,
): { candidates: ScoredProduct[]; excluded: Exclusion[] } {
  const { config } = catalog;
  const attrByNo = new Map<number, ProductAttributes>(catalog.attributes.map((a) => [a.productNo, a]));
  const candidates: ScoredProduct[] = [];
  const excluded: Exclusion[] = [];
  const skipped = new Set(input.exclude ?? []);

  for (const product of catalog.products) {
    const exclude = (reason: string) => excluded.push({ productNo: product.productNo, name: product.name, reason });

    if (skipped.has(product.productNo)) { exclude('고객이 뺀 상품'); continue; }
    if (!product.display || !product.selling) { exclude('미진열 또는 판매중지'); continue; }
    if (product.soldOut) { exclude('품절'); continue; }

    const attrs = attrByNo.get(product.productNo);
    if (!attrs) { exclude('지표 미입력'); continue; }

    const banned = attrs.excludedEvents.find((x) => x.event === input.event);
    if (banned) { exclude(`${config.events[input.event].name} 제외: ${banned.reason}`); continue; }

    if (budgetMax !== undefined && product.price > budgetMax) {
      exclude(`예산 초과 (${product.price.toLocaleString('ko-KR')}원)`);
      continue;
    }

    const breakdown = scoreForSituation(config, attrs, input.event, input.relation);
    candidates.push({
      product,
      attributes: attrs,
      baseIndex: baseIndex(config, attrs),
      ...breakdown,
      tier: tierFor(config, attrs.scores.formality ?? 0),
      reason: buildReason(config, input, product.name, attrs, breakdown.indicators),
    });
  }

  const target = budgetMax ?? 0;
  candidates.sort(
    (a, b) =>
      b.matchScore - a.matchScore ||
      (b.attributes.scores.formality ?? 0) - (a.attributes.scores.formality ?? 0) ||
      (budgetMax !== undefined ? Math.abs(target - a.product.price) - Math.abs(target - b.product.price) : 0) ||
      a.product.productNo - b.product.productNo,
  );
  return { candidates, excluded };
}

function pickDiverse(ranked: ScoredProduct[], count: number, maxPerCategory: number): ScoredProduct[] {
  const picked: ScoredProduct[] = [];
  const perCategory = new Map<string, number>();
  for (const c of ranked) {
    if (picked.length === count) break;
    const n = perCategory.get(c.attributes.category) ?? 0;
    if (n >= maxPerCategory) continue;
    picked.push(c);
    perCategory.set(c.attributes.category, n + 1);
  }
  for (const c of ranked) {
    if (picked.length === count) break;
    if (!picked.includes(c)) picked.push(c);
  }
  // 채우기로 들어온 상품이 있어도 최종 표시는 점수 순서를 따른다
  return picked.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
}

export function recommend(catalog: Catalog, input: RecommendInput): RecommendResult {
  const count = catalog.config.resultCount;
  let { candidates, excluded } = filterAndScore(catalog, input, input.budgetMax);
  let relaxedBudget: number | null = null;

  if (candidates.length < count && input.budgetMax !== undefined) {
    const relaxed = Math.round(input.budgetMax * catalog.config.budgetRelaxRatio);
    const retry = filterAndScore(catalog, input, relaxed);
    if (retry.candidates.length > candidates.length) {
      ({ candidates, excluded } = retry);
      relaxedBudget = relaxed;
    }
  }

  const results = pickDiverse(candidates, count, catalog.config.diversity.maxPerCategory);
  let notice: string | null = null;
  if (relaxedBudget !== null) {
    notice = `예산 안에서 ${count}개를 찾지 못해 ${relaxedBudget.toLocaleString('ko-KR')}원까지 넓혀 추천했습니다.`;
  }
  if (results.length < count) {
    notice = `조건에 맞는 상품이 ${results.length}개뿐입니다. 예산이나 조건을 바꿔 보세요.`;
  }

  return { input, results, excluded, relaxedBudget, notice };
}
