import { eventFormality, OCCASIONS, productRarity, PURPOSES, RARE_FACTORS, SENDERS, type FormalityInput, type FormalityPolicy, type ProductEvidence, type RareFactor } from './eligibility.ts';
import type { Cafe24Product, Relation } from './types.ts';

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

export interface RecommendedScenario {
  event: keyof typeof OCCASIONS;
  relation: Relation;
  sender: keyof typeof SENDERS;
  purpose: keyof typeof PURPOSES;
  eventScore: number;
  rarity: number;
  band: { min: number; max: number };
  headline: string;
  reason: string;
}

const senderPhrases: Record<keyof typeof SENDERS, string> = {
  public: '공공기관이 주관하는',
  company: '기업이 주최하는',
  organization: '단체가 진행하는',
  personal: '개인이 챙기는',
  unknown: '보내는 분의',
};

const relationPhrases: Record<Relation, string> = {
  senior: '상급자/어르신께',
  business: '거래처/공식 관계자께',
  peer: '동료/지인께',
  family: '가족/친지께',
};

const purposePhrases: Record<keyof typeof PURPOSES, string> = {
  return: '감사 답례품으로',
  celebration: '축하 선물로',
  commemoration: '기념품으로',
  condolence: '위로 선물로',
  promotion: '홍보 및 기념품으로',
  unknown: '선물로',
};

// 행사 종류와 목적이 명백히 어긋나는 조합을 배제합니다.
// - 장례(funeral): 축하(celebration)·홍보(promotion) 불가, 위로(condolence)·감사 답례(return)만 부합
// - 장례 외 행사: 위로(condolence) 목적은 축하/기념 자리에 어긋남
export function isOccasionPurposeCompatible(event: keyof typeof OCCASIONS, purpose: keyof typeof PURPOSES): boolean {
  if (purpose === 'unknown') return false;
  if (event === 'funeral') {
    return purpose === 'condolence' || purpose === 'return';
  }
  if (purpose === 'condolence') {
    return false;
  }
  // 개인 경조사(결혼, 회갑, 출산, 생일)에 홍보 목적은 부자연스러움
  if (['wedding', 'longevity', 'birth', 'birthday'].includes(event) && purpose === 'promotion') {
    return false;
  }
  return true;
}

// 검수 완료된 상품에 대해 허용 기준을 통과한 검토용 행사 예시를 최대 3개 선정합니다.
// - 행사 종류와 목적이 어긋나는 조합(장례에 축하, 결혼에 위로 등)을 배제합니다.
// - 행사 다양성을 위해 서로 다른 행사 종류를 우선 선발합니다.
// - 순서는 설명 가능한 기준(행사 격식 점수 순)으로 정렬하며, 점수 차이를 주관적 적합도 척도로 단정하지 않습니다.
export function findTopEventScenarios(
  product: Cafe24Product,
  evidence: ProductEvidence,
  policy: FormalityPolicy,
  excludedEvents?: { event: string; reason: string }[],
  limit = 3,
): RecommendedScenario[] {
  if (!evidence.reviewed) return [];
  const rarity = productRarity(evidence, policy);
  if (rarity.value === null) return [];
  if (!product.display || !product.selling || product.soldOut) return [];

  const excludedMap = new Map((excludedEvents ?? []).map((e) => [e.event, e.reason]));
  const validSenders: (keyof typeof SENDERS)[] = ['public', 'company', 'organization', 'personal'];
  const validPurposes: (keyof typeof PURPOSES)[] = ['return', 'celebration', 'commemoration', 'condolence', 'promotion'];
  const validRelations: Relation[] = ['business', 'senior', 'peer', 'family'];
  const validEvents = Object.keys(OCCASIONS) as (keyof typeof OCCASIONS)[];

  const matched: RecommendedScenario[] = [];

  for (const event of validEvents) {
    if (excludedMap.has(event)) continue;
    for (const relation of validRelations) {
      for (const sender of validSenders) {
        // 개인 경조사에서는 주최 주체를 개인으로 제한한다.
        if (['funeral', 'wedding', 'longevity', 'birth', 'birthday'].includes(event) && sender !== 'personal') continue;
        for (const purpose of validPurposes) {
          // 행사와 목적의 정합성 확인
          if (!isOccasionPurposeCompatible(event, purpose)) continue;

          const ev = eventFormality(policy, { event, relation, sender, purpose, budget: null, quantity: 1 });
          if (rarity.value >= ev.band.min && rarity.value <= ev.band.max) {
            const headline = `${senderPhrases[sender]} ${OCCASIONS[event]}에 ${relationPhrases[relation]} 드리는 ${purposePhrases[purpose]} 기준 충족 예시`;
            const reason = `행사 기준(격식 점수 ${ev.score}점, 허용 희소구간 ${Math.round(ev.band.min * 100)}~${Math.round(ev.band.max * 100)}점)을 통과한 검토용 행사 조합입니다.`;
            matched.push({
              event,
              relation,
              sender,
              purpose,
              eventScore: ev.score,
              rarity: rarity.value,
              band: { min: ev.band.min, max: ev.band.max },
              headline,
              reason,
            });
          }
        }
      }
    }
  }

  // 설명 가능한 규칙: 행사 격식 점수(ev.score) 내림차순 정렬 (높은 격식 행사 우선)
  matched.sort((a, b) => b.eventScore - a.eventScore);

  // 다양성 보장: 서로 다른 행사 종류(event)를 우선 1개씩 선발
  const picked: RecommendedScenario[] = [];
  const pickedEvents = new Set<string>();

  for (const item of matched) {
    if (!pickedEvents.has(item.event)) {
      picked.push(item);
      pickedEvents.add(item.event);
      if (picked.length >= limit) break;
    }
  }

  // 서로 다른 행사로 다 채우지 못한 경우, 남은 적격 항목 중 추가
  if (picked.length < limit) {
    for (const item of matched) {
      if (!picked.includes(item)) {
        picked.push(item);
        if (picked.length >= limit) break;
      }
    }
  }

  return picked.slice(0, limit);
}
