import type { RecommendationPolicy } from './contracts.ts';

// 검토용 초기 정책. 운영 전환이나 특허 산식 검증을 의미하지 않는다.
export function createDraftPolicy(): RecommendationPolicy {
  return {
    version: 'core-draft-1',
    eventBase: { funeral: 70, wedding: 70, longevity: 80, birth: 50, promotion: 80, opening: 60, thanks: 60, birthday: 40, ceremony: 70, conference: 70, anniversary: 70, holiday: 70 },
    relationShift: { senior: 15, business: 10, peer: -10, family: -15 },
    senderShift: { unknown: 0, personal: 0, company: 3, organization: 3, public: 5 },
    purposeShift: { unknown: 0, return: 0, celebration: 0, condolence: 0, commemoration: 0, promotion: -5 },
    rarityWeights: { skill: 1, locality: 1, distribution: 1, history: 1, story: 1 },
    minimumEvidenceCount: 2,
    rarityBands: [{ from: 0, min: 0, max: 100 }, { from: 40, min: 30, max: 100 }, { from: 60, min: 50, max: 100 }, { from: 80, min: 70, max: 100 }],
    scoreWeights: { eventFit: 70, priceValue: 30 },
  };
}
