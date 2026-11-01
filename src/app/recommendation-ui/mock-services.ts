import {
  FACTOR_IDS,
  type ActionResult,
  type AdminWorkspace,
  type AssessmentSuggestion,
  type ErrorCode,
  type FactorAssessment,
  type FactorId,
  type PolicyDocument,
  type ProductAssessment,
  type ProductSnapshot,
  type RecommendationItem,
  type RecommendationPolicy,
  type RecommendationRequest,
  type RecommendationResponse,
  type RecommendationServices,
  type RubricDocument,
  type SaveAssessmentCommand,
} from '../../recommendation/contracts.ts';
import { evaluateRecommendation } from '../../recommendation/evaluate.ts';
import { createDraftPolicy } from '../../recommendation/policy.ts';
import { createDraftRubric } from '../../recommendation/rubric.ts';
import { assertReviewable } from '../../recommendation/store.ts';
import { parseProductAssessment, parseRecommendationPolicy } from '../../recommendation/validation.ts';
import { coreUiFixtures } from './fixtures.ts';

export interface MockServiceOptions {
  initialWorkspace?: AdminWorkspace;
  simulateError?: ErrorCode | null;
  simulateConflict?: boolean;
}

export function createMockRecommendationServices(options: MockServiceOptions = {}): RecommendationServices & {
  setSimulateError: (error: ErrorCode | null) => void;
  setSimulateConflict: (conflict: boolean) => void;
  getAssessments: () => ProductAssessment[];
  getPolicy: () => RecommendationPolicy;
} {
  const base = options.initialWorkspace ?? coreUiFixtures.workspace;

  let products: ProductSnapshot[] = structuredClone(base.products);
  let assessments: Map<number, ProductAssessment> = new Map(
    structuredClone(base.assessments).map((a) => [a.productNo, a]),
  );
  let policyDoc: PolicyDocument = structuredClone(base.policy);
  let rubricDoc: RubricDocument = structuredClone(base.rubric);

  let simulateError = options.simulateError ?? null;
  let simulateConflict = options.simulateConflict ?? false;

  return {
    setSimulateError(err: ErrorCode | null) {
      simulateError = err;
    },
    setSimulateConflict(conflict: boolean) {
      simulateConflict = conflict;
    },
    getAssessments() {
      return Array.from(assessments.values());
    },
    getPolicy() {
      return policyDoc.policy;
    },

    async recommend(request: RecommendationRequest): Promise<ActionResult<RecommendationResponse>> {
      if (simulateError) {
        return {
          ok: false,
          error: {
            code: simulateError,
            message: `[시험 가상 오류] ${simulateError} 상태가 발생했습니다.`,
          },
        };
      }
      try {
        const assessmentList = Array.from(assessments.values());
        const result = evaluateRecommendation(products, assessmentList, request, policyDoc.policy);
        return { ok: true, data: result };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: err instanceof Error ? err.message : '추천 계산 중 오류가 발생했습니다.',
          },
        };
      }
    },

    async loadWorkspace(): Promise<ActionResult<AdminWorkspace>> {
      if (simulateError === 'unavailable') {
        return { ok: false, error: { code: 'unavailable', message: '작업공간을 불러올 수 없습니다.' } };
      }
      return {
        ok: true,
        data: {
          products: structuredClone(products),
          assessments: Array.from(assessments.values()).map((a) => structuredClone(a)),
          policy: structuredClone(policyDoc),
          rubric: structuredClone(rubricDoc),
        },
      };
    },

    async previewRecommendation(command: { request: RecommendationRequest; policy: RecommendationPolicy }): Promise<ActionResult<RecommendationResponse>> {
      try {
        const assessmentList = Array.from(assessments.values());
        const result = evaluateRecommendation(products, assessmentList, command.request, command.policy);
        return { ok: true, data: result };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: err instanceof Error ? err.message : '미리보기 계산 오류입니다.',
          },
        };
      }
    },

    async loadAssessment(productNo: number): Promise<ActionResult<ProductAssessment>> {
      const a = assessments.get(productNo);
      if (!a) {
        return { ok: false, error: { code: 'not_found', message: `상품번호 ${productNo} 평가를 찾을 수 없습니다.` } };
      }
      return { ok: true, data: structuredClone(a) };
    },

    async saveAssessment(command: SaveAssessmentCommand): Promise<ActionResult<ProductAssessment>> {
      if (simulateError === 'save_failed') {
        return { ok: false, error: { code: 'save_failed', message: '평가 저장 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } };
      }
      if (simulateConflict) {
        return {
          ok: false,
          error: {
            code: 'revision_conflict',
            message: '다른 관리자가 이미 해당 상품의 평가를 수정했습니다. 최신 내용을 확인한 후 다시 저장해 주세요.',
          },
        };
      }

      const existing = assessments.get(command.assessment.productNo);
      const current = existing ? existing.updatedAt : null;
      if (current !== command.expectedUpdatedAt) {
        return {
          ok: false,
          error: {
            code: 'revision_conflict',
            message: `개정 충돌: 저장된 갱신 시각(${current})과 제출 시각(${command.expectedUpdatedAt})이 일치하지 않습니다. 다른 관리자가 이미 수정한 내용이 있습니다.`,
          },
        };
      }

      try {
        const clean = parseProductAssessment(command.assessment);
        assertReviewable(clean, policyDoc.policy);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: err instanceof Error ? err.message : '유효하지 않은 평가 데이터입니다.',
          },
        };
      }

      const nextUpdatedAt = new Date().toISOString();
      const updated: ProductAssessment = {
        ...structuredClone(command.assessment),
        updatedAt: nextUpdatedAt,
        reviewedAt: command.assessment.reviewed ? (command.assessment.reviewedAt ?? nextUpdatedAt) : null,
      };

      assessments.set(updated.productNo, updated);
      return { ok: true, data: structuredClone(updated) };
    },

    async suggestAssessment(command: { productNo: number; description: string }): Promise<ActionResult<AssessmentSuggestion>> {
      if (simulateError === 'ai_failed') {
        return {
          ok: false,
          error: {
            code: 'ai_failed',
            message: 'AI 제안 서비스 연결에 실패했습니다. 입력한 기존 내용은 보존되며 다시 시도할 수 있습니다.',
          },
        };
      }
      if (!command.description || !command.description.trim()) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: '상품 원자료를 입력해 주세요.',
          },
        };
      }

      const rubricVersion = rubricDoc.version;
      const desc = command.description.trim();

      // 원자료에 실제 언급된 내용만 점수/근거를 채우고, 미확인 속성은 score: null, basis: ''로 남겨둠
      const factors: Record<string, FactorAssessment> = {
        skill: { score: null, basis: '', method: 'numeric', rubricVersion },
        locality: { score: null, basis: '', method: 'numeric', rubricVersion },
        distribution: { score: null, basis: '', method: 'numeric', rubricVersion },
        history: { score: null, basis: '', method: 'numeric', rubricVersion },
        story: { score: null, basis: '', method: 'numeric', rubricVersion },
      };

      if (desc.includes('장인') || desc.includes('전통') || desc.includes('수제') || desc.includes('명인')) {
        factors.skill = {
          score: 8,
          basis: '원문 확인: 30년 장인의 전통 수제 제조 기법 전수',
          method: 'numeric',
          rubricVersion,
        };
      }
      if (desc.includes('특산') || desc.includes('제주') || desc.includes('명산') || desc.includes('산지')) {
        factors.locality = {
          score: 8,
          basis: '원문 산지 확인: 제주 청정 산지 원재료 100% 사용',
          method: 'numeric',
          rubricVersion,
        };
      }
      if (desc.includes('한정') || desc.includes('직판') || desc.includes('지정')) {
        factors.distribution = {
          score: 6,
          basis: '원문 유통 확인: 계절 한정 수량 지정 판매처 유통',
          method: 'numeric',
          rubricVersion,
        };
      }
      if (desc.includes('연혁') || desc.includes('역사') || desc.includes('대') || desc.includes('19')) {
        factors.history = {
          score: 7,
          basis: '원문 이력 확인: 3대째 이어져 온 50년 가업 이력',
          method: 'numeric',
          rubricVersion,
        };
      }
      if (desc.includes('이야기') || desc.includes('유래') || desc.includes('전설')) {
        factors.story = {
          score: 7,
          basis: '원문 유래 확인: 궁중 진상품 유래와 전래 이야기 수록',
          method: 'numeric',
          rubricVersion,
        };
      }

      const suggestion: AssessmentSuggestion = {
        productNo: command.productNo,
        sourceDescription: command.description,
        rubricVersion,
        factors: factors as AssessmentSuggestion['factors'],
      };

      return { ok: true, data: suggestion };
    },

    async loadPolicy(): Promise<ActionResult<PolicyDocument>> {
      return { ok: true, data: structuredClone(policyDoc) };
    },

    async savePolicy(command: { policy: RecommendationPolicy; expectedUpdatedAt: string | null }): Promise<ActionResult<PolicyDocument>> {
      if (simulateError === 'save_failed') {
        return { ok: false, error: { code: 'save_failed', message: '정책 저장 중 서버 오류가 발생했습니다.' } };
      }
      if (simulateConflict) {
        return {
          ok: false,
          error: {
            code: 'revision_conflict',
            message: '다른 관리자가 이미 정책을 변경했습니다.',
          },
        };
      }
      if (policyDoc.updatedAt !== command.expectedUpdatedAt) {
        return {
          ok: false,
          error: {
            code: 'revision_conflict',
            message: '정책 개정 충돌: 다른 관리자가 정책을 변경했습니다. 최신 정책을 다시 불러와 주세요.',
          },
        };
      }

      try {
        const cleanPolicy = parseRecommendationPolicy(command.policy);
        policyDoc = {
          policy: structuredClone(cleanPolicy),
          updatedAt: new Date().toISOString(),
        };
        return { ok: true, data: structuredClone(policyDoc) };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: err instanceof Error ? err.message : '유효하지 않은 정책입니다.',
          },
        };
      }
    },
  };
}
