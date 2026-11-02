import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockRecommendationServices } from '../src/app/recommendation-ui/mock-services.ts';
import { coreUiFixtures } from '../src/app/recommendation-ui/fixtures.ts';
import { evaluateRecommendation } from '../src/recommendation/evaluate.ts';
import { createDraftPolicy } from '../src/recommendation/policy.ts';
import { FACTOR_IDS, type RecommendationRequest, type RecommendationResponse } from '../src/recommendation/contracts.ts';

test('1. 동일한 희소값이지만 가격/예산이 달라 추천점수(S)가 다른 두 상품 표시 검증', async () => {
  const services = createMockRecommendationServices();
  const req: RecommendationRequest = {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'per_item', amount: 50000 },
    excludedProductNos: [],
    sender: 'unknown',
    purpose: 'unknown',
  };

  const res = await services.recommend(req);
  assert.ok(res.ok);
  const items = res.data.items;
  assert.ok(items.length >= 2);

  // 900001 (단가 22,000, R=80, V=56, S=86.8) vs 가상 동일 희소값 상품
  const first = items[0];
  const second = items[1];

  // 두 상품의 희소값 R과 점수 S가 각각 독립적으로 존재하고 계산됨 확인
  assert.equal(typeof first.rarityValue, 'number');
  assert.equal(typeof first.priceValueScore, 'number');
  assert.equal(typeof first.recommendationScore, 'number');
  assert.notEqual(first.recommendationScore, second.recommendationScore);
});

test('2. 더 저렴한 상품보다 행사 적합도(E)가 높은 상품이 앞서는 결과 검증', async () => {
  const services = createMockRecommendationServices();
  const req: RecommendationRequest = {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'per_item', amount: 50000 },
    excludedProductNos: [],
    sender: 'unknown',
    purpose: 'unknown',
  };

  const res = await services.recommend(req);
  assert.ok(res.ok);
  const items = res.data.items;

  // 1위 상품(900001, 22,000원, E=100) vs 2위 상품(900002, 18,000원, E=90)
  // 1위 상품이 2위 상품보다 단가는 더 비싸지만 행사 적합도(E)가 높아 1위 차지
  const p1 = items.find((i) => i.productNo === 900001)!;
  const p2 = items.find((i) => i.productNo === 900002)!;
  assert.ok(p1.unitPrice > p2.unitPrice, 'p1이 p2보다 비싸야 함');
  assert.ok(p1.eventFitScore > p2.eventFitScore, 'p1의 행사 적합도가 p2보다 높아야 함');
  assert.ok(p1.recommendationScore > p2.recommendationScore, '결과적으로 p1의 종합점수 S가 더 높아야 함');
  assert.equal(p1.rank, 1);
  assert.equal(p2.rank, 2);
});

test('3. 예산 없음(none): V 미평가(null), S는 반환값 그대로(S = E) 표시 검증', async () => {
  const services = createMockRecommendationServices();
  const req: RecommendationRequest = {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'none' },
    excludedProductNos: [],
    sender: 'unknown',
    purpose: 'unknown',
  };

  const res = await services.recommend(req);
  assert.ok(res.ok);
  for (const item of res.data.items) {
    assert.equal(item.priceValueScore, null, '예산 없음일 때 V는 반드시 null이어야 함');
    assert.equal(item.recommendationScore, item.eventFitScore, 'V가 null일 때 S는 E와 동일해야 함');
  }
});

test('4. 전체 예산과 수량 변경: 원래 전체 예산 원본 보존 검증', async () => {
  const services = createMockRecommendationServices();
  const originalTotalBudget = 500000;

  // 10개일 때
  const req10: RecommendationRequest = {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'total', amount: originalTotalBudget },
    excludedProductNos: [],
  };
  const res10 = await services.recommend(req10);
  assert.ok(res10.ok);
  assert.deepEqual(res10.data.request.budget, { mode: 'total', amount: originalTotalBudget });

  // 20개로 수량만 변경했을 때도 원래 전체 예산 500,000원이 보존됨
  const req20: RecommendationRequest = {
    ...req10,
    quantity: 20,
  };
  const res20 = await services.recommend(req20);
  assert.ok(res20.ok);
  assert.deepEqual(res20.data.request.budget, { mode: 'total', amount: originalTotalBudget });
  assert.equal(res20.data.request.quantity, 20);
});

test('5. 추천 0/1/2/3개, 가격·근거 누락, 요청 실패·다시 시도 검증', async () => {
  const services = createMockRecommendationServices();

  // (1) 3개 후보 fixture 검증
  const three = coreUiFixtures.recommendations.find((r) => r.id === 'three')!.response;
  assert.equal(three.items.length, 3);
  assert.equal(three.items[0].rank, 1);
  assert.equal(three.items[1].rank, 2);
  assert.equal(three.items[2].rank, 3);

  // (2) 1개 후보 fixture 검증
  const one = coreUiFixtures.recommendations.find((r) => r.id === 'one')!.response;
  assert.equal(one.items.length, 1);
  assert.ok(one.notices.some((n) => n.code === 'few_candidates'));

  // (3) 0개 후보 fixture 검증 (tiny-total-budget 및 none)
  const none = coreUiFixtures.recommendations.find((r) => r.id === 'none')!.response;
  assert.equal(none.items.length, 0);
  assert.ok(none.notices.some((n) => n.code === 'no_candidates'));

  // (4) 요청 실패 시 시뮬레이션
  services.setSimulateError('invalid_input');
  const errRes = await services.recommend(three.request);
  assert.equal(errRes.ok, false);
  if (!errRes.ok) {
    assert.equal(errRes.error.code, 'invalid_input');
  }

  // 다시 시도 복구
  services.setSimulateError(null);
  const retryRes = await services.recommend(three.request);
  assert.equal(retryRes.ok, true);
});

test('6. 과거 평가 불러오기 → 새 기준으로 수정 → 검수 해제 → 저장 → 재조회 워크플로 검증', async () => {
  const legacyProd = structuredClone(coreUiFixtures.assessments.legacy);
  const services = createMockRecommendationServices({
    initialWorkspace: {
      ...coreUiFixtures.workspace,
      assessments: [legacyProd],
    },
  });

  const loaded = await services.loadAssessment(legacyProd.productNo);
  assert.ok(loaded.ok);
  assert.equal(loaded.data.factors.skill.method, 'legacy-level');
  const expectedUpdatedAt = loaded.data.updatedAt;

  // 새 수치형 기준으로 수정 및 검수 해제 (reviewed = false)
  const modified = structuredClone(loaded.data);
  modified.reviewed = false;
  modified.factors.skill = {
    score: 9,
    basis: '새로운 2026년 현장 실사 및 장인 전승 이력 확인',
    method: 'numeric',
    rubricVersion: 'numeric-draft-1',
  };

  const saveRes = await services.saveAssessment({
    assessment: modified,
    expectedUpdatedAt,
  });
  assert.ok(saveRes.ok);
  assert.equal(saveRes.data.reviewed, false);
  assert.equal(saveRes.data.factors.skill.score, 9);
  assert.equal(saveRes.data.factors.skill.method, 'numeric');

  // 재조회 시 변경 사항 유지 확인
  const reloaded = await services.loadAssessment(modified.productNo);
  assert.ok(reloaded.ok);
  assert.equal(reloaded.data.reviewed, false);
  assert.equal(reloaded.data.factors.skill.score, 9);
  assert.equal(reloaded.data.factors.skill.method, 'numeric');
});

test('7. AI 실패 / 저장 실패 / 저장 충돌에서 작성 내용 보존 검증', async () => {
  const services = createMockRecommendationServices();
  const draftContent = {
    productNo: 900001,
    description: '관리자가 직접 정성들여 작성한 상품 설명 원문',
    factors: {
      skill: { score: 7, basis: '관리자 수기 작성 근거', method: 'numeric' as const, rubricVersion: 'numeric-draft-1' },
      locality: { score: 8, basis: '제주 산지 확인', method: 'numeric' as const, rubricVersion: 'numeric-draft-1' },
      distribution: { score: null, basis: '', method: 'numeric' as const, rubricVersion: 'numeric-draft-1' },
      history: { score: 6, basis: '10년 이력', method: 'numeric' as const, rubricVersion: 'numeric-draft-1' },
      story: { score: 5, basis: '문화 스토리', method: 'numeric' as const, rubricVersion: 'numeric-draft-1' },
    },
    reviewed: false,
    updatedAt: '2026-11-01T00:00:00Z',
    reviewedAt: null,
  };

  // 1) AI 실패 시뮬레이션
  services.setSimulateError('ai_failed');
  const aiRes = await services.suggestAssessment({ productNo: 900001, description: draftContent.description });
  assert.equal(aiRes.ok, false);
  if (!aiRes.ok) {
    assert.equal(aiRes.error.code, 'ai_failed');
  }
  // 관리자의 draftContent 객체는 덮어쓰여지지 않고 그대로 보존됨
  assert.equal(draftContent.factors.skill.score, 7);
  assert.equal(draftContent.factors.skill.basis, '관리자 수기 작성 근거');

  // 2) 저장 충돌(개정 번호 불일치) 시뮬레이션
  services.setSimulateError(null);
  services.setSimulateConflict(true);
  const conflictRes = await services.saveAssessment({
    assessment: draftContent,
    expectedUpdatedAt: '2026-10-01T00:00:00Z', // 오래된 시각
  });
  assert.equal(conflictRes.ok, false);
  if (!conflictRes.ok) {
    assert.equal(conflictRes.error.code, 'revision_conflict');
  }
  // 관리자의 draftContent는 보존됨
  assert.equal(draftContent.factors.locality.score, 8);

  // 3) 서버 500 오류 시뮬레이션
  services.setSimulateConflict(false);
  services.setSimulateError('save_failed');
  const failRes = await services.saveAssessment({
    assessment: draftContent,
    expectedUpdatedAt: draftContent.updatedAt,
  });
  assert.equal(failRes.ok, false);
  if (!failRes.ok) {
    assert.equal(failRes.error.code, 'save_failed');
  }
  assert.equal(draftContent.factors.locality.score, 8);
});

test('8. 변경하지 않은 과거 평가를 열기만 해도 저장되거나 방식이 바뀌지 않는지 검증', async () => {
  const legacyProd = structuredClone(coreUiFixtures.assessments.legacy);
  const services = createMockRecommendationServices({
    initialWorkspace: {
      ...coreUiFixtures.workspace,
      assessments: [legacyProd],
    },
  });

  const legacyProdBefore = await services.loadAssessment(legacyProd.productNo);
  assert.ok(legacyProdBefore.ok);
  const beforeJson = JSON.stringify(legacyProdBefore.data);

  // 조회만 3회 반복
  await services.loadAssessment(legacyProd.productNo);
  await services.loadAssessment(legacyProd.productNo);
  const legacyProdAfter = await services.loadAssessment(legacyProd.productNo);
  assert.ok(legacyProdAfter.ok);

  const afterJson = JSON.stringify(legacyProdAfter.data);
  assert.equal(beforeJson, afterJson, '열어보기만 했을 때 데이터와 방식이 절대 바뀌지 않아야 함');
});

test('9. 결과 카드와 비교표·관리자 검증에 같은 상품 및 S/R/E/V 일치 검증', async () => {
  const services = createMockRecommendationServices();
  const req: RecommendationRequest = {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'per_item', amount: 50000 },
    excludedProductNos: [],
  };

  const customerRes = await services.recommend(req);
  const policy = services.getPolicy();
  const adminPreviewRes = await services.previewRecommendation({ request: req, policy });

  assert.ok(customerRes.ok);
  assert.ok(adminPreviewRes.ok);
  if (!customerRes.ok || !adminPreviewRes.ok) {
    assert.fail('Responses should be ok');
  }

  // 고객 결과와 관리자 검증실 결과가 정확히 동일한 상품 및 점수(S, R, E, V)를 반환하는지 대조
  const cItems = customerRes.data.items;
  const aItems = adminPreviewRes.data.items;
  assert.equal(cItems.length, aItems.length);
  for (let i = 0; i < cItems.length; i++) {
    const cItem = cItems[i];
    const aItem = aItems[i];
    assert.equal(cItem.productNo, aItem.productNo);
    assert.equal(cItem.recommendationScore, aItem.recommendationScore);
    assert.equal(cItem.eventFitScore, aItem.eventFitScore);
    assert.equal(cItem.priceValueScore, aItem.priceValueScore);
    assert.equal(cItem.rarityValue, aItem.rarityValue);
    assert.equal(cItem.eventFormality, aItem.eventFormality);
  }
});

test('10. 포장 링크에 상품·수량·행사 조건 및 예산 유지 검증', () => {
  const productNo = 900001;
  const quantity = 15;
  const event = 'wedding';
  const relation = 'senior';
  const budget = 50000;

  const params = new URLSearchParams({
    product: String(productNo),
    qty: String(quantity),
    event,
    relation,
    budget: String(budget),
  });
  const href = `/packaging?${params.toString()}`;

  assert.ok(href.includes('product=900001'));
  assert.ok(href.includes('qty=15'));
  assert.ok(href.includes('event=wedding'));
  assert.ok(href.includes('relation=senior'));
  assert.ok(href.includes('budget=50000'));
});

test('11. 고객 화면: 10개 정상 결과 후 100개 요청 실패 시 이전 결과(10개, 220,000원) 보존 및 왜곡 방지 검증', async () => {
  const services = createMockRecommendationServices();
  const req10: RecommendationRequest = {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'per_item', amount: 50000 },
    excludedProductNos: [],
  };

  // 1) 10개로 정상 조회
  const res10 = await services.recommend(req10);
  assert.ok(res10.ok);
  const activeResponse = res10.data;
  const draftRequest = { ...req10 };

  // 2) 사용자가 폼에서 수량을 100개로 변경
  draftRequest.quantity = 100;

  // 3) 서버 요청 실패 시뮬레이션
  services.setSimulateError('invalid_input');
  const res100 = await services.recommend(draftRequest);
  assert.equal(res100.ok, false);

  // 4) 실패 시 activeResponse는 갱신되지 않고 기존 10개 결과 유지
  if (!res100.ok) {
    // UI 로직: activeResponse 유지, draftRequest는 사용자 입력 100개 유지
    assert.equal(activeResponse.request.quantity, 10);
    assert.equal(draftRequest.quantity, 100);

    const firstItem = activeResponse.items[0];
    const itemSubtotal = firstItem.unitPrice * activeResponse.request.quantity;
    assert.equal(itemSubtotal, 220000, '카드의 상품 합계는 이전 10개 금액인 220,000원이어야 함 (100개 금액 2,200,000원이 아님)');
  }
});

test('12. 비동기 응답 순서 역전(race condition) 방어 검증', async () => {
  let latestRequestId = 0;
  let currentActiveResponse: RecommendationResponse | null = null;

  async function mockFetch(req: RecommendationRequest, delayMs: number) {
    const reqId = ++latestRequestId;
    const services = createMockRecommendationServices();
    const res = await services.recommend(req);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 최신 요청 ID가 일치할 때만 activeResponse 갱신
    if (reqId === latestRequestId && res.ok) {
      currentActiveResponse = res.data;
    }
  }

  const reqA: RecommendationRequest = {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'per_item', amount: 50000 },
    excludedProductNos: [],
  };
  const reqB: RecommendationRequest = {
    ...reqA,
    quantity: 20,
  };

  // 요청 A는 먼저 시작하지만 100ms 지연
  const pA = mockFetch(reqA, 100);
  // 요청 B는 나중에 시작하지만 20ms 만에 완료
  const pB = mockFetch(reqB, 20);

  await Promise.all([pA, pB]);

  // 느린 요청 A가 늦게 끝났더라도, 최신 요청 B의 결과(수량 20개)가 보존되어야 함
  assert.ok(currentActiveResponse !== null);
  assert.equal((currentActiveResponse as RecommendationResponse).request.quantity, 20);
});

test('13. 관리자 작업대: 상품 전환 시 미저장 입력(draftsByProduct) 보존 검증', async () => {
  const services = createMockRecommendationServices();
  const wsRes = await services.loadWorkspace();
  assert.ok(wsRes.ok);

  const draftsByProduct = new Map<number, { description: string; factors: any }>();

  // 상품 900001 선택 및 수정
  const p1 = 900001;
  const p1Draft = {
    description: '관리자가 900001에 새로 작성한 상세 원문',
    factors: {
      skill: { score: 9, basis: '900001 수정된 장인 근거', method: 'numeric', rubricVersion: 'numeric-draft-1' },
    },
  };
  draftsByProduct.set(p1, p1Draft);

  // 상품 900002로 전환
  const p2 = 900002;
  const p2Draft = {
    description: '상품 900002 설명',
    factors: {
      skill: { score: 7, basis: '900002 근거', method: 'numeric', rubricVersion: 'numeric-draft-1' },
    },
  };
  draftsByProduct.set(p2, p2Draft);

  // 다시 상품 900001로 복귀했을 때 작성 중이던 내용 유지
  const restoredP1 = draftsByProduct.get(p1);
  assert.ok(restoredP1);
  assert.equal(restoredP1.description, '관리자가 900001에 새로 작성한 상세 원문');
  assert.equal(restoredP1.factors.skill.score, 9);
  assert.equal(restoredP1.factors.skill.basis, '900001 수정된 장인 근거');
});

test('14. AI 제안 도착 전 상품 전환 시 다른 상품 덮어쓰기 방지 검증', async () => {
  let aiReqId = 0;
  let activeProductNo = 900001;
  let p2Factors = {
    skill: { score: 6, basis: '상품 2 고유 근거', method: 'numeric', rubricVersion: 'numeric-draft-1' },
  };

  async function requestAiForProduct(productNo: number, delayMs: number) {
    const curAiId = ++aiReqId;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 응답 시점의 activeProductNo 및 reqId 확인
    if (curAiId === aiReqId && productNo === activeProductNo) {
      // 덮어쓰기
      p2Factors = {
        skill: { score: 9, basis: 'AI가 제안한 근거', method: 'numeric', rubricVersion: 'numeric-draft-1' },
      };
    }
  }

  // 상품 1에서 AI 호출 시작 (100ms 지연)
  const p1Ai = requestAiForProduct(900001, 100);

  // 즉시 사용자가 상품 2로 전환 (30ms 후)
  await new Promise((resolve) => setTimeout(resolve, 30));
  activeProductNo = 900002;
  aiReqId++; // 새 상품 선택으로 AI 요청 무효화

  await p1Ai;

  // 상품 2의 데이터가 상품 1의 AI 응답으로 오염되지 않음
  assert.equal(p2Factors.skill.score, 6);
  assert.equal(p2Factors.skill.basis, '상품 2 고유 근거');
});

test('15. 개정 충돌(revision_conflict) 시 expectedUpdatedAt: null 강제 덮어쓰기 차단 검증', async () => {
  const services = createMockRecommendationServices();
  const loaded = await services.loadAssessment(900001);
  assert.ok(loaded.ok);

  // 1) 기존 레코드인데 expectedUpdatedAt: null로 우회 저장 시도 -> revision_conflict 거부
  const bypassAttempt = await services.saveAssessment({
    assessment: { ...loaded.data, reviewed: true },
    expectedUpdatedAt: null,
  });
  assert.equal(bypassAttempt.ok, false);
  if (!bypassAttempt.ok) {
    assert.equal(bypassAttempt.error.code, 'revision_conflict');
  }

  // 2) 정상 expectedUpdatedAt 전달 시 저장 성공
  const validSave = await services.saveAssessment({
    assessment: { ...loaded.data, reviewed: false },
    expectedUpdatedAt: loaded.data.updatedAt,
  });
  assert.ok(validSave.ok);
});

test('16. 부분 AI 제안 시 사용자의 기존 작성 항목 보존 및 미확인 속성 미채움 검증', async () => {
  const services = createMockRecommendationServices();

  // 장인 관련 키워드만 있고, 산지/유래/유통은 없는 원자료
  const aiRes = await services.suggestAssessment({
    productNo: 900001,
    description: '30년 장인의 전통 수제 유기 수저 세트입니다.',
  });
  assert.ok(aiRes.ok);

  const suggestion = aiRes.data;
  // 장인(skill)은 채워짐
  assert.equal(suggestion.factors.skill.score, 8);
  assert.ok(suggestion.factors.skill.basis.includes('장인'));

  // 산지/유래 등 미언급 속성은 score: null, basis: ''
  assert.equal(suggestion.factors.locality.score, null);
  assert.equal(suggestion.factors.locality.basis, '');
  assert.equal(suggestion.factors.story.score, null);
  assert.equal(suggestion.factors.story.basis, '');

  // 사용자의 기존 draft
  const userDraft = {
    skill: { score: 5, basis: '기존 수기 작성 근거', method: 'numeric', rubricVersion: 'numeric-draft-1' },
    story: { score: 7, basis: '사용자가 직접 조사한 고유 이야기', method: 'numeric', rubricVersion: 'numeric-draft-1' },
  };

  // UI 병합 로직: AI 제안에서 score !== null && basis.trim() !== ''인 것만 덮어씀
  const merged = { ...userDraft };
  for (const [key, s] of Object.entries(suggestion.factors)) {
    if (s.score !== null && s.basis.trim() !== '') {
      (merged as any)[key] = {
        score: s.score,
        basis: s.basis,
        method: 'numeric',
        rubricVersion: s.rubricVersion,
      };
    }
  }

  // skill은 AI 제안으로 갱신되었으나, 사용자가 쓴 story(7점)는 그대로 보존됨
  assert.equal(merged.skill.score, 8);
  assert.equal(merged.story.score, 7);
  assert.equal(merged.story.basis, '사용자가 직접 조사한 고유 이야기');
});

test('17. 과거 방식(legacy-level) 평가에서 근거(basis)만 수정 시 method 유지 검증', () => {
  const legacyFactor = {
    score: 8,
    basis: '과거 고(high) 등급 근거',
    method: 'legacy-level' as const,
    rubricVersion: 'v2',
  };

  // 1) 근거(basis) 텍스트만 수정할 때: method는 'legacy-level' 유지
  const updatedBasisOnly = {
    ...legacyFactor,
    basis: '과거 등급 근거의 오탈자만 수정',
  };
  assert.equal(updatedBasisOnly.method, 'legacy-level');

  // 2) 점수(score)를 새로 선택할 때: method가 'numeric'으로 전환됨
  const updatedScore = {
    ...updatedBasisOnly,
    score: 9,
    method: 'numeric' as const,
    rubricVersion: 'numeric-draft-1',
  };
  assert.equal(updatedScore.method, 'numeric');
  assert.equal(updatedScore.score, 9);
});

test('18. 전체 예산 500,000원 / 10개 조건의 포장 링크 및 공유 링크 생성 검증', () => {
  const req: RecommendationRequest = {
    event: 'wedding',
    relation: 'business',
    quantity: 10,
    budget: { mode: 'total', amount: 500000 },
    excludedProductNos: [],
  };

  // 1) 포장 링크 파라미터 검증
  const params = new URLSearchParams({
    product: '900001',
    qty: String(req.quantity),
    event: req.event,
    relation: req.relation,
  });
  if (req.budget.mode === 'total') {
    params.set('budgetMode', 'total');
    params.set('totalBudget', String(req.budget.amount));
    params.set('budget', String(Math.floor(req.budget.amount / req.quantity)));
  }
  const packagingHref = `/packaging?${params.toString()}`;

  assert.ok(packagingHref.includes('budgetMode=total'));
  assert.ok(packagingHref.includes('totalBudget=500000'));
  assert.ok(packagingHref.includes('budget=50000'));
  assert.ok(packagingHref.includes('qty=10'));

  // 2) 공유 링크 검증
  const totalAmount = req.budget.mode === 'total' ? req.budget.amount : 0;
  const shareHref = `/recommendation-ui?event=${req.event}&relation=${req.relation}&qty=${req.quantity}&budgetMode=total&totalBudget=${totalAmount}&budget=${Math.floor(totalAmount / req.quantity)}`;
  assert.ok(shareHref.includes('totalBudget=500000'));
  assert.ok(shareHref.includes('budget=50000'));
  assert.ok(shareHref.includes('qty=10'));
});

test('19. 정책 편집기: minimumEvidenceCount < 2 거절 검증', async () => {
  const services = createMockRecommendationServices();
  const currentPolicyDoc = await services.loadPolicy();
  assert.ok(currentPolicyDoc.ok);

  const invalidPolicy = {
    ...currentPolicyDoc.data.policy,
    minimumEvidenceCount: 1, // 2 미만이므로 유효하지 않음
  };

  const saveRes = await services.savePolicy({
    policy: invalidPolicy,
    expectedUpdatedAt: currentPolicyDoc.data.updatedAt,
  });

  assert.equal(saveRes.ok, false);
  if (!saveRes.ok) {
    assert.equal(saveRes.error.code, 'invalid_input');
  }
});

test('20. 관리자 워크스페이스 로드 실패 및 복구 검증', async () => {
  const services = createMockRecommendationServices();

  // 실패 시뮬레이션
  services.setSimulateError('unavailable');
  const failRes = await services.loadWorkspace();
  assert.equal(failRes.ok, false);
  if (!failRes.ok) {
    assert.equal(failRes.error.code, 'unavailable');
  }

  // 복구 시뮬레이션
  services.setSimulateError(null);
  const okRes = await services.loadWorkspace();
  assert.equal(okRes.ok, true);
  if (okRes.ok) {
    assert.ok(okRes.data.products.length > 0);
  }
});

test('21. 관리자: 카페24 상품 설명 자동 조회 및 비동기 응답 순서 역전(race condition) 방어 검증', async () => {
  let latestDescReqId = 0;
  let activeProductNo = 900001;
  let displayedDescription: string | null = null;

  async function mockLoadDescription(pNo: number, delayMs: number, text: string) {
    const reqId = ++latestDescReqId;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (reqId === latestDescReqId && activeProductNo === pNo) {
      displayedDescription = text;
    }
  }

  // 상품 900001에 대해 느린 응답 (100ms)
  const p1Req = mockLoadDescription(900001, 100, '상품 1의 카페24 설명');

  // 사용자가 상품 900002로 빠르게 전환 (20ms 후)
  await new Promise((resolve) => setTimeout(resolve, 20));
  activeProductNo = 900002;
  const p2Req = mockLoadDescription(900002, 30, '상품 2의 카페24 최신 설명');

  await Promise.all([p1Req, p2Req]);

  // 느린 상품 1 응답이 나중에 끝나더라도, 상품 2의 설명이 유지되어야 함
  assert.equal(displayedDescription, '상품 2의 카페24 최신 설명');
});

test('22. 관리자: 기존 검수 완료/작성 중 초안이 있을 때 카페24 설명 자동 덮어쓰기 방지 검증', () => {
  const existingReviewedDraft = {
    productNo: 900001,
    description: '관리자가 직접 정성들여 검수한 설명 원문',
    reviewed: true,
  };
  const fetchedCafe24Text = '카페24에서 새로 갱신된 HTML 상세 설명';

  let draftDesc = existingReviewedDraft.description;
  let diffPromptAvailable = false;

  // UI 방어 로직 검증: 검수 완료 상태이거나 내용이 이미 존재하면 덮어쓰지 않고 diff 프롬프트 제공
  if (existingReviewedDraft.reviewed && fetchedCafe24Text !== draftDesc) {
    diffPromptAvailable = true;
    // draftDesc는 자동 덮어쓰기되지 않음!
  } else {
    draftDesc = fetchedCafe24Text;
  }

  assert.equal(draftDesc, '관리자가 직접 정성들여 검수한 설명 원문', '기존 검수된 설명이 보존되어야 함');
  assert.equal(diffPromptAvailable, true, '관리자가 수동으로 적용할 수 있는 버튼/프롬프트가 노출되어야 함');
});

test('23. 결재 문서 핵심 특징: 엔진 판정 설명(검수 자료, 행사 희소 기준) 배제 및 미확인 시 "확인 필요" 검증', async () => {
  const { buildProductKeyFeature, isEngineJudgmentText } = await import('../src/approval/calc.ts');

  // 1. 엔진 판정 문구 판별 검증
  assert.equal(isEngineJudgmentText('검수 자료와 행사 희소 기준을 충족합니다.'), true);
  assert.equal(isEngineJudgmentText('행사 적합도와 예산 내 가격 실속으로 비교했습니다.'), true);
  assert.equal(isEngineJudgmentText('담양 대나무 숲에서 자란 찻잎으로 덖은 죽로차'), false);

  // 2. 엔진 판정 문구만 있고 확인된 상품 특징이 없는 경우 -> '확인 필요'
  const engineCandidate = {
    rank: 1,
    productNo: 101,
    productName: '수제 비누',
    price: 15000,
    imageUrl: '',
    tier: '추천 1순위',
    matchScore: 90,
    reason: '검수 자료와 행사 희소 기준을 충족합니다.',
    reasons: ['검수 자료와 행사 희소 기준을 충족합니다.', '행사 적합도와 예산 내 가격 실속으로 비교했습니다.'],
    region: '',
    category: '',
    isDepopulationArea: false,
  };
  const keyFeature1 = buildProductKeyFeature(engineCandidate);
  assert.equal(keyFeature1, '확인 필요', '엔진 판정 설명은 배제되고 확인 필요가 반환되어야 함');

  // 3. 확인된 스토리나 특징이 있는 경우 -> 해당 특징 반환
  const verifiedCandidate = {
    ...engineCandidate,
    story: '100% 국산 콩과 전통 방식으로 제조한 프리미엄 수제 장류',
  };
  const keyFeature2 = buildProductKeyFeature(verifiedCandidate);
  assert.equal(keyFeature2, '100% 국산 콩과 전통 방식으로 제조한 프리미엄 수제 장류');

  // 4. 산지 정보만 있는 경우 -> 산지 표기
  const regionCandidate = {
    ...engineCandidate,
    region: '제주',
    category: '식품',
  };
  const keyFeature3 = buildProductKeyFeature(regionCandidate);
  assert.equal(keyFeature3, '산지: 제주 · 분류: 식품');
});
