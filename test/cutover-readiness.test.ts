import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationServices } from '../src/recommendation/services.ts';
import { createDraftPolicy } from '../src/recommendation/policy.ts';
import { validateProductSnapshot } from '../src/cafe24/sync-rules.ts';
import type { CoreData } from '../src/recommendation/store.ts';
import type { ProductAssessment, ProductSnapshot } from '../src/recommendation/contracts.ts';

function makeServices(state: CoreData) {
  return createRecommendationServices({
    async requireAdmin() {},
    async loadStore() {
      return {
        load: async () => structuredClone(state),
        saveAssessment: async (a) => a,
        savePolicy: async (p) => ({ policy: p, updatedAt: new Date().toISOString() }),
      };
    },
    async suggest(productNo, sourceDescription) {
      const blank = { score: null, basis: '', method: 'numeric' as const, rubricVersion: null };
      return {
        productNo,
        sourceDescription,
        factors: { skill: blank, locality: blank, distribution: blank, history: blank, story: blank },
        rubricVersion: 'rubric-v1',
      };
    },
  });
}

const baseCookie: ProductSnapshot = {
  productNo: 11,
  name: '수제 쿠키 답례품',
  price: 12000,
  display: true,
  selling: true,
  soldOut: false,
  imageUrl: 'https://dapcue.cafe24.com/web/product/big/202611/cookie.jpg',
  productUrl: 'https://dapcue.cafe24.com/product/detail.html?product_no=11',
  excludedEvents: [],
};

test('새 몰 전환 초기(상품 0개 · 미검수 1개 · 검수 1개) 추천 및 동기화 경계가 안전하게 동작한다', async () => {
  const policy = createDraftPolicy();
  const request = { event: 'thanks' as const, relation: 'peer' as const, quantity: 10, budget: { mode: 'none' as const }, excludedProductNos: [] };

  // 1. 상품 0개: 오류 없이 no_candidates 안내 반환
  const emptyRes = await makeServices({ products: [], assessments: [], policy: { policy, updatedAt: null } }).recommend(request);
  assert.equal(emptyRes.ok, true);
  if (emptyRes.ok) {
    assert.equal(emptyRes.data.items.length, 0);
    assert.ok(emptyRes.data.notices.some((n) => n.code === 'no_candidates'));
  }

  // 2. 새 상품 11 등록 직후(미검수): 옛 근거를 빌려오지 않고 unreviewed 제외
  const unreviewedRes = await makeServices({ products: [baseCookie], assessments: [], policy: { policy, updatedAt: null } }).recommend(request);
  assert.equal(unreviewedRes.ok, true);
  if (unreviewedRes.ok) {
    assert.equal(unreviewedRes.data.items.length, 0);
    assert.equal(unreviewedRes.data.exclusions[0]?.code, 'unreviewed');
  }

  // 3. 새 상품 11 신규 검수 완료 시 1개 추천 및 few_candidates 안내
  const reviewedCookie: ProductAssessment = {
    productNo: 11,
    description: '국내 공방 소량 수제 구움 쿠키',
    reviewed: true,
    updatedAt: '2026-11-11T00:00:00.000Z',
    reviewedAt: '2026-11-11T00:00:00.000Z',
    factors: {
      skill: { score: 7, basis: '국내 공방 소량 수제 구움 쿠키', method: 'numeric', rubricVersion: 'rubric-v1' },
      locality: { score: 6, basis: '국내 공방 제조', method: 'numeric', rubricVersion: 'rubric-v1' },
      distribution: { score: null, basis: '', method: 'numeric', rubricVersion: null },
      history: { score: null, basis: '', method: 'numeric', rubricVersion: null },
      story: { score: null, basis: '', method: 'numeric', rubricVersion: null },
    },
  };
  const reviewedRes = await makeServices({ products: [baseCookie], assessments: [reviewedCookie], policy: { policy, updatedAt: null } }).recommend(request);
  assert.equal(reviewedRes.ok, true);
  if (reviewedRes.ok) {
    assert.equal(reviewedRes.data.items.length, 1);
    assert.equal(reviewedRes.data.items[0].productNo, 11);
    assert.ok(reviewedRes.data.notices.some((n) => n.code === 'few_candidates'));
  }

  // 4. 빈 DB에서 1개 상품으로 초기 스냅샷 검증 통과
  assert.doesNotThrow(() => validateProductSnapshot([{
    productNo: 11,
    name: '수제 쿠키 답례품',
    price: 12000,
    display: true,
    selling: true,
    soldOut: false,
    image: null,
    detailImage: null,
    url: 'https://dapcue.cafe24.com/product/detail.html?product_no=11',
  }], []));
});
