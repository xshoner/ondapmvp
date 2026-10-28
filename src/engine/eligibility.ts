import type { Catalog, Relation } from './types.ts';

export const OCCASIONS = { funeral: '장례', wedding: '결혼', longevity: '회갑/칠순', birth: '출산', promotion: '승진/취임', opening: '신축/개업', thanks: '감사', birthday: '생일', ceremony: '공식 개막식·기념식', conference: '학술·기관 행사', anniversary: '창립기념', holiday: '명절' } as const;
export const SENDERS = { unknown: '미입력', personal: '개인', company: '기업', organization: '단체', public: '공공기관' } as const;
export const PURPOSES = { unknown: '미입력', return: '감사 답례', celebration: '축하', condolence: '위로', commemoration: '기념', promotion: '홍보' } as const;
export const RARE_FACTORS = {
  skill: { name: '생산자 숙련도', guide: '경력·자격·수상·전승 근거. 0~3: 입문/일반, 4~7: 숙련 근거, 8~10: 전문성·전승 근거가 충분' },
  locality: { name: '지역적 희소성', guide: '생산 가능한 지역·생산자 범위. 0~3: 전국 보편, 4~7: 일부 지역, 8~10: 산지·생산자가 매우 제한' },
  distribution: { name: '유통 제한성', guide: '연 생산량·판매처·한정 여부. 0~3: 상시 대량, 4~7: 제한 공급, 8~10: 확인된 소량·한정 공급' },
  history: { name: '역사성', guide: '상품·제작기술의 유지 기간과 자료. 0~3: 짧거나 보편적, 4~7: 지속 이력, 8~10: 긴 전승 이력' },
  story: { name: '지역 스토리', guide: '지역 문화·인물·장소와 상품의 연결. 0~3: 연계 약함, 4~7: 구체적 연결, 8~10: 확인 가능한 강한 연결' },
} as const;
export type RareFactor = keyof typeof RARE_FACTORS;
export const RANK_FACTORS = { price: '예산 내 가격 실속', trust: '신뢰·안전', practicality: '실용성' } as const;
export interface FormalityPolicy {
  version: string;
  eventBase: Record<keyof typeof OCCASIONS, number>;
  relationShift: Record<Relation, number>;
  senderShift: Record<keyof typeof SENDERS, number>;
  purposeShift: Record<keyof typeof PURPOSES, number>;
  rarityWeights: Record<RareFactor, number>;
  bands: { from: number; min: number; max: number }[];
  rankWeights: Record<keyof typeof RANK_FACTORS, number>;
}
export interface ProductEvidence {
  productNo: number;
  reviewed: boolean;
  factors: Partial<Record<RareFactor, { score: number; basis: string }>>;
}
export interface FormalityWorkspace { format: 'ondap-formality-v2'; source: 'sample' | 'catalog'; policy: FormalityPolicy; evidence: ProductEvidence[] }
export interface FormalityInput {
  event: keyof typeof OCCASIONS;
  relation: Relation;
  sender: keyof typeof SENDERS;
  purpose: keyof typeof PURPOSES;
  budget: number | null;
  quantity: number;
}

export function initialPolicy(catalog: Catalog): FormalityPolicy {
  return {
    version: 'v2-draft-1',
    eventBase: Object.fromEntries(Object.keys(OCCASIONS).map((key) => [key, Object.hasOwn(catalog.config.events, key) ? catalog.config.events[key as keyof Catalog['config']['events']].formalityTarget * 10 : 70])) as FormalityPolicy['eventBase'],
    relationShift: Object.fromEntries(Object.entries(catalog.config.relations).map(([key, value]) => [key, value.formalityShift * 10])) as FormalityPolicy['relationShift'],
    senderShift: { unknown: 0, personal: 0, company: 3, organization: 3, public: 5 },
    purposeShift: { unknown: 0, return: 0, celebration: 0, condolence: 0, commemoration: 0, promotion: -5 },
    rarityWeights: { skill: 1, locality: 1, distribution: 1, history: 1, story: 1 },
    bands: [{ from: 0, min: 0, max: 1 }, { from: 40, min: 0.3, max: 1 }, { from: 60, min: 0.5, max: 1 }, { from: 80, min: 0.7, max: 1 }],
    rankWeights: { price: 30, trust: 40, practicality: 30 },
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('설정 형식이 올바르지 않습니다.');
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${min}~${max} 범위의 숫자를 입력해 주세요.`);
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`문자열은 ${max}자 이하여야 합니다.`);
  return value.trim();
}
function numbers<T extends string>(value: unknown, keys: readonly T[], min: number, max: number): Record<T, number> {
  const v = object(value);
  return Object.fromEntries(keys.map((key) => [key, number(Object.hasOwn(v, key) ? v[key] : undefined, min, max)])) as Record<T, number>;
}

// 파일 입력과 엔진 호출 모두 같은 경계 검증을 사용한다. 누락된 설정을 0점으로 보완하지 않는다.
export function parseWorkspace(value: unknown): FormalityWorkspace {
  const w = object(value), p = object(w.policy);
  if (w.format !== 'ondap-formality-v2' || typeof w.source !== 'string' || !['sample', 'catalog'].includes(w.source)) throw new Error('지원하지 않는 검증 파일입니다.');
  const version = text(p.version, 80);
  if (!version) throw new Error('기준 버전 이름을 입력해 주세요.');
  const rarityWeights = numbers(p.rarityWeights, Object.keys(RARE_FACTORS) as RareFactor[], 0, 100);
  const rankWeights = numbers(p.rankWeights, Object.keys(RANK_FACTORS) as (keyof typeof RANK_FACTORS)[], 0, 100);
  if (Object.values(rarityWeights).filter((n) => n > 0).length < 2 || rankWeights.trust + rankWeights.practicality <= 0) throw new Error('희소 속성 2개 이상과 예산 없는 평가의 가중치를 설정해 주세요.');
  if (!Array.isArray(p.bands) || p.bands.length < 1 || p.bands.length > 20) throw new Error('허용기준 구간은 1~20개입니다.');
  const bands = p.bands.map((x) => {
    const b = object(x), from = number(b.from, 0, 100), min = number(b.min, 0, 1), max = number(b.max, 0, 1);
    if (min > max) throw new Error('허용 하한은 상한 이하여야 합니다.');
    return { from, min, max };
  }).sort((a, b) => a.from - b.from);
  if (bands[0].from !== 0 || bands.some((b, i) => i > 0 && (b.from === bands[i - 1].from || b.min < bands[i - 1].min))) throw new Error('구간은 0부터 시작하며 중복 없이 하한이 유지되거나 높아져야 합니다.');
  const senderShift = numbers(p.senderShift, Object.keys(SENDERS) as (keyof typeof SENDERS)[], -20, 20);
  const purposeShift = numbers(p.purposeShift, Object.keys(PURPOSES) as (keyof typeof PURPOSES)[], -20, 20);
  if (senderShift.unknown !== 0 || purposeShift.unknown !== 0) throw new Error('미입력 항목의 보정은 0이어야 합니다.');
  if (!Array.isArray(w.evidence) || w.evidence.length > 5000) throw new Error('상품 근거는 최대 5,000개입니다.');
  const seen = new Set<number>();
  const evidence = w.evidence.map((x) => {
    const e = object(x), factors = object(e.factors), productNo = number(e.productNo, 1, Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(productNo) || seen.has(productNo) || typeof e.reviewed !== 'boolean') throw new Error('상품번호 중복·형식 또는 검수 상태를 확인해 주세요.');
    seen.add(productNo);
    const clean: ProductEvidence['factors'] = {};
    for (const key of Object.keys(RARE_FACTORS) as RareFactor[]) {
      if (!Object.hasOwn(factors, key)) continue;
      const f = object(factors[key]);
      clean[key] = { score: number(f.score, 0, 10), basis: text(f.basis, 2000) };
    }
    return { productNo, reviewed: e.reviewed, factors: clean };
  });
  return { format: 'ondap-formality-v2', source: w.source as FormalityWorkspace['source'], evidence, policy: {
    version, eventBase: numbers(p.eventBase, Object.keys(OCCASIONS) as (keyof typeof OCCASIONS)[], 0, 100),
    relationShift: numbers(p.relationShift, ['senior', 'business', 'peer', 'family'], -100, 100), senderShift, purposeShift, rarityWeights, bands, rankWeights,
  } };
}

export function eventFormality(policy: FormalityPolicy, input: FormalityInput) {
  for (const [values, key] of [[OCCASIONS, input.event], [{ senior: 1, business: 1, peer: 1, family: 1 }, input.relation], [SENDERS, input.sender], [PURPOSES, input.purpose]] as const) {
    if (typeof key !== 'string' || !Object.hasOwn(values, key)) throw new Error('행사·관계·주체·목적을 다시 선택해 주세요.');
  }
  const parts = { event: policy.eventBase[input.event], relation: policy.relationShift[input.relation], sender: policy.senderShift[input.sender], purpose: policy.purposeShift[input.purpose] };
  const score = Math.min(100, Math.max(0, Object.values(parts).reduce((sum, n) => sum + n, 0)));
  const band = policy.bands.findLast((b) => score >= b.from)!;
  return { score, parts, band, incomplete: input.sender === 'unknown' || input.purpose === 'unknown' };
}

export function productRarity(evidence: ProductEvidence | undefined, policy: FormalityPolicy) {
  const used = (Object.keys(RARE_FACTORS) as RareFactor[]).flatMap((key) => {
    const f = evidence?.factors[key], weight = policy.rarityWeights[key];
    return f && f.basis.trim() && weight > 0 ? [{ key, score: f.score, basis: f.basis, weight }] : [];
  });
  const sum = used.reduce((n, f) => n + f.weight, 0);
  const value = used.length >= 2 ? Math.round(used.reduce((n, f) => n + f.score / 10 * f.weight, 0) / sum * 1e12) / 1e12 : null;
  return { value, reviewed: evidence?.reviewed === true, used, coverage: used.length / Object.keys(RARE_FACTORS).length };
}

export function evaluateFormality(catalog: Catalog, raw: FormalityWorkspace, input: FormalityInput) {
  const workspace = parseWorkspace(raw), policy = workspace.policy;
  number(input.quantity, 1, 100000);
  if (!Number.isInteger(input.quantity)) throw new Error('수량은 정수여야 합니다.');
  if (input.budget !== null) number(input.budget, 1, 100000000);
  const event = eventFormality(policy, input);
  const evidence = new Map(workspace.evidence.map((e) => [e.productNo, e]));
  const attrs = new Map(catalog.attributes.map((a) => [a.productNo, a]));
  const seen = new Set<number>();
  const decisions = catalog.products.map((product) => {
    if (!Number.isSafeInteger(product.productNo) || seen.has(product.productNo)) throw new Error('카탈로그 상품번호가 잘못되거나 중복됐습니다.');
    seen.add(product.productNo);
    const a = attrs.get(product.productNo), rarity = productRarity(evidence.get(product.productNo), policy);
    const no = (code: string, reason: string) => ({ product, rarity, eligible: false, code, reason, rankScore: null as number | null, ranking: null as Record<string, number> | null, category: a?.category ?? '' });
    if (!product.display || !product.selling || product.soldOut) return no('unavailable', '품절·미진열·판매 중지');
    if (!Number.isSafeInteger(product.price) || product.price < 0 || !Number.isSafeInteger(product.price * input.quantity)) return no('price_invalid', '가격 확인 필요');
    if (!a) return no('attributes_missing', '상품 지표 미입력');
    const banned = a.excludedEvents.find((x) => x.event === input.event);
    if (banned) return no('event_banned', `행사 제외: ${banned.reason}`);
    if (!rarity.reviewed) return no('unreviewed', '상품 근거 미검수');
    if (rarity.value === null) return no('evidence_missing', '근거가 있는 유효 희소 속성이 2개 미만');
    if (rarity.value < event.band.min || rarity.value > event.band.max) return no('rarity_outside', `희소값 ${rarity.value.toFixed(3)}: 허용 ${event.band.min}~${event.band.max} 밖`);
    if (input.budget !== null && product.price > input.budget) return no('budget_exceeded', '예산 초과');
    const ranking: Record<string, number> = {};
    let total = 0, weights = 0;
    for (const key of Object.keys(RANK_FACTORS) as (keyof typeof RANK_FACTORS)[]) {
      const weight = policy.rankWeights[key];
      if (weight === 0 || (key === 'price' && input.budget === null)) continue;
      const v = key === 'price' ? 1 - product.price / input.budget! : a.scores[key] / 10;
      if (!Number.isFinite(v) || v < 0 || v > 1) return no('ranking_missing', `${RANK_FACTORS[key]} 평가값 확인 필요`);
      ranking[key] = v;
      total += v * weight; weights += weight;
    }
    return { ...no('eligible', '행사 희소 기준·판매 조건·예산 충족'), eligible: true, rankScore: Math.round(total / weights * 10000) / 100, ranking };
  });
  const ranked = decisions.filter((d) => d.eligible).sort((a, b) => b.rankScore! - a.rankScore! || a.product.price - b.product.price || a.product.productNo - b.product.productNo);
  const selected: typeof ranked = [], categories = new Set<string>();
  for (const d of ranked) {
    if (selected.length === 3) break;
    if (categories.has(d.category)) continue;
    selected.push(d); categories.add(d.category);
  }
  for (const d of ranked) if (selected.length < 3 && !selected.includes(d)) selected.push(d);
  selected.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  return {
    engineVersion: 'eligibility-v2.0', source: workspace.source, policyVersion: policy.version, input: { ...input }, event, decisions, selected,
    notice: selected.length < 3 ? `기준을 충족한 상품은 ${selected.length}개입니다. 기준을 자동 완화하지 않았습니다.` : null,
    // 당시 자료를 보존해 정책 이름이 같아도 변경된 근거로 과거 결과가 바뀌지 않게 한다.
    snapshot: structuredClone({ catalog, workspace }),
  };
}
