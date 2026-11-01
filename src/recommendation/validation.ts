import { EVENT_IDS, FACTOR_IDS, PURPOSE_IDS, RELATION_IDS, SENDER_IDS, type FactorAssessment, type ProductAssessment, type RecommendationPolicy, type RecommendationRequest } from './contracts.ts';

export class ContractError extends Error {
  readonly code = 'invalid_input';
  readonly field: string;
  constructor(field: string, message: string) { super(message); this.field = field; this.name = 'ContractError'; }
}
function fail(field: string, message = '입력값을 확인해 주세요.'): never { throw new ContractError(field, message); }
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}
function number(value: unknown, field: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(field);
  return value;
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) fail(field);
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(field);
  return value as T;
}
function timestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  const result = text(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) fail(field);
  return result;
}
export function parseRecommendationRequest(raw: unknown): RecommendationRequest {
  const v = object(raw, 'request');
  const budget = object(v.budget, 'budget');
  const mode = choice(budget.mode, ['none', 'per_item', 'total'], 'budget.mode');
  if (mode === 'none' && Object.hasOwn(budget, 'amount')) fail('budget.amount', '예산 없음에는 금액을 지정할 수 없습니다.');
  if (!Array.isArray(v.excludedProductNos) || v.excludedProductNos.length > 10) fail('excludedProductNos');
  return {
    event: choice(v.event, EVENT_IDS, 'event'), relation: choice(v.relation, RELATION_IDS, 'relation'),
    quantity: number(v.quantity, 'quantity', 1, 100000, true),
    budget: mode === 'none' ? { mode } : { mode, amount: number(budget.amount, 'budget.amount', 1, 100000000, true) },
    excludedProductNos: [...new Set(v.excludedProductNos.map((n) => number(n, 'excludedProductNos', 1, Number.MAX_SAFE_INTEGER, true)))],
    sender: choice(v.sender ?? 'unknown', SENDER_IDS, 'sender'), purpose: choice(v.purpose ?? 'unknown', PURPOSE_IDS, 'purpose'),
  };
}

export function parseProductAssessment(raw: unknown): ProductAssessment {
  const v = object(raw, 'assessment');
  const source = object(v.factors, 'factors');
  const factors = {} as ProductAssessment['factors'];
  for (const key of FACTOR_IDS) {
    const field = `factors.${key}`;
    if (!Object.hasOwn(source, key)) {
      factors[key] = { score: null, basis: '', method: 'numeric', rubricVersion: null }; continue;
    }
    const f = object(source[key], field);
    const basis = text(f.basis ?? '', `${field}.basis`, 2000);
    if (Object.hasOwn(f, 'level')) {
      if (Object.hasOwn(f, 'score')) fail(field, '과거 수준과 새 점수를 동시에 지정할 수 없습니다.');
      const level = choice(f.level, ['low', 'medium', 'high'], `${field}.level`);
      factors[key] = { score: { low: 2, medium: 5, high: 8 }[level], basis, method: 'legacy-level', rubricVersion: 'legacy-level-v1' };
    } else {
      const method = choice(f.method ?? 'numeric', ['numeric', 'legacy-level'], `${field}.method`);
      const score = f.score === null ? null : number(f.score, `${field}.score`, 0, 10, true);
      if (method === 'legacy-level' && score !== null && ![2, 5, 8].includes(score)) fail(field);
      const rubricVersion = method === 'legacy-level' ? 'legacy-level-v1' : f.rubricVersion == null ? null : text(f.rubricVersion, `${field}.rubricVersion`, 80);
      factors[key] = { score, basis, method, rubricVersion } satisfies FactorAssessment;
    }
  }
  if (typeof v.reviewed !== 'boolean') fail('reviewed');
  return { productNo: number(v.productNo, 'productNo', 1, Number.MAX_SAFE_INTEGER, true), description: text(v.description ?? '', 'description', 12000), factors, reviewed: v.reviewed, updatedAt: timestamp(v.updatedAt, 'updatedAt'), reviewedAt: timestamp(v.reviewedAt, 'reviewedAt') };
}

export function parseRecommendationPolicy(raw: unknown): RecommendationPolicy {
  const v = object(raw, 'policy');
  const version = text(v.version, 'version', 80);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(version)) fail('version');
  function values<T extends string>(rawMap: unknown, keys: readonly T[], field: string, min: number, max: number): Record<T, number> {
    const map = object(rawMap, field);
    return Object.fromEntries(keys.map((key) => [key, number(Object.hasOwn(map, key) ? map[key] : undefined, `${field}.${key}`, min, max)])) as Record<T, number>;
  }
  const rarityWeights = values(v.rarityWeights, FACTOR_IDS, 'rarityWeights', 0, 100);
  const minimumEvidenceCount = number(v.minimumEvidenceCount, 'minimumEvidenceCount', 2, 5, true);
  if (Object.values(rarityWeights).filter((weight) => weight > 0).length < minimumEvidenceCount) fail('rarityWeights', '최소 근거 수 이상의 속성 가중치가 필요합니다.');
  const scoreWeights = values(v.scoreWeights, ['eventFit', 'priceValue'], 'scoreWeights', 0, 100);
  if (scoreWeights.eventFit <= 0) fail('scoreWeights.eventFit', '예산 미입력 평가를 위해 행사 적합도 가중치는 양수여야 합니다.');
  if (!Array.isArray(v.rarityBands) || v.rarityBands.length < 1 || v.rarityBands.length > 20) fail('rarityBands');
  const rarityBands = v.rarityBands.map((rawBand) => {
    const band = object(rawBand, 'rarityBands');
    const from = number(band.from, 'rarityBands.from', 0, 100);
    const min = number(band.min, 'rarityBands.min', 0, 100);
    const max = number(band.max, 'rarityBands.max', 0, 100);
    if (min > max) fail('rarityBands');
    return { from, min, max };
  }).sort((a, b) => a.from - b.from);
  if (rarityBands[0].from !== 0 || rarityBands.some((b, i) => i > 0 && (b.from === rarityBands[i - 1].from || b.min < rarityBands[i - 1].min))) fail('rarityBands');
  const senderShift = values(v.senderShift, SENDER_IDS, 'senderShift', -20, 20);
  const purposeShift = values(v.purposeShift, PURPOSE_IDS, 'purposeShift', -20, 20);
  if (senderShift.unknown !== 0 || purposeShift.unknown !== 0) fail('unknown', '미입력 조건의 보정은 0이어야 합니다.');
  return { version, eventBase: values(v.eventBase, EVENT_IDS, 'eventBase', 0, 100), relationShift: values(v.relationShift, RELATION_IDS, 'relationShift', -100, 100), senderShift, purposeShift, rarityWeights, minimumEvidenceCount, rarityBands, scoreWeights };
}
