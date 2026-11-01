import type { RubricDocument } from './contracts.ts';

// 실제 상품 비교 검토 전의 초안. AI가 이 문구만으로 사실을 단정하거나 자동 검수하지 않는다.
export function createDraftRubric(): RubricDocument {
  const entries = {
    skill: { name: '생산자 숙련도', guide: '제작 경험·전승·숙련에 관한 확인 자료를 검토합니다.', low: '일반적인 생산 경험이라는 자료', middle: '지속된 전문 생산 경험과 제작 방식', high: '숙련·전승·성과와 현재 상품 제작의 직접적 연결' },
    locality: { name: '지역적 희소성', guide: '생산 가능한 산지·생산자 범위를 확인합니다.', low: '여러 지역에서 보편적으로 생산됨', middle: '특정 산지의 생산 특징이 확인됨', high: '생산 가능한 산지·생산자가 매우 제한된 자료' },
    distribution: { name: '유통 제한성', guide: '실제 생산량·공급 주기·판매처를 확인합니다.', low: '상시 대량 공급·광범위 유통', middle: '일부 판매처 또는 계절 공급', high: '한정 생산량과 유통 범위가 구체적으로 확인됨' },
    history: { name: '역사성', guide: '제조 이력과 현재 제작 방식의 연속성을 확인합니다.', low: '보편적인 현대 제조 방식', middle: '일정 기간 유지된 제조 이력', high: '긴 전승 이력과 현재 제조 방식의 연결이 확인됨' },
    story: { name: '지역 스토리', guide: '지역 문화·인물·장소와 상품의 연결 근거를 확인합니다.', low: '상품과 지역의 연계가 약하다고 확인됨', middle: '구체적인 지역 연결 자료', high: '지역 문화·장소와 상품의 직접적인 연결 자료가 충분함' },
  };
  const factors = Object.fromEntries(Object.entries(entries).map(([key, f]) => [key, {
    name: f.name, guide: f.guide,
    anchors: [
      { score: 0, description: '해당 특징이 없다고 확인한 자료가 있을 때만 사용합니다. 자료 없음은 미평가입니다.' },
      { score: 2, description: f.low },
      { score: 5, description: f.middle },
      { score: 8, description: f.high },
      { score: 10, description: '8점 기준을 넘어서는 차별적 근거를 담당자가 비교 확인한 경우에만 사용합니다. 특정 인증·연수만으로 자동 부여하지 않습니다.' },
    ],
  }])) as RubricDocument['factors'];
  return { version: 'numeric-draft-1', status: 'draft', factors };
}
