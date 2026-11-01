import { FACTOR_IDS, type ErrorCode, type PolicyDocument, type ProductAssessment, type ProductSnapshot, type RecommendationPolicy } from './contracts.ts';
import { ContractError, parseRecommendationPolicy } from './validation.ts';
import { createDraftPolicy } from './policy.ts';

export class StoreError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.code = code; }
}
export interface CoreData { products: ProductSnapshot[]; assessments: ProductAssessment[]; policy: PolicyDocument }
export interface CoreStore {
  load(): Promise<CoreData>;
  saveAssessment(assessment: ProductAssessment, expectedUpdatedAt: string | null): Promise<ProductAssessment>;
  savePolicy(policy: RecommendationPolicy, expectedUpdatedAt: string | null): Promise<PolicyDocument>;
}

export function nextTimestamp(previous: string | null): string {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}
export function checkRevision(current: string | null, expected: string | null): void {
  if (current !== expected) throw new StoreError('revision_conflict', '다른 저장 내용이 있습니다. 현재 입력을 보존하고 최신 자료를 확인해 주세요.');
}
export function assertReviewable(a: ProductAssessment, policy: RecommendationPolicy): void {
  if (!a.reviewed) return;
  const valid = FACTOR_IDS.filter((id) => {
    const f = a.factors[id];
    return f.score !== null && f.basis.trim() && policy.rarityWeights[id] > 0 && (f.method === 'legacy-level' || f.rubricVersion?.trim());
  });
  if (valid.length < policy.minimumEvidenceCount) throw new ContractError('factors', `검수 완료에는 근거와 기준 버전이 있는 속성 ${policy.minimumEvidenceCount}개 이상이 필요합니다.`);
}
export function storedFactors(a: ProductAssessment): Record<string, unknown> {
  const result = Object.fromEntries(FACTOR_IDS.map((id) => {
    const f = a.factors[id];
    if (f.method === 'legacy-level' && f.score !== null) return [id, { level: ({ 2: 'low', 5: 'medium', 8: 'high' } as Record<number, string>)[f.score], basis: f.basis }];
    return [id, f];
  }));
  // DB JSON 제한보다 여유를 둔다. 실패를 데이터 잘라내기로 해결하지 않는다.
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 12000) throw new ContractError('factors', '평가 근거의 전체 용량이 큽니다. 원문을 보존하고 핵심 근거를 짧게 정리해 주세요.');
  return result;
}
export function policyFromConfig(config: Record<string, unknown>): RecommendationPolicy {
  if (config.coreRecommendation !== undefined) return parseRecommendationPolicy(config.coreRecommendation);
  const draft = createDraftPolicy();
  // 기존 v2 행사·희소 정책은 보존한다. v1 지표·순위 가중치는 이관하지 않는다.
  const old = config.formalityV2 as Record<string, unknown> | undefined;
  if (!old) return draft;
  return parseRecommendationPolicy({ ...draft, version: 'core-migrated-draft-1', eventBase: old.eventBase, relationShift: old.relationShift, senderShift: old.senderShift, purposeShift: old.purposeShift, rarityWeights: old.rarityWeights, rarityBands: Array.isArray(old.bands) ? old.bands.map((b: { from: number; min: number; max: number }) => ({ from: b.from, min: b.min * 100, max: b.max * 100 })) : undefined });
}
