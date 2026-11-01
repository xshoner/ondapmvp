# 안티그래비티 UI 개발 시작 안내

공통 계약: core-contract-v1. 기준 브랜치: codex/core-contract-v1.

작업 경로: C:/Users/xshon/Desktop/ondapmvp-core-codex. 안티그래비티는 이 브랜치를 별도 폴더에 복제하고 antigravity/core-ui 브랜치에서 작업한다. 로컬 3000번 서버를 재시작하지 말고 UI 시험에는 3320번 포트를 사용한다.

## 현재 준비된 것

- src/recommendation/contracts.ts: UI와 서버가 함께 사용하는 타입·오류·호출 계약.
- src/recommendation/validation.ts: 요청·정책·과거/신규 평가 파서. UI는 이를 복사해서 별도 작성하지 않는다.
- src/recommendation/evaluate.ts: 네트워크·저장 없는 2단계 계산 엔진.
- src/recommendation/policy.ts, rubric.ts: 검토용 정책과 평가 기준 초안.
- docs/fixtures/recommendation-core-v1.json: UI 가상 데이터 9종과 서비스 오류 4종.
- test/recommendation-core.test.ts: 산식·예산·과거 자료·순위·경계값 테스트.

화면 개발을 위한 계약과 서버 구현을 제공한다. 로컬 서버 함수 호출·저장 검증은 완료했지만 운영 Supabase 실환경·실제 AI 응답·최종 화면 통합은 미검증이다. 기존 운영 페이지에는 새 모듈을 아직 연결하지 않았다.

## 안티그래비티가 지금 시작할 작업

1. 이 브랜치의 계약/fixture와 기존 개발지시서를 자신의 별도 브랜치로 가져온다.
2. src/app/recommendation-ui/**에 UI 컴포넌트를 작성하고 RecommendationServices를 props로 받는다. 이 디렉터리는 안티그래비티 소유다.
3. 테스트/개발 전용 화면에서 가상 데이터로 입력·결과·관리자 평가·오류 화면을 검증한다.
4. 기존 운영 page.tsx를 가상 응답으로 교체하지 않는다. 실제 서버 연결은 Codex의 server.ts 제공 후 한다.
5. 공통 계약 변경 요청은 필요 필드와 이유를 보고한다. contracts.ts나 엔진을 직접 수정하지 않는다.

고객 자연어 입력·신뢰안전/실용성/분류의 추가 입력은 없다. 포장 편집기를 수정하지 않는다.

## UI 사용 예시

```ts
import type { RecommendationItem, RecommendationServices } from '@/recommendation/contracts.ts';

// 결과 카드
function scoreLabel(item: RecommendationItem) {
  // 순위는 응답 rank를 따른다. UI에서 반올림 후 재정렬하지 않는다.
  return item.recommendationScore.toFixed(1);
}

// 실제로는 React props로 주입한다. 테스트 구현은 서버 저장을 하지 않는다.
async function submit(services: RecommendationServices) {
  const result = await services.recommend({
    event: 'wedding', relation: 'business', quantity: 10,
    budget: { mode: 'total', amount: 500000 }, excludedProductNos: [],
  });
  if (!result.ok) return result.error.message;
  return result.data.items;
}
```

UI 표시 기준:
- recommendationScore=S가 대표 추천점수다.
- eventFormality=F, rarityValue=R, eventFitScore=E, priceValueScore=V를 상세에 분리 표시한다.
- V가 null이면 ‘미평가(예산 미입력)’로 표시한다.
- evidenceCount는 유효 근거 수다. assessmentMethod가 legacy-level/mixed이면 과거 평가 표시를 한다.
- rubricVersions는 계산에 실제 사용한 기준 버전, assessmentUpdatedAt은 평가 자료의 갱신 시각이다.
- ActionResult가 ok=false이면 data는 없다. 입력을 보존하고 error.code에 맞게 안내한다.

## fixture 사용법

```ts
// UI 테스트에서만 사용한다. 운영 페이지에서 fixture를 import하지 않는다.
import { coreUiFixtures as fixtures } from '../../test/fixtures/recommendation-ui.ts';
// 실제 import 상대 경로는 테스트 파일 위치에 맞춘다. 타입이 지정된 가상 데이터다.
const initialWorkspace = fixtures.workspace;
const threeCandidates = fixtures.recommendations.find((x) => x.id === 'three')!.response;
```

- workspace는 정상적인 3개 상품·3개 평가를 담은 관리자 초기 화면 자료다.
- recommendations에서 three/one/none/no-budget/total-budget/tiny-total-budget/legacy/mixed/unreviewed를 고른다.
- assessments.numeric/legacy/mixed는 같은 상품의 대안 표현 예시다. 셋을 한 상품 목록에 중복 합치지 않는다.
- errors.aiFailed/saveConflict/saveFailed/invalidInput으로 오류 UI를 검증한다.
- 수정한 평가를 테스트로 저장할 때 새 version·timestamp를 응답하는 메모리 테스트 서비스를 사용하되 test 파일에만 둔다.
- fixture를 바꾸지 않는다. 필요한 사례는 Codex에게 요청한다.

재생성: node scripts/generate-core-fixtures.ts. 기존 운영·로컬 상품 자료에는 쓰지 않고 docs/fixtures만 갱신한다.

## 서버 함수 명세: Codex 브랜치 구현 준비 완료

Codex가 src/recommendation/server.ts에 아래 함수를 구현했다. 타입 계약은 변경하지 않았다. 자신의 UI 브랜치에 파일이 아직 없다면 기존 fixture 기반 개발을 계속하고 Codex 통합 시 연결한다. 진행 중인 UI 작업을 덮어쓰거나 이 파일을 대신 작성하지 않는다.

| 내보낼 함수 | RecommendationServices 메서드 | 권한 및 동작 |
| --- | --- | --- |
| recommendForCustomer | recommend | 공개 요청 검증. 서버가 카탈로그·평가·저장 정책을 읽는다 |
| loadAdminWorkspace | loadWorkspace | 관리자 인증. 상품·평가·정책·기준표 반환 |
| loadProductAssessment | loadAssessment | 관리자 인증. 상품별 평가 조회 |
| saveProductAssessment | saveAssessment | 관리자 인증. 기대 updatedAt 검사, 검수·자료 보존 |
| suggestProductAssessment | suggestAssessment | 관리자 인증. 실제 원자료 기반 AI 제안만 반환, 저장하지 않음 |
| loadCorePolicy | loadPolicy | 관리자 인증. 저장된 정책과 updatedAt 반환 |
| saveCorePolicy | savePolicy | 관리자 인증. 정책 검증·충돌 검사 후 저장 |
| previewForAdmin | previewRecommendation | 관리자 인증. 전달한 정책으로 시험하되 저장하지 않음 |

매개변수와 응답의 최종 타입은 RecommendationServices의 각 메서드와 같다. 관리자 API를 고객 화면에서 호출하지 않는다. 고객 요청에 임의 카탈로그·점수·정책을 넣어 평가시키는 공개 API는 만들지 않는다.

추가 공통 URL 도우미는 src/recommendation/query.ts의 requestFromSearchParams / recommendationResultHref다. 전체 예산 원본과 수량·제외 상품·선택적으로 제공된 발신자/목적을 보존한다. 전체 예산 모드에서 totalBudget 원본이 없으면 임의 역산하지 않고 invalid_input을 반환하도록 호출부에서 처리한다.

검증 범위와 미완료 사항: docs/plans/CORE-SERVER-V1-VERIFICATION.md.

## 병행 작업 규칙

- Codex: src/recommendation/**와 서버/저장소/엔진/문서 어댑터/공통 fixture·테스트.
- 안티그래비티: src/app/recommendation-ui/** 및 기존 지시서의 허용 UI 파일·UI 테스트.
- 공유 파일의 양방향 동시 수정과 운영 push/deploy 금지.
- 이번 UI 완료 보고에는 계약 버전, 사용한 fixture, 실제 브라우저 확인, 실제 서버 연결 여부를 구분해서 적는다.

## 현재 한계

70/30 가중치와 수치형 평가 기준은 검토용 초기안이다. 실제 상품 비교·특허 원문 대조·운영 데이터 이관은 아직 검증하지 않았다. UI 개발 준비 완료를 운영 엔진 완성으로 보고하지 않는다.
