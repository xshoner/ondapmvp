// UI 테스트 전용. 생성기가 공통 엔진으로 만든 JSON이며 recommendation-core.test.ts가 일치 여부를 확인한다.
// 운영 page/server 모듈에서는 import하지 않는다. 테스트 상태를 바꿀 때는 structuredClone한다.
import raw from '../../docs/fixtures/recommendation-core-v1.json';
import type { ActionResult, AdminWorkspace, PolicyDocument, ProductAssessment, ProductSnapshot, RecommendationResponse, RubricDocument } from '../../src/recommendation/contracts.ts';

interface CoreUiFixtures {
  fixtureVersion: 'core-contract-v1';
  fictional: true;
  warning: string;
  rubric: RubricDocument;
  policy: PolicyDocument;
  products: ProductSnapshot[];
  workspace: AdminWorkspace;
  assessments: { numeric: ProductAssessment; legacy: ProductAssessment; mixed: ProductAssessment };
  recommendations: { id: string; response: RecommendationResponse }[];
  errors: Record<'aiFailed' | 'saveConflict' | 'saveFailed' | 'invalidInput', ActionResult<never>>;
}

// JSON 모듈은 문자열 리터럴 타입을 보존하지 않으므로, 검증된 생성물의 경계에서만 단언한다.
export const coreUiFixtures = raw as unknown as CoreUiFixtures;
