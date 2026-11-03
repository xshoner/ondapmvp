import type { ResultQuery } from '../lib/result-query.ts';

export interface ApprovalCandidate {
  model?: 'v2' | 'core-contract-v1';
  rank: number; // 1, 2, 3
  productNo: number;
  productName: string;
  price: number;
  imageUrl: string;
  localImageFilename?: string; // data/approval-drafts/images/{draftId}_{productNo}.png
  tier: string;
  matchScore: number;
  recommendationScore?: number; // S (추천점수)
  rarityValue?: number; // R (상품 희소값)
  eventFormality?: number; // F (행사 격식)
  eventFitScore?: number; // E (행사 적합도)
  priceValueScore?: number | null; // V (가격 적합도)
  evidenceCount?: number;
  assessmentMethod?: string;
  reasons?: string[];
  reason: string;
  region: string;
  category: string;
  isDepopulationArea: boolean;
  packageSummary?: string;
  story?: string;
  attributesReviewed?: boolean;
}

export interface ApprovalDraftSource {
  query: ResultQuery;
  budgetMode?: 'per_item' | 'total' | 'none';
  originalTotalBudget: number | null; // 원래 입력된 전체 예산 (null이면 1개당 예산 모드 또는 미입력)
  modelVersion: string;
  policyVersion?: string;
  catalogSyncedAt: string;
  snapshotAt: string;
  candidates: ApprovalCandidate[];
  recommendNotice?: string | null;
  exclusions?: { productNo: number; code: string; message: string }[];
}

export interface ApprovalDraftEditable {
  eventName: string;
  eventDate: string | null; // YYYY-MM-DD
  organization: string;
  department: string;
  author: string;
  purpose: string;
  quantity: number;
  selectedProductNo: number;
  additionalNote: string;
  approverTitles: string[]; // 기본: ['담당', '팀장', '과장']
  internalPerPersonLimit: number | null;
  internalRuleMemo: string;
  complianceChecks?: {
    antiGraft?: boolean;
    electionLaw?: boolean;
    contract?: boolean;
  };
}

export interface ApprovalDraft {
  schemaVersion: 1;
  id: string; // UUID v4
  revision: number; // 1부터 시작
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  creatorTokenHash?: string; // SHA-256 hash of creator secret token
  source: ApprovalDraftSource;
  editable: ApprovalDraftEditable;
}

// 뷰/출력용으로 계산된 완결된 모델
export interface CandidateCalculatedRow {
  candidate: ApprovalCandidate;
  isSelected: boolean;
  planLabel: string; // "1안(추천·선택)", "1안(추천)", "2안", "3안"
  quantity: number;
  unitPrice: number;
  itemTotal: number;
  shippingFee: number;
  shippingNote: string;
  tier: string;
  matchScore: number;
  recommendationScore?: number; // S (추천점수)
  rarityValue?: number; // R (상품 희소값)
  reason: string;
  remark: string;
  keyFeature: string; // 확인된 상품 자체의 특징 (엔진 판정 설명 배제, 없으면 '확인 필요')
  region: string;
  category: string;
  depopulationNote: string;
  story: string;
}

export interface ApprovalDocumentModel {
  draft: ApprovalDraft;
  // 기본 개요
  eventName: string;
  eventDateText: string;
  authorText: string; // "{organization} {department} {author}" (입력된 것만 조합)
  eventCategoryName: string; // 실제 추천 엔진이 적용한 행사 분류
  relationCategoryName: string; // 실제 적용한 관계 분류
  purposeText: string;

  // 선택안 및 요약
  selectedCandidate: ApprovalCandidate;
  selectedPlanLabel: string; // "1안(추천)", "2안", "3안"
  quantity: number;
  unitPrice: number;
  itemTotal: number;
  shippingFee: number;
  shippingNote: string;
  vatStatus: string; // "부가세 포함 여부 확인 필요"
  extraCostNote: string; // "배송·추가 비용 및 부가세 포함 여부 별도 확인"
  budgetStatus: string;
  budgetOverAmount?: number;
  isBudgetOver: boolean;
  selectedReason: string; // 자동 작성된 선정 사유 (1~2문장)
  additionalNote: string;
  hasInternalLimit: boolean;
  hasScheduleOrNote: boolean;

  // 결재란 직책
  approverTitles: string[];

  // 대안 비교표 행들 (1/2/3안)
  candidateRows: CandidateCalculatedRow[];
  hasShortage: boolean; // 추천이 3개 미만인 경우
  shortageReason?: string;

  // 기준 및 확인 사항
  budgetCheckText: string;
  perPersonLimitCheckText: string;
  complianceNotes: {
    antiGraftText: string;
    electionLawText: string;
    contractText: string;
    foodInspectionText: string;
  };
  regionMeaningText: string;
  producerSettlementText: string;
  deliveryScheduleText: string; // 권장 도착일 및 일정 안내

  // 메타 정보
  createdDateText: string;
  catalogDateText: string;
  documentId: string;
  revision: number;
  draftNotice: string;

  // 클립보드 복사용 요약문
  summaryClipboardText: string;
}
