// 격식지수 계산
//
// baseIndex       : 상황과 무관한 상품 고유 점수. 지표 점수 합 / 만점 합 × 100 (관리자 시안의 "종합 점수/40"과 같은 개념)
// formalityIndex  : 행사·관계별 가중치를 적용한 점수. Σ(가중치 × 실효점수) / Σ(가중치 × 만점) × 100
//                   - higher 지표: 실효점수 = 점수
//                   - target 지표: 실효점수 = 만점 − |목표 − 점수| × targetSlope  (목표 = 행사 목표 + 관계 보정)
// matchScore      : formalityIndex + 상황 보너스, 0~100. 추천 순위의 기준
//                   행사 일치 + / 행사 불일치 − / 관계 일치 + / 선물의 의미 일치 + / 소멸위기지역 상품 +

import type {
  EngineConfig,
  EventType,
  IndicatorContribution,
  ProductAttributes,
  Relation,
} from './types.ts';

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function indicatorWeights(config: EngineConfig, event: EventType, relation: Relation): Record<string, number> {
  const base = config.events[event]?.weights;
  const mult = config.relations[relation]?.multipliers;
  if (!base) throw new Error(`알 수 없는 행사 유형: ${event}`);
  if (!mult) throw new Error(`알 수 없는 관계: ${relation}`);
  const weights: Record<string, number> = {};
  for (const ind of config.indicators) {
    weights[ind.id] = (base[ind.id] ?? 0) * (mult[ind.id] ?? 1);
  }
  return weights;
}

export function formalityTarget(config: EngineConfig, event: EventType, relation: Relation, max: number): number {
  return clamp(config.events[event].formalityTarget + config.relations[relation].formalityShift, 0, max);
}

export function isDepopulationArea(config: EngineConfig, region: string): boolean {
  return config.depopulationAreas.includes(region);
}

export function baseIndex(config: EngineConfig, attrs: ProductAttributes): number {
  let sum = 0;
  let max = 0;
  for (const ind of config.indicators) {
    sum += attrs.scores[ind.id] ?? 0;
    max += ind.max;
  }
  return max ? round1((sum / max) * 100) : 0;
}

export interface FormalityBreakdown {
  formalityIndex: number;
  matchScore: number;
  indicators: IndicatorContribution[];
  bonuses: { reason: string; points: number }[];
}

export function scoreForSituation(
  config: EngineConfig,
  attrs: ProductAttributes,
  event: EventType,
  relation: Relation,
): FormalityBreakdown {
  const weights = indicatorWeights(config, event, relation);
  const weightedMax = config.indicators.reduce((s, ind) => s + weights[ind.id] * ind.max, 0);

  // 각 지표가 formalityIndex(100점 만점)에 기여한 점수
  const indicators: IndicatorContribution[] = config.indicators.map((ind) => {
    const score = attrs.scores[ind.id] ?? 0;
    const target = ind.mode === 'target' ? formalityTarget(config, event, relation, ind.max) : null;
    const effective =
      target === null ? score : clamp(ind.max - Math.abs(target - score) * config.targetSlope, 0, ind.max);
    const weight = weights[ind.id];
    return {
      id: ind.id,
      name: ind.name,
      score,
      target,
      effective: round1(effective),
      weight: round1(weight),
      points: weightedMax ? round1(((weight * effective) / weightedMax) * 100) : 0,
    };
  });
  const formalityIndex = round1(indicators.reduce((s, c) => s + c.points, 0));

  const eventName = config.events[event].name;
  const bonuses: { reason: string; points: number }[] = [];
  if (attrs.events.includes(event)) {
    bonuses.push({ reason: `${eventName}에 적합한 상품`, points: config.bonus.eventFit });
  } else {
    bonuses.push({ reason: `${eventName} 적합 상품으로 지정되지 않음`, points: config.bonus.eventMiss });
  }
  if (attrs.relations.includes(relation)) {
    bonuses.push({ reason: `${config.relations[relation].name}에게 적합한 상품`, points: config.bonus.relationFit });
  }
  const meaning = attrs.meanings?.[event];
  if (meaning) {
    bonuses.push({ reason: `선물의 의미: ${meaning}`, points: config.bonus.meaning });
  }
  if (isDepopulationArea(config, attrs.region)) {
    bonuses.push({ reason: `소멸위기지역(${attrs.region}) 상생 상품`, points: config.bonus.depopulation });
  }
  const bonusTotal = bonuses.reduce((s, b) => s + b.points, 0);

  return {
    formalityIndex,
    matchScore: round1(clamp(formalityIndex + bonusTotal, 0, 100)),
    indicators,
    bonuses,
  };
}
