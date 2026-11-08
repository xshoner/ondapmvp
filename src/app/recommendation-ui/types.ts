import type {
  ActionResult,
  AdminWorkspace,
  AssessmentMethod,
  AssessmentSuggestion,
  Budget,
  ErrorCode,
  EventId,
  ExclusionCode,
  FactorAssessment,
  FactorId,
  PolicyDocument,
  ProductAssessment,
  ProductSnapshot,
  PurposeId,
  RecommendationItem,
  RecommendationPolicy,
  RecommendationRequest,
  RecommendationResponse,
  RecommendationServices,
  RelationId,
  RubricDocument,
  SaveAssessmentCommand,
  SenderId,
} from '../../recommendation/contracts.ts';
import {
  CONTRACT_VERSION,
  EVENT_IDS,
  FACTOR_IDS,
  PURPOSE_IDS,
  RELATION_IDS,
  SENDER_IDS,
} from '../../recommendation/contracts.ts';

export {
  CONTRACT_VERSION,
  EVENT_IDS,
  FACTOR_IDS,
  PURPOSE_IDS,
  RELATION_IDS,
  SENDER_IDS,
};

export type {
  ActionResult,
  AdminWorkspace,
  AssessmentMethod,
  AssessmentSuggestion,
  Budget,
  ErrorCode,
  EventId,
  ExclusionCode,
  FactorAssessment,
  FactorId,
  PolicyDocument,
  ProductAssessment,
  ProductSnapshot,
  PurposeId,
  RecommendationItem,
  RecommendationPolicy,
  RecommendationRequest,
  RecommendationResponse,
  RecommendationServices,
  RelationId,
  RubricDocument,
  SaveAssessmentCommand,
  SenderId,
};

export const EVENT_NAMES: Record<EventId, string> = {
  funeral: '장례·조문',
  wedding: '결혼식',
  longevity: '회갑·칠순',
  birth: '출산·돌',
  promotion: '승진·취임',
  opening: '개업·이전',
  thanks: '감사 인사',
  birthday: '생일',
  ceremony: '기념식',
  conference: '학술·세미나',
  anniversary: '창립 기념',
  holiday: '명절 선물',
};

export const RELATION_NAMES: Record<RelationId, string> = {
  senior: '상급자/어르신',
  business: '거래처/공식',
  peer: '동료/친구',
  family: '가족/친밀',
};

export const FACTOR_NAMES: Record<FactorId, string> = {
  skill: '생산자 숙련도',
  locality: '지역적 희소성',
  distribution: '유통 제한성',
  history: '역사성',
  story: '지역 스토리',
};

export const SENDER_NAMES: Record<SenderId, string> = {
  unknown: '미지정',
  personal: '개인',
  company: '기업',
  organization: '단체',
  public: '공공기관',
};

export const PURPOSE_NAMES: Record<PurposeId, string> = {
  unknown: '미지정',
  return: '답례',
  celebration: '축하',
  condolence: '조문',
  commemoration: '기념',
  promotion: '홍보',
};

export function won(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

export function formatCustomerReason(reason: string, slot?: RecommendationItem['slot']): string {
  if (
    reason === '적격 상품 중 행사 적합도와 예산 사용 비율을 종합한 점수가 가장 높습니다.' ||
    reason === '적격 상품 중 행사 적합도가 가장 높습니다.' ||
    (slot === 'standard' && reason.startsWith('적격 상품 중'))
  ) {
    return '답례큐 알고리즘이 고른 가장 1순위 추천 Pick은 이 상품!';
  }
  if (
    reason === '표준안을 제외한 적격 상품 중 단가가 가장 낮습니다.' ||
    (slot === 'practical' && reason.startsWith('표준안을 제외한'))
  ) {
    return '표준안 외 가성비 측면에서 가장 우수해요!';
  }
  return reason;
}
