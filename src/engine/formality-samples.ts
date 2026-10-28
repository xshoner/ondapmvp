import { initialPolicy, type FormalityInput, type FormalityWorkspace, type ProductEvidence, type RareFactor } from './eligibility.ts';
import type { Catalog } from './types.ts';

// 모든 이름·경력·생산량·점수·가격은 가상이다. 실상품이나 생산자 사실로 저장하지 않는다.
export function formalitySamples(base: Catalog): { catalog: Catalog; workspace: FormalityWorkspace } {
  const samples = [
    { id: 900001, name: '[가상] 청자 장인 차도구', price: 45000, category: '공예', scores: [9, 9, 8, 9, 8], bases: ['경력 30년·전승 3대라는 가상 기록', '한 지역의 공방 2곳에서 제작한다는 가상 자료', '연 500점·판매처 2곳이라는 가상 자료', '제작기법 100년 전승이라는 가상 자료', '지역 가마터와 연결된 가상 문화자료'], trust: 8, practicality: 6 },
    { id: 900002, name: '[가상] 전통 장류 답례 세트', price: 30000, category: '발효식품', scores: [8, 7, 7, 8, 7], bases: ['경력 20년이라는 가상 생산자 기록', '한 지역의 원료를 사용한다는 가상 자료', '연 3,000세트·판매처 5곳이라는 가상 자료', '제조 방식 50년 유지라는 가상 기록', '지역 발효문화와 연결한 가상 설명'], trust: 9, practicality: 9 },
    { id: 900003, name: '[가상] 보편 유통 곡물 간식', price: 15000, category: '간식', scores: [4, 2, 2, 3, 3], bases: ['일반 제조 경력 3년이라는 가상 기록', '전국 생산 가능한 원료라는 가상 자료', '상시 대량 생산·전국 판매라는 가상 자료', '현대적 제조법이라는 가상 설명', '지역과의 연결이 약한 가상 이야기'], trust: 10, practicality: 10 },
  ];
  const catalog: Catalog = {
    config: structuredClone(base.config),
    products: samples.map((s) => ({ productNo: s.id, name: s.name, price: s.price, display: true, selling: true, soldOut: false, image: null, detailImage: null, url: '' })),
    attributes: samples.map((s) => ({ productNo: s.id, region: '가상 지역', category: s.category, scores: { trust: s.trust, practicality: s.practicality }, events: [], relations: [], excludedEvents: [], meanings: {}, tags: ['검증용 가상 자료'], story: '실제 판매·인증·전승 사실이 아닙니다.', reviewed: false })),
  };
  const keys: RareFactor[] = ['skill', 'locality', 'distribution', 'history', 'story'];
  const evidence: ProductEvidence[] = samples.map((s) => ({ productNo: s.id, reviewed: true, factors: Object.fromEntries(keys.map((k, i) => [k, { score: s.scores[i], basis: s.bases[i] }])) }));
  return { catalog, workspace: { format: 'ondap-formality-v2', source: 'sample', policy: initialPolicy(base), evidence } };
}

export const SAMPLE_INPUT: FormalityInput = { event: 'ceremony', relation: 'business', sender: 'public', purpose: 'return', budget: 50000, quantity: 100 };
