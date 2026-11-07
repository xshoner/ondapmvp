import { CONTRACT_VERSION, FACTOR_IDS, type AssessmentMethod, type ExclusionCode, type ProductAssessment, type ProductSnapshot, type RecommendationItem, type RecommendationResponse } from './contracts.ts';
import { ContractError, parseProductAssessment, parseRecommendationPolicy, parseRecommendationRequest } from './validation.ts';

function webUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}

// 저장·네트워크·AI 호출이 없는 순수 추천 엔진.
export function evaluateRecommendation(products: readonly ProductSnapshot[], rawAssessments: readonly unknown[], rawRequest: unknown, rawPolicy: unknown): RecommendationResponse {
  const request = parseRecommendationRequest(rawRequest);
  const policy = parseRecommendationPolicy(rawPolicy);
  if (products.length > 5000 || rawAssessments.length > 5000) throw new ContractError('catalog', '상품과 평가 자료는 각각 최대 5,000개입니다.');
  const assessments = new Map<number, ProductAssessment>();
  for (const raw of rawAssessments) {
    const assessment = parseProductAssessment(raw);
    if (assessments.has(assessment.productNo)) throw new ContractError('assessments', '상품 평가가 중복되었습니다.');
    assessments.set(assessment.productNo, assessment);
  }
  const F = Math.max(0, Math.min(100, policy.eventBase[request.event] + policy.relationShift[request.relation] + policy.senderShift[request.sender ?? 'unknown'] + policy.purposeShift[request.purpose ?? 'unknown']));
  const band = policy.rarityBands.findLast((b) => F >= b.from)!;
  const excluded = new Set(request.excludedProductNos);
  const seen = new Set<number>();
  const candidates: RecommendationItem[] = [];
  const exclusions: RecommendationResponse['exclusions'] = [];
  for (const product of products) {
    if (!Number.isSafeInteger(product.productNo) || product.productNo < 1 || seen.has(product.productNo)) throw new ContractError('products', '상품번호가 잘못되었거나 중복되었습니다.');
    seen.add(product.productNo);
    const reject = (code: ExclusionCode, message: string) => { exclusions.push({ productNo: product.productNo, code, message }); };
    const subtotal = product.price * request.quantity;
    if (!Number.isSafeInteger(product.price) || product.price < 0 || !Number.isSafeInteger(subtotal) || typeof product.name !== 'string' || !product.name.trim() || !webUrl(product.productUrl) || (product.imageUrl !== null && !webUrl(product.imageUrl)) || [product.display, product.selling, product.soldOut].some((value) => typeof value !== 'boolean')) { reject('invalid_product', '상품의 가격·표시 정보를 확인해 주세요.'); continue; }
    if (!product.display || !product.selling || product.soldOut) { reject('unavailable', '품절·미진열·판매 중지 상품입니다.'); continue; }
    if (excluded.has(product.productNo)) { reject('customer_excluded', '고객이 제외한 상품입니다.'); continue; }
    if (product.excludedEvents?.includes(request.event)) { reject('event_excluded', '해당 행사에서 제외된 상품입니다.'); continue; }
    const assessment = assessments.get(product.productNo);
    if (!assessment?.reviewed) { reject('unreviewed', 'v2 검수 완료 자료가 없습니다.'); continue; }
    const used = FACTOR_IDS.flatMap((id) => {
      const f = assessment.factors[id];
      const weight = policy.rarityWeights[id];
      return f.score !== null && f.basis.trim() && weight > 0 && (f.method === 'legacy-level' || f.rubricVersion?.trim()) ? [{ score: f.score, weight, method: f.method, rubricVersion: f.rubricVersion! }] : [];
    });
    if (used.length < policy.minimumEvidenceCount) { reject('insufficient_evidence', '유효한 평가 근거가 부족합니다.'); continue; }
    // 부동소수점 오차로 허용 경계의 상품이 잘못 탈락하지 않도록 평가 정밀도를 고정한다.
    const R = Math.round(10 * used.reduce((sum, f) => sum + f.score * f.weight, 0) / used.reduce((sum, f) => sum + f.weight, 0) * 1e12) / 1e12;
    if (R < band.min || R > band.max) { reject('rarity_outside', '행사에 설정된 희소값 허용 범위를 벗어났습니다.'); continue; }
    let budgetRatio: number | null = null;
    if (request.budget.mode !== 'none') {
      const amount = request.budget.mode === 'total' ? subtotal : product.price;
      if (amount > request.budget.amount) { reject('budget_exceeded', '상품비가 예산 한도를 초과합니다.'); continue; }
      budgetRatio = amount / request.budget.amount;
    }
    const E = Math.max(0, 100 - Math.abs(R - F));
    const V = budgetRatio === null ? null : budgetRatio < 0.7 ? 100 * (0.3 + budgetRatio) : budgetRatio <= 0.95 ? 100 : 100 * (1 - 6 * (budgetRatio - 0.95));
    const S = Math.max(0, Math.min(100, V === null ? E : (E * policy.scoreWeights.eventFit + V * policy.scoreWeights.priceValue) / (policy.scoreWeights.eventFit + policy.scoreWeights.priceValue)));
    const methods = new Set(used.map((f) => f.method));
    const assessmentMethod: AssessmentMethod = methods.size > 1 ? 'mixed' : used[0].method;
    candidates.push({ productNo: product.productNo, name: product.name, unitPrice: product.price, itemSubtotal: subtotal, imageUrl: product.imageUrl, productUrl: product.productUrl, eventFormality: F, rarityValue: R, evidenceCount: used.length, assessmentMethod, assessmentUpdatedAt: assessment.updatedAt, rubricVersions: [...new Set(used.map((f) => f.rubricVersion))].sort(), eventFitScore: E, priceValueScore: V, recommendationScore: S, rank: 0, reasons: ['검수 자료와 행사 희소 기준을 충족합니다.', V === null ? '예산 제한 없이 행사 적합도로 비교했습니다.' : '행사 적합도와 예산 내 가격 실속으로 비교했습니다.'] });
  }
  candidates.sort((a, b) => b.recommendationScore - a.recommendationScore || b.eventFitScore - a.eventFitScore || a.unitPrice - b.unitPrice || a.productNo - b.productNo);
  const standard = candidates[0];
  const remaining = candidates.slice(1);
  const practical = [...remaining].sort((a, b) => a.unitPrice - b.unitPrice || b.eventFitScore - a.eventFitScore || a.productNo - b.productNo)[0];
  const formal = remaining.filter((x) => x.productNo !== practical?.productNo).sort((a, b) => b.rarityValue - a.rarityValue || b.eventFitScore - a.eventFitScore || a.unitPrice - b.unitPrice || a.productNo - b.productNo)[0];
  const items: RecommendationItem[] = [];
  if (standard) items.push({ ...standard, rank: 1, slot: 'standard', reasons: [standard.priceValueScore === null ? '적격 상품 중 행사 적합도가 가장 높습니다.' : '적격 상품 중 행사 적합도와 예산 사용 비율을 종합한 점수가 가장 높습니다.', ...standard.reasons] });
  if (practical) items.push({ ...practical, rank: 2, slot: 'practical', reasons: ['표준안을 제외한 적격 상품 중 단가가 가장 낮습니다.', ...practical.reasons] });
  if (formal) items.push({ ...formal, rank: 3, slot: 'formal', reasons: [`표준안과 실속안을 제외한 적격 상품 중 상품 특성 점수가 가장 높습니다 (${formal.rarityValue.toFixed(1)}점).${formal.rarityValue < standard.rarityValue ? ` 표준안의 상품 특성 점수는 ${standard.rarityValue.toFixed(1)}점입니다.` : ''}`, ...formal.reasons] });
  const notices: RecommendationResponse['notices'] = [];
  if (items.length === 0) notices.push({ code: 'no_candidates', message: '조건에 맞는 상품이 없습니다. 조건 또는 제외 사유를 확인해 주세요.' });
  else if (items.length < 3) notices.push({ code: 'few_candidates', message: `조건을 충족한 상품은 ${items.length}개입니다. 기준을 자동 완화하지 않았습니다.` });
  if (items.some((i) => i.assessmentMethod !== 'numeric')) notices.push({ code: 'legacy_assessment', message: '과거 수준형 평가가 포함되어 있습니다. 새 수치형 평가와 구분해 확인해 주세요.' });
  return { contractVersion: CONTRACT_VERSION, algorithmVersion: 'three-plans-v1', policyVersion: policy.version, request, items, exclusions, notices };
}
