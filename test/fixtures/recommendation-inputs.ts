import { FACTOR_IDS, type ProductAssessment, type ProductSnapshot, type RecommendationRequest } from '../../src/recommendation/contracts.ts';

export function sampleProduct(productNo: number, price: number): ProductSnapshot {
  return { productNo, name: `[가상] 비교 상품 ${productNo}`, price, display: true, selling: true, soldOut: false, imageUrl: null, productUrl: `https://example.com/products/${productNo}` };
}
export function sampleAssessment(productNo: number, score = 8): ProductAssessment {
  return { productNo, description: '실제 상품·인증·생산자 정보가 아닌 테스트 자료입니다.', factors: Object.fromEntries(FACTOR_IDS.map((id) => [id, { score, basis: `[가상] ${id} 확인 근거`, method: 'numeric', rubricVersion: 'numeric-draft-1' }])) as ProductAssessment['factors'], reviewed: true, updatedAt: '2026-11-01T00:00:00.000Z', reviewedAt: '2026-11-01T00:00:00.000Z' };
}
export const sampleRequest: RecommendationRequest = { event: 'wedding', relation: 'business', quantity: 10, budget: { mode: 'per_item', amount: 50000 }, excludedProductNos: [] };
export function sampleInputs() {
  const products = [sampleProduct(900001, 22000), sampleProduct(900002, 18000), sampleProduct(900003, 30000)];
  const assessments = [sampleAssessment(900001, 8), sampleAssessment(900002, 9), sampleAssessment(900003, 7)];
  assessments[2].factors.locality.score = 8;
  for (const key of ['distribution', 'history', 'story'] as const) assessments[2].factors[key] = { score: null, basis: '', method: 'numeric', rubricVersion: null };
  return { products, assessments, request: structuredClone(sampleRequest) };
}
