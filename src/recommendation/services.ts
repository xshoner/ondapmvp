import { FACTOR_IDS, type ActionResult, type AssessmentSuggestion, type ErrorCode, type RecommendationServices } from './contracts.ts';
import { evaluateRecommendation } from './evaluate.ts';
import { createDraftRubric } from './rubric.ts';
import { ContractError, parseProductAssessment, parseRecommendationPolicy, parseRecommendationRequest } from './validation.ts';
import { StoreError, type CoreStore } from './store.ts';

export interface ServiceDependencies {
  loadStore(admin: boolean): Promise<CoreStore>;
  requireAdmin(): Promise<void>;
  suggest(productNo: number, description: string): Promise<AssessmentSuggestion>;
}
export function createRecommendationServices(deps: ServiceDependencies): RecommendationServices {
  async function run<T>(admin: boolean, action: (store: CoreStore) => Promise<T>, failureCode: ErrorCode = 'unavailable'): Promise<ActionResult<T>> {
    if (admin) {
      try { await deps.requireAdmin(); } catch { return { ok: false, error: { code: 'unauthorized', message: '관리자 로그인이 필요합니다.' } }; }
    }
    try { return { ok: true, data: await action(await deps.loadStore(admin)) }; }
    catch (e) {
      if (e instanceof ContractError) return { ok: false, error: { code: 'invalid_input', message: e.message, fields: { [e.field]: e.message } } };
      if (e instanceof StoreError) return { ok: false, error: { code: e.code, message: e.message } };
      return { ok: false, error: { code: failureCode, message: '자료를 처리하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.' } };
    }
  }
  function productNo(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) throw new ContractError('productNo', '상품번호를 확인해 주세요.');
    return raw;
  }
  function expected(raw: unknown): string | null {
    if (raw === null || (typeof raw === 'string' && Number.isFinite(Date.parse(raw)))) return raw;
    throw new ContractError('expectedUpdatedAt', '조회한 자료의 수정 시각이 필요합니다.');
  }
  return {
    recommend(request) { return run(false, async (store) => { const clean = parseRecommendationRequest(request); const data = await store.load(); return evaluateRecommendation(data.products, data.assessments, clean, data.policy.policy); }); },
    loadWorkspace() { return run(true, async (store) => ({ ...(await store.load()), rubric: createDraftRubric() })); },
    previewRecommendation(command) { return run(true, async (store) => { const clean = parseRecommendationRequest(command?.request); const policy = parseRecommendationPolicy(command?.policy); const data = await store.load(); return evaluateRecommendation(data.products, data.assessments, clean, policy); }); },
    loadAssessment(no) { return run(true, async (store) => {
      productNo(no); const data = await store.load();
      if (!data.products.some((p) => p.productNo === no)) throw new StoreError('not_found', '상품을 찾지 못했습니다.');
      return data.assessments.find((a) => a.productNo === no) ?? parseProductAssessment({ productNo: no, reviewed: false, factors: {} });
    }); },
    saveAssessment(command) { return run(true, (store) => store.saveAssessment(parseProductAssessment(command?.assessment), expected(command?.expectedUpdatedAt)), 'save_failed'); },
    suggestAssessment(command) { return run(true, async (store) => {
      const no = productNo(command?.productNo);
      if (typeof command.description !== 'string' || !command.description.trim() || command.description.length > 12000) throw new ContractError('description', '상품 원자료를 입력해 주세요.');
      if (!(await store.load()).products.some((p) => p.productNo === no)) throw new StoreError('not_found', '상품을 찾지 못했습니다.');
      try { return await deps.suggest(no, command.description); }
      catch { throw new StoreError('ai_failed', 'AI 제안을 받지 못했습니다. 작성한 내용은 유지됩니다.'); }
    }); },
    loadPolicy() { return run(true, async (store) => (await store.load()).policy); },
    savePolicy(command) { return run(true, (store) => store.savePolicy(parseRecommendationPolicy(command?.policy), expected(command?.expectedUpdatedAt)), 'save_failed'); },
  };
}

// AI 응답은 원자료에 실제로 있는 연속 근거와 유효한 점수만 채택한다.
export function groundSuggestion(productNo: number, description: string, raw: unknown): AssessmentSuggestion {
  const base = parseProductAssessment({ productNo, reviewed: false, factors: {} });
  const source = raw && typeof raw === 'object' ? (raw as { factors?: unknown }).factors : undefined;
  let count = 0;
  if (Array.isArray(source)) {
    const seen = new Set<string>();
    for (const item of source) {
      if (!item || !FACTOR_IDS.includes(item.key) || seen.has(item.key)) continue;
      seen.add(item.key);
      if (!Number.isInteger(item.score) || item.score < 0 || item.score > 10 || typeof item.basis !== 'string' || !item.basis.trim() || item.basis.length > 2000 || !description.includes(item.basis)) continue;
      base.factors[item.key as typeof FACTOR_IDS[number]] = { score: item.score, basis: item.basis, method: 'numeric', rubricVersion: createDraftRubric().version }; count++;
    }
  }
  if (!count) throw new Error('원자료에 일치하는 유효 제안이 없습니다.');
  return { productNo, sourceDescription: description, factors: base.factors, rubricVersion: createDraftRubric().version };
}
