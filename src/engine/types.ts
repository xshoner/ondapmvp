// 카페24에서 가져온 상품 기본 정보 (가격·진열·이미지는 카페24가 원본)
export interface Cafe24Product {
  productNo: number;
  name: string;
  price: number;
  display: boolean;
  selling: boolean;
  soldOut: boolean;
  image: string | null;
  detailImage: string | null;
  url: string;
}

export type EventType =
  | 'funeral'
  | 'wedding'
  | 'longevity'
  | 'birth'
  | 'promotion'
  | 'opening'
  | 'thanks'
  | 'birthday';

export type Relation = 'senior' | 'business' | 'peer' | 'family';

// 격식지수 지표 정의 (특허 자료가 오면 이 목록을 교체)
// mode: higher = 높을수록 좋음, target = 상황별 목표 수준에 가까울수록 좋음
export interface Indicator {
  id: string;
  name: string;
  description: string;
  max: number;
  mode: 'higher' | 'target';
  // 추천 문구에 쓰는 한 줄 (이 지표가 점수를 많이 만들었을 때)
  reasonPhrase: string;
}

// 온답 관리자가 상품마다 입력하는 정보. 카페24 상품번호로 연결된다.
export interface ProductAttributes {
  productNo: number;
  region: string;
  category: string;
  scores: Record<string, number>;
  events: EventType[];
  relations: Relation[];
  excludedEvents: { event: EventType; reason: string }[];
  // 행사별 선물의 의미 (예: 출산 → "미역은 산모의 회복을 바라는 전통 선물")
  meanings: Partial<Record<EventType, string>>;
  // 결과 화면 해시태그 (상품명·설명에 근거한 것만)
  tags: string[];
  story: string;
  reviewed: boolean;
}

export interface EngineConfig {
  modelVersion: string;
  indicators: Indicator[];
  events: Record<EventType, { name: string; formalityTarget: number; weights: Record<string, number> }>;
  relations: Record<Relation, { name: string; formalityShift: number; multipliers: Record<string, number> }>;
  // target 지표에서 목표와 1 차이 날 때 깎이는 점수
  targetSlope: number;
  bonus: { eventFit: number; eventMiss: number; relationFit: number; meaning: number; depopulation: number };
  // 소멸위기(인구감소)지역. 상품 region이 여기 있으면 지역 상생 가산
  depopulationAreas: string[];
  // 격식 적합도 점수로 붙이는 단계 이름 (높은 기준부터)
  tiers: { minFormality: number; label: string }[];
  diversity: { maxPerCategory: number };
  budgetRelaxRatio: number;
  resultCount: number;
}

export interface Catalog {
  products: Cafe24Product[];
  attributes: ProductAttributes[];
  config: EngineConfig;
}

export interface RecommendInput {
  event: EventType;
  relation: Relation;
  budgetMax?: number;
  quantity?: number;
  // 고객이 결과에서 "이건 빼고 다시"로 뺀 상품번호
  exclude?: number[];
}

export interface IndicatorContribution {
  id: string;
  name: string;
  score: number;
  // target 지표일 때만: 이 상황의 목표 수준과, 목표와의 거리를 반영한 실효 점수
  target: number | null;
  effective: number;
  weight: number;
  points: number;
}

export interface ScoredProduct {
  product: Cafe24Product;
  attributes: ProductAttributes;
  baseIndex: number;
  formalityIndex: number;
  matchScore: number;
  indicators: IndicatorContribution[];
  bonuses: { reason: string; points: number }[];
  tier: string;
  reason: string;
}

export interface Exclusion {
  productNo: number;
  name: string;
  reason: string;
}

export interface RecommendResult {
  input: RecommendInput;
  results: ScoredProduct[];
  excluded: Exclusion[];
  relaxedBudget: number | null;
  notice: string | null;
}
