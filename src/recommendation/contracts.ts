// core-contract-v1: Codex 소유. 화면에서 산식이나 호환 타입을 다시 정의하지 않는다.
export const CONTRACT_VERSION = 'core-contract-v1' as const;
export const EVENT_IDS = ['funeral', 'wedding', 'longevity', 'birth', 'promotion', 'opening', 'thanks', 'birthday', 'ceremony', 'conference', 'anniversary', 'holiday'] as const;
export const RELATION_IDS = ['senior', 'business', 'peer', 'family'] as const;
export const FACTOR_IDS = ['skill', 'locality', 'distribution', 'history', 'story'] as const;
export const SENDER_IDS = ['unknown', 'personal', 'company', 'organization', 'public'] as const;
export const PURPOSE_IDS = ['unknown', 'return', 'celebration', 'condolence', 'commemoration', 'promotion'] as const;
export type EventId = typeof EVENT_IDS[number];
export type RelationId = typeof RELATION_IDS[number];
export type FactorId = typeof FACTOR_IDS[number];
export type SenderId = typeof SENDER_IDS[number];
export type PurposeId = typeof PURPOSE_IDS[number];

export type Budget = { mode: 'none' } | { mode: 'per_item' | 'total'; amount: number };
export interface RecommendationRequest {
  event: EventId;
  relation: RelationId;
  quantity: number;
  budget: Budget;
  excludedProductNos: number[];
  sender?: SenderId;
  purpose?: PurposeId;
}

export interface FactorAssessment {
  score: number | null; // 0~10 정수. 미평가 null과 확인된 0점은 다르다.
  basis: string;
  method: 'legacy-level' | 'numeric';
  rubricVersion: string | null;
}
export type AssessmentMethod = 'legacy-level' | 'numeric' | 'mixed';
export interface ProductAssessment {
  productNo: number;
  description: string;
  factors: Record<FactorId, FactorAssessment>;
  reviewed: boolean;
  updatedAt: string | null;
  reviewedAt: string | null;
}
export interface ProductSnapshot {
  productNo: number;
  name: string;
  price: number;
  display: boolean;
  selling: boolean;
  soldOut: boolean;
  imageUrl: string | null;
  productUrl: string;
  // 기존의 유효한 v2 행사 제외만 전달한다. 없는 규칙을 만들어 넣지 않는다.
  excludedEvents?: EventId[];
}
export interface RecommendationPolicy {
  version: string;
  eventBase: Record<EventId, number>;
  relationShift: Record<RelationId, number>;
  senderShift: Record<SenderId, number>;
  purposeShift: Record<PurposeId, number>;
  rarityWeights: Record<FactorId, number>;
  minimumEvidenceCount: number;
  rarityBands: { from: number; min: number; max: number }[]; // 모두 0~100 기준
  scoreWeights: { eventFit: number; priceValue: number };
}
export interface RecommendationItem {
  slot?: 'standard' | 'practical' | 'formal';
  productNo: number;
  name: string;
  unitPrice: number;
  itemSubtotal: number;
  imageUrl: string | null;
  productUrl: string;
  eventFormality: number;
  rarityValue: number;
  evidenceCount: number;
  assessmentMethod: AssessmentMethod;
  assessmentUpdatedAt: string | null;
  rubricVersions: string[];
  eventFitScore: number;
  priceValueScore: number | null;
  recommendationScore: number;
  rank: number;
  reasons: string[];
}
export type ExclusionCode = 'invalid_product' | 'unavailable' | 'customer_excluded' | 'event_excluded' | 'unreviewed' | 'insufficient_evidence' | 'rarity_outside' | 'budget_exceeded';
export interface RecommendationResponse {
  contractVersion: typeof CONTRACT_VERSION;
  algorithmVersion?: string;
  policyVersion: string;
  request: RecommendationRequest;
  items: RecommendationItem[];
  exclusions: { productNo: number; code: ExclusionCode; message: string }[];
  notices: { code: 'no_candidates' | 'few_candidates' | 'legacy_assessment'; message: string }[];
}
export type ErrorCode = 'invalid_input' | 'unauthorized' | 'not_found' | 'revision_conflict' | 'ai_failed' | 'save_failed' | 'unavailable';
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; fields?: Record<string, string> } };
export interface SaveAssessmentCommand {
  assessment: ProductAssessment;
  expectedUpdatedAt: string | null;
}
export interface AssessmentSuggestion {
  productNo: number;
  sourceDescription: string;
  factors: Record<FactorId, FactorAssessment>;
  // AI 제안은 검수 완료 기록이 아니다. 서버에서 저장하지 않는다.
  rubricVersion: string;
}
export interface PolicyDocument { policy: RecommendationPolicy; updatedAt: string | null }
export interface RubricDocument {
  version: string;
  status: 'draft';
  factors: Record<FactorId, { name: string; guide: string; anchors: { score: number; description: string }[] }>;
}
export interface AdminWorkspace {
  products: ProductSnapshot[];
  assessments: ProductAssessment[];
  policy: PolicyDocument;
  rubric: RubricDocument;
}

export interface AdminSyncUiServices {
  preview(): Promise<ActionResult<import('../cafe24/sync-preview.ts').SyncPreviewResult>>;
  apply(command: {
    snapshotHash: string;
    expectedSyncedAt: string | null;
    products: import('../engine/types.ts').Cafe24Product[];
  }): Promise<ActionResult<{ count: number; syncedAt: string }>>;
}

// UI가 필요로 하는 서버 호출 계약. 실제 액션 구현은 Codex가 후속 연결한다.
// 테스트에서는 이 객체를 주입한다. 테스트 구현을 운영 페이지에 넣지 않는다.
export interface RecommendationServices {
  recommend(request: RecommendationRequest): Promise<ActionResult<RecommendationResponse>>;
  loadWorkspace(): Promise<ActionResult<AdminWorkspace>>;
  previewRecommendation(command: { request: RecommendationRequest; policy: RecommendationPolicy }): Promise<ActionResult<RecommendationResponse>>;
  loadAssessment(productNo: number): Promise<ActionResult<ProductAssessment>>;
  saveAssessment(command: SaveAssessmentCommand): Promise<ActionResult<ProductAssessment>>;
  suggestAssessment(command: { productNo: number; description: string }): Promise<ActionResult<AssessmentSuggestion>>;
  loadPolicy(): Promise<ActionResult<PolicyDocument>>;
  savePolicy(command: { policy: RecommendationPolicy; expectedUpdatedAt: string | null }): Promise<ActionResult<PolicyDocument>>;
}
