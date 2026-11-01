import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocumentModel,
  validateQuantity,
  getDaysBeforeKST,
  formatKSTDate,
  buildSelectedReason,
  defaultPurposeText,
  sanitizePurposeText,
} from '../src/approval/calc.ts';
import type { ApprovalCandidate, ApprovalDraft } from '../src/approval/types.ts';

function createDummyCandidate(rank: number, productNo: number, price: number): ApprovalCandidate {
  return {
    rank,
    productNo,
    productName: `테스트 상품 ${rank}`,
    price,
    imageUrl: 'https://example.com/img.jpg',
    tier: rank === 1 ? '격식' : '실속',
    matchScore: 90 - rank * 5,
    reason: `추천 사유 ${rank}`,
    region: '담양',
    category: '식품',
    isDepopulationArea: rank === 1,
    story: '3대째 내려오는 전통 방식',
    attributesReviewed: true,
  };
}

function createDummyDraft(overrides: Partial<ApprovalDraft> = {}): ApprovalDraft {
  const c1 = createDummyCandidate(1, 101, 30000);
  const c2 = createDummyCandidate(2, 102, 25000);
  const c3 = createDummyCandidate(3, 103, 35000);

  const base: ApprovalDraft = {
    schemaVersion: 1,
    id: 'test-uuid-0001',
    revision: 1,
    createdAt: '2026-10-31T09:00:00.000Z',
    updatedAt: '2026-10-31T09:00:00.000Z',
    source: {
      query: {
        event: 'wedding',
        relation: 'senior',
        budget: 35000,
        qty: 100,
        exclude: [],
        budgetMode: 'total',
        totalBudget: 3000000,
      },
      budgetMode: 'total',
      originalTotalBudget: 3000000,
      modelVersion: '2026.10',
      catalogSyncedAt: '2026-10-31T00:00:00.000Z',
      snapshotAt: '2026-10-31T09:00:00.000Z',
      candidates: [c1, c2, c3],
    },
    editable: {
      eventName: '홍길동 차남 결혼식',
      eventDate: '2026-11-15',
      organization: '행정안전부',
      department: '운영지원과',
      author: '김주무관',
      purpose: '참석 하객 감사 답례',
      quantity: 100,
      selectedProductNo: 101,
      additionalNote: '친환경 포장 필수',
      approverTitles: ['담당', '팀장', '과장'],
      internalPerPersonLimit: 50000,
      internalRuleMemo: '공무원 행동강령 3만원 초과 금지 예외 검토',
    },
  };

  return {
    ...base,
    ...overrides,
    source: { ...base.source, ...(overrides.source ?? {}) },
    editable: { ...base.editable, ...(overrides.editable ?? {}) },
  };
}

test('금액 계산: 30,000원 × 100개 = 3,000,000원 (전체 예산 3,000,000원 적합)', () => {
  const draft = createDummyDraft();
  const model = buildDocumentModel(draft);

  assert.equal(model.unitPrice, 30000);
  assert.equal(model.quantity, 100);
  assert.equal(model.itemTotal, 3000000);
  assert.equal(model.isBudgetOver, false);
  assert.match(model.budgetStatus, /잔여 0원/);

  // 세 안의 금액을 합산하지 않고 선택안만 요약 총액에 사용한다
  assert.equal(model.candidateRows.length, 3);
  assert.equal(model.candidateRows[0].itemTotal, 3000000);
  assert.equal(model.candidateRows[1].itemTotal, 2500000);
  assert.equal(model.candidateRows[2].itemTotal, 3500000);
});

test('금액 계산: 120개 변경 시 3,600,000원으로 상품비만 600,000원 초과', () => {
  const draft = createDummyDraft({
    editable: {
      ...createDummyDraft().editable,
      quantity: 120,
    },
  });
  const model = buildDocumentModel(draft);

  assert.equal(model.unitPrice, 30000);
  assert.equal(model.quantity, 120);
  assert.equal(model.itemTotal, 3600000);
  assert.equal(model.isBudgetOver, true);
  assert.equal(model.budgetOverAmount, 600000);
  assert.match(model.budgetStatus, /상품비만 600,000원 초과/);
});

test('선택안 변경: 2안(25,000원) 선택 시 요약·금액·선정사유 갱신 (2안으로 선정 명시)', () => {
  const draft2 = createDummyDraft({
    editable: {
      ...createDummyDraft().editable,
      selectedProductNo: 102, // 2안
    },
  });
  const model2 = buildDocumentModel(draft2);

  assert.equal(model2.selectedCandidate.productNo, 102);
  assert.equal(model2.selectedPlanLabel, '2안');
  assert.equal(model2.unitPrice, 25000);
  assert.equal(model2.itemTotal, 2500000);
  assert.match(model2.budgetStatus, /잔여 500,000원/);
  assert.match(model2.selectedReason, /추천 사유 2/);
  assert.match(model2.selectedReason, /2안으로 선정합니다/);

  // 3안 선택 시 3안으로 선정 명시
  const draft3 = createDummyDraft({
    editable: {
      ...createDummyDraft().editable,
      selectedProductNo: 103, // 3안
    },
  });
  const model3 = buildDocumentModel(draft3);
  assert.equal(model3.selectedCandidate.productNo, 103);
  assert.equal(model3.selectedPlanLabel, '3안');
  assert.match(model3.selectedReason, /3안으로 선정합니다/);

  // 1안 선택 시 1순위 안으로 선정 명시
  const draft1 = createDummyDraft();
  const model1 = buildDocumentModel(draft1);
  assert.match(model1.selectedReason, /1순위 안으로 선정합니다/);
});

test('결재란 직책 비우기: approverTitles를 빈 배열 []로 지정하면 결재란 숨김(빈 배열 유지)', () => {
  const draft = createDummyDraft({
    editable: {
      ...createDummyDraft().editable,
      approverTitles: [], // 직책을 모두 지움
    },
  });
  const model = buildDocumentModel(draft);
  assert.deepEqual(model.approverTitles, []);
});

test('기존 URL 호환 (1개당 예산 모드): 원래 총예산 없이 참고 한도로 표시', () => {
  const draft = createDummyDraft({
    source: {
      ...createDummyDraft().source,
      budgetMode: 'per_item',
      originalTotalBudget: null,
      query: {
        event: 'wedding',
        relation: 'senior',
        budget: 30000,
        qty: 100,
        exclude: [],
      },
    },
  });
  const model = buildDocumentModel(draft);

  assert.match(model.budgetStatus, /참고 한도 3,000,000원/);
  assert.match(model.budgetCheckText, /전체 예산형 입력이 아니므로/);
});

test('예산 완화 표시: 단가가 1개당 상한을 초과할 때 초과 명시', () => {
  const draft = createDummyDraft({
    source: {
      ...createDummyDraft().source,
      budgetMode: 'per_item',
      originalTotalBudget: null,
      query: {
        event: 'wedding',
        relation: 'senior',
        budget: 20000, // 상한 20,000원
        qty: 100,
        exclude: [],
      },
    },
  });
  // 상품단가는 30,000원으로 10,000원 초과
  const model = buildDocumentModel(draft);
  assert.equal(model.isBudgetOver, true);
  assert.equal(model.budgetOverAmount, 1000000);
  assert.match(model.budgetStatus, /개당 10,000원 초과/);
});

test('예산 미설정 시 처리', () => {
  const draft = createDummyDraft({
    source: {
      ...createDummyDraft().source,
      budgetMode: undefined,
      originalTotalBudget: null,
      query: {
        event: 'wedding',
        relation: 'senior',
        budget: null,
        qty: 50,
        exclude: [],
      },
    },
    editable: {
      ...createDummyDraft().editable,
      quantity: 50,
    },
  });
  const model = buildDocumentModel(draft);
  assert.match(model.budgetStatus, /예산 미설정/);
});

test('추천 후보 부족 (1개/2개) 안내', () => {
  const c1 = createDummyCandidate(1, 101, 30000);
  const draft = createDummyDraft({
    source: {
      ...createDummyDraft().source,
      candidates: [c1],
    },
  });
  const model = buildDocumentModel(draft);
  assert.equal(model.hasShortage, true);
  assert.match(model.shortageReason!, /추천 후보가 1개로 한정/);
});

test('수량 유효성 검증: 소수·음수·초과 거부', () => {
  assert.throws(() => validateQuantity(0), /수량은 1 이상/);
  assert.throws(() => validateQuantity(-10), /수량은 1 이상/);
  assert.throws(() => validateQuantity(2.5), /수량은 1 이상/);
  assert.throws(() => validateQuantity(100001), /수량은 1 이상/);
  assert.equal(validateQuantity(100), 100);
});

test('운영 사실 미확인 기본값: VAT, 정산자료, 법규 검수', () => {
  const draft = createDummyDraft();
  const model = buildDocumentModel(draft);

  assert.equal(model.vatStatus, '부가세 포함 여부 확인 필요 (상품 판매가 기준, 추가비 미확정)');
  assert.equal(model.extraCostNote, '배송·추가 비용 및 부가세 포함 여부 별도 확인');
  assert.equal(model.producerSettlementText, '정산 자료 미등록 (생산자 직접 정산액·마진율 데이터 미보유)');
  assert.match(model.complianceNotes.antiGraftText, /확인 필요/);
  assert.match(model.complianceNotes.foodInspectionText, /확인 필요/);
  assert.match(model.shippingNote, /추가 배송비 및 포장비 미확정/);
});

test('품의 요약 복사문 및 일정/가액 문구 검증: 삭제 대상 일절 배제 및 안전한 문구 생성', () => {
  const draft = createDummyDraft();
  const model = buildDocumentModel(draft);

  // 품의 요약 복사문에 핵심 정보 포함
  assert.ok(model.summaryClipboardText.includes('[답례품 선정 품의 요약]'));
  assert.ok(model.summaryClipboardText.includes('배송·추가 비용 및 부가세 포함 여부 별도 확인'));
  assert.ok(model.summaryClipboardText.includes('1순위 안으로 선정합니다'));

  // 삭제 대상(법규, 선거, 계약, 식품검수, 정산)은 요약문에서 배제
  assert.ok(!model.summaryClipboardText.includes('청탁금지법'));
  assert.ok(!model.summaryClipboardText.includes('선거'));
  assert.ok(!model.summaryClipboardText.includes('계약'));
  assert.ok(!model.summaryClipboardText.includes('식품 위생'));
  assert.ok(!model.summaryClipboardText.includes('정산'));

  // 행사일 3일 전 자동 확정 문구가 없어야 함
  assert.ok(!model.deliveryScheduleText.includes('3일 전'));
  assert.ok(model.deliveryScheduleText.includes('사전 출고 및 배송 일정 확인 필요'));

  // 행사일 미입력 시 빈 문자열
  const draftNoDate = createDummyDraft({
    editable: {
      ...createDummyDraft().editable,
      eventDate: null,
    },
  });
  const modelNoDate = buildDocumentModel(draftNoDate);
  assert.equal(modelNoDate.deliveryScheduleText, '');
  assert.equal(modelNoDate.eventDateText, '미입력');

  // 내부 가액 기준 미설정 시 빈 문자열
  const draftNoLimit = createDummyDraft({
    editable: {
      ...createDummyDraft().editable,
      internalPerPersonLimit: null,
    },
  });
  const modelNoLimit = buildDocumentModel(draftNoLimit);
  assert.equal(modelNoLimit.perPersonLimitCheckText, '');
  assert.equal(modelNoLimit.hasInternalLimit, false);

  // 작성자 정보 미입력 시 '미입력'
  const draftNoAuthor = createDummyDraft({
    editable: {
      ...createDummyDraft().editable,
      organization: '',
      department: '',
      author: '',
    },
  });
  const modelNoAuthor = buildDocumentModel(draftNoAuthor);
  assert.equal(modelNoAuthor.authorText, '미입력');
});

test('기존 초안 레거시 목적 문구 자동 보정 (sanitizePurposeText)', () => {
  // 1. 결혼식 레거시 전체 기본 문구 치환 (중복 "참석 및 참석 및" 발생 방지)
  const legacyWeddingPurpose = '결혼식에 참석 및 축하·조문해 주신 거래처/공식께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.';
  const sanitizedWedding = sanitizePurposeText(legacyWeddingPurpose, 'wedding', 'business');
  assert.ok(!sanitizedWedding.includes('조문'), '결혼식 레거시 문구에서 조문이 제거되어야 함');
  assert.ok(!sanitizedWedding.includes('참석 및 참석 및'), '중복 참석 및 문구가 없어야 함');
  assert.equal(
    sanitizedWedding,
    '결혼식에 참석 및 축하해 주신 거래처/공식께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.'
  );

  // 2. 직전 중간 버전에서 생성되었던 중복 치환 문구도 자연스러운 문구로 정상 보정
  const duplicateWeddingPurpose = '결혼식에 참석 및 참석 및 축하해 주신 거래처/공식께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.';
  const sanitizedDup = sanitizePurposeText(duplicateWeddingPurpose, 'wedding', 'business');
  assert.equal(
    sanitizedDup,
    '결혼식에 참석 및 축하해 주신 거래처/공식께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.'
  );

  // 3. 장례 레거시 전체 기본 문구 치환 (축하 제거, 조문/위로 포함)
  const legacyFuneralPurpose = '장례(조문)에 참석 및 축하·조문해 주신 거래처/공식께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.';
  const sanitizedFuneral = sanitizePurposeText(legacyFuneralPurpose, 'funeral', 'business');
  assert.ok(!sanitizedFuneral.includes('축하'), '장례 레거시 문구에서 축하가 제거되어야 함');
  assert.equal(
    sanitizedFuneral,
    '장례에 조문과 따뜻한 위로를 보내주신 거래처/공식께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.'
  );

  // 4. 사용자가 직접 작성한 문구는 '축하·조문' 단어가 들어있어도 100% 보존
  // 반례: 창립 행사 및 우수 고객 등 고객이 행사명/대상을 수정한 문구
  const userCounterexample = '창립 행사에 참석 및 축하·조문해 주신 우수 고객께 전할 정중하고 격식 있는 답례품 선정 및 예산 집행 검토.';
  assert.equal(sanitizePurposeText(userCounterexample, 'wedding', 'business'), userCounterexample);

  const userCustomWithWords = '다양한 행사에서 축하·조문해 주신 분들께 감사드립니다.';
  assert.equal(sanitizePurposeText(userCustomWithWords, 'wedding', 'business'), userCustomWithWords);

  const customPurpose = '창립 기념 우수 고객 대상 감사 선물 전달';
  assert.equal(sanitizePurposeText(customPurpose, 'wedding', 'business'), customPurpose);
});

test('선정 사유 문장 연결 및 실제 데이터 기반 분기 검증 (buildSelectedReason)', () => {
  const candidate = createDummyCandidate(1, 201, 35000);
  candidate.reason = '담양의 생산자를 응원하는 상생 선물이기도 합니다.';
  candidate.region = '담양';

  // 1. 어색한 비문("합니다. 점을") 및 확인되지 않은 "특산 상품의 상징성" 제거 검증
  const reasonText = buildSelectedReason(candidate, 'wedding', 'business');
  assert.ok(!reasonText.includes('합니다. 점을'), '어색한 문장 연결("합니다. 점을")이 없어야 함');
  assert.ok(!reasonText.includes('선물이기도 합니다. 점'), '마침표 직후 어색한 명사구 연결 배제');
  assert.ok(!reasonText.includes('특산 상품의 상징성'), '확인되지 않은 상징성 근거 배제');
  assert.ok(reasonText.includes('1순위 안으로 선정합니다'), '최종 선정안 문구 정상 포함');
  assert.ok(reasonText.includes('담양의 생산자를 응원하는 상생 선물이기도 합니다.'), '추천 사유 문장 보존');

  // 2. 예산 미설정 시: "예산 적합성"을 거짓으로 주장하지 않고 일반 추천 사유로 종결
  const reasonNoBudget = buildSelectedReason(candidate, 'wedding', 'business', { budgetKind: 'none' });
  assert.ok(!reasonNoBudget.includes('예산 적합'), '예산 미설정 시 예산 적합 문구 제외');
  assert.ok(reasonNoBudget.includes('위와 같은 추천 사유를 종합적으로 검토하여'), '추천 사유 기반 선정 문구');

  // 3. 전체 예산 초과 시: "예산 적합"이라고 왜곡하지 않고 실제 상태 반영
  const reasonTotalOver = buildSelectedReason(candidate, 'wedding', 'business', { budgetKind: 'total', isBudgetOver: true });
  assert.ok(!reasonTotalOver.includes('예산 적합'), '예산 초과 시 적합성 문구 제외');
  assert.ok(reasonTotalOver.includes('전체 예산 초과(상품비 기준)에 대한 검토가 필요하나'), '전체 예산 초과 사실 정직 반영');

  // 4. 전체 예산 이내 시: 총지출이 아닌 "상품비 기준 예산 검토" 명시
  const reasonTotalWithin = buildSelectedReason(candidate, 'wedding', 'business', { budgetKind: 'total', isBudgetOver: false });
  assert.ok(reasonTotalWithin.includes('위 추천 사유 및 상품비 기준 예산 검토를 거쳐'), '상품비 기준 예산 검토 명시');
  assert.ok(!reasonTotalWithin.includes('총지출이 예산에 적합'), '총지출 단정 배제');

  // 5. 1개당 상한 초과 시
  const reasonPerItemOver = buildSelectedReason(candidate, 'wedding', 'business', { budgetKind: 'per_item', isBudgetOver: true });
  assert.ok(reasonPerItemOver.includes('1개당 예산 상한 초과에 대한 검토가 필요하나'), '1개당 상한 초과 반영');

  // 6. 1개당 상한 이내 시
  const reasonPerItemWithin = buildSelectedReason(candidate, 'wedding', 'business', { budgetKind: 'per_item', isBudgetOver: false });
  assert.ok(reasonPerItemWithin.includes('위 추천 사유 및 상품비 기준 예산 검토를 거쳐'), '상품비 기준 예산 검토 명시');
});

test('전체 예산이 존재하지만 query.budget이 null인 경우의 선정 사유 및 예산 상태 일관성 (재현 사례 검증)', () => {
  // 전체 예산 1,000원, query.budget은 null, 선택 상품 280,000원 10개 = 2,800,000원 (초과)
  const c1 = createDummyCandidate(1, 45, 280000);
  const draft = createDummyDraft({
    source: {
      ...createDummyDraft().source,
      query: {
        event: 'wedding',
        relation: 'business',
        budget: null, // query.budget은 비어 있음
        qty: 1,
        exclude: [],
        budgetMode: 'total',
        totalBudget: 1000, // 전체 예산 1,000원
      },
      budgetMode: 'total',
      originalTotalBudget: 1000,
      candidates: [c1],
    },
    editable: {
      ...createDummyDraft().editable,
      quantity: 1,
      selectedProductNo: 45,
    },
  });

  const model = buildDocumentModel(draft);
  assert.equal(model.isBudgetOver, true);
  assert.equal(model.budgetOverAmount, 279000);
  assert.match(model.budgetStatus, /상품비만 279,000원 초과/);
  // 선정 사유에도 초과 사실이 명확하게 반영되어야 함
  assert.ok(
    model.selectedReason.includes('전체 예산 초과(상품비 기준)에 대한 검토가 필요하나'),
    `선정 사유에 초과 사실이 누락되지 않아야 함 (실제: ${model.selectedReason})`
  );
  assert.ok(!model.selectedReason.includes('예산 적합'));
});
