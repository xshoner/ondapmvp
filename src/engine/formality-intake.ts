import { eventFormality, productRarity, RARE_FACTORS, type FormalityInput, type FormalityPolicy, type ProductEvidence, type RareFactor } from './eligibility.ts';
import type { Cafe24Product } from './types.ts';

export type Level = 'low' | 'medium' | 'high';
export interface IntakeFactor { level: Level; basis: string }
export type IntakeFactors = Partial<Record<RareFactor, IntakeFactor>>;
export const LEVELS: Record<Level, { label: string; score: number }> = {
  low: { label: '일반적인 수준', score: 2 }, medium: { label: '일부 특징이 있음', score: 5 }, high: { label: '뚜렷한 특징이 있음', score: 8 },
};

export function evidenceFromIntake(productNo: number, factors: IntakeFactors, reviewed: boolean): ProductEvidence {
  const entries = (Object.keys(RARE_FACTORS) as RareFactor[]).flatMap((key) => {
    const f = factors[key];
    if (!f || !Object.hasOwn(LEVELS, f.level) || typeof f.basis !== 'string' || !f.basis.trim()) return [];
    return [[key, { score: LEVELS[f.level].score, basis: f.basis.trim().slice(0, 2000) }]];
  });
  return { productNo, reviewed, factors: Object.fromEntries(entries) };
}

// AI가 제시한 근거는 실제 입력에 있는 문장만 남긴다. 사실 확인은 관리자가 한다.
export function groundedFactors(raw: unknown, source: string): IntakeFactors {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const result: IntakeFactors = {};
  for (const key of Object.keys(RARE_FACTORS) as RareFactor[]) {
    const entry = input[key] as Record<string, unknown> | undefined;
    if (!entry || typeof entry.level !== 'string' || !Object.hasOwn(LEVELS, entry.level) || typeof entry.basis !== 'string') continue;
    const basis = entry.basis.trim();
    if (basis && basis.length <= 500 && source.includes(basis)) result[key] = { level: entry.level as Level, basis };
  }
  return result;
}

export function assessPilotEvent(product: Cafe24Product, evidence: ProductEvidence, policy: FormalityPolicy, input: Pick<FormalityInput, 'event' | 'relation' | 'sender' | 'purpose'>, exclusion?: string) {
  if (!evidence.reviewed) throw new Error('상품 정보를 확인하고 계산한 뒤 행사 적합성을 시험해 주세요.');
  const rarity = productRarity(evidence, policy);
  if (rarity.value === null) throw new Error('상품 희소값을 계산할 수 없습니다.');
  const event = eventFormality(policy, { ...input, budget: null, quantity: 1 });
  const allowed = rarity.value >= event.band.min && rarity.value <= event.band.max;
  const unavailable = !product.display || !product.selling || product.soldOut;
  return { eventScore: event.score, rarity: rarity.value, min: event.band.min, max: event.band.max, allowed: allowed && !unavailable && !exclusion, reason: unavailable ? '현재 판매할 수 없는 상품입니다.' : exclusion ? `해당 행사 제외: ${exclusion}` : allowed ? '이 행사에 설정된 희소 기준을 충족합니다.' : '이 행사에 설정된 희소 기준을 충족하지 않습니다.', incomplete: event.incomplete };
}
