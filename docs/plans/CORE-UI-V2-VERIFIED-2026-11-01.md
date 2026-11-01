# 핵심 추천 UI 2차 검증 및 Codex 보완

검토 대상: antigravity/core-ui-v2, 4e4e4cf (후속 패치 보관 커밋 90ebb00).
통합 시험 브랜치: codex/core-ui-validation, C:/Users/xshon/Desktop/ondapmvp-core-codex.
안티그래비티 원본 브랜치의 소스는 수정하지 않았다. UI 커밋 1b37cad / 4e4e4cf만 통합 시험 브랜치로 가져왔다. 이미지가 중복 포함된 대형 패치 보관 파일은 통합하지 않았다.

## 원본 보완에서 확인한 정상 동작

- npm test 255개 통과 및 타입 검사 통과를 재현했다.
- 실제 Chrome / 3320 프리뷰에서 10개 → 100개 요청 실패 후에도 성공 결과는 10개/220,000원으로 유지되고, 100개 입력 초안과 오류 안내가 분리됨을 확인했다.
- 실제 워크벤치에서 근거 수정 → 다른 상품 → 원래 상품 이동 후 미저장 근거가 유지됨을 확인했다.
- 코드상 강제 null 개정 우회 제거, 배송비 공통 함수 사용, 전체 예산 링크, 원자료 편집 입력, 부분 제안의 null 보존을 확인했다.

## 추가로 재현하고 직접 수정한 결함

| 결함 | 실제 UI 재현 | 수정 후 검증 |
| --- | --- | --- |
| 최신 개정 수락 후에도 저장 충돌 반복 | 별도 관리자가 메모리 자료 수정 → 저장 충돌 → 최신 개정 수락 → 저장 → 다시 충돌 | 초안의 실제 updatedAt을 저장 기대값으로 사용하고 최신 저장 기준도 갱신. 같은 흐름에서 재저장 성공 |
| 정책 저장 대기 중 추가 입력 유실 | E=60 저장 요청 → 응답 대기 중 55 입력 → 응답 도착 → 60으로 되돌아감 | 편집 세대를 검사하여 55 유지, 추가 입력이 미저장임을 표시. 다음 저장에서 서버 메모리 값도 55 확인 |
| AI 대기 중 수기 점수·근거 유실 | AI 요청 → 응답 대기 중 9점/새 근거 입력 → 응답 도착 → AI의 8점/이전 근거로 교체 | 요청 시점 이후 작성 내용이 바뀌면 제안을 자동 적용하지 않음. 9점과 수기 근거 유지 확인 |
| 평가 저장 도중 추가 입력을 저장 완료로 오인 | 저장 요청 시점 원자료와 이후 입력을 구분하지 않고 dirty=false / 검수 완료로 표시할 수 있음 | 추가 입력은 보존하되 미저장·미검수로 유지. 요청 당시 자료만 저장됐음을 구분하고 다음 저장에서 추가 입력 반영 확인 |

다른 상품의 늦은 오류/최신 조회가 현재 상품의 충돌 패널에 섞이지 않도록 상품번호·요청 번호도 확인한다. 저장 기준 업데이트만으로 현재 편집을 초기화하지 않으며, 저장/취소 완료 시 불필요한 편집 캐시를 정리한다. 근거 입력란에는 접근 가능한 이름을 추가했다.

주요 수정: src/app/recommendation-ui/admin-workbench.tsx, admin-weights-editor.tsx.

## 함수 흉내가 아닌 실제 편집기 검사

테스트 화면: /core-ui-review. test/browser/core-ui-review-harness.tsx가 수정 대상 React 컴포넌트를 그대로 사용한다. 추천/저장/AI 응답의 도착 시각만 수동 제어하며, 저장은 가상 메모리 자료에만 수행한다. React 내부 상태를 강제로 바꾸거나 UI 저장 로직을 테스트 안에 재구현하지 않는다.

실행 예:

```powershell
$env:ONDAP_DATA_SOURCE='local'
$env:ONDAP_CORE_UI_REVIEW='1'
npm run dev -- -p 3331 --webpack
```

기본적으로 시험 경로는 404다. development + ONDAP_CORE_UI_REVIEW=1에서만 열린다. 원래 3000번 서버를 재시작하지 않는다.

Codex cua_repl에서 실제 브라우저 탭을 위 화면에 연 뒤:

```js
const checks = await import('file:///C:/Users/xshon/Desktop/ondapmvp-core-codex/scripts/e2e/core-ui-review.mjs');
await checks.checkConflict(tab);
await checks.checkPolicyEditDuringSave(tab);
await checks.checkAiEditDuringRequest(tab);
await checks.checkAssessmentEditDuringSave(tab);
```

네 검사 모두 실제 UI 입력·버튼·표시 결과와 저장된 메모리 값을 검사하여 PASS를 확인했다. 이 네 건은 npm test 255개와 별도의 브라우저 검사다. 네트워크 지연을 흉내 낸 독립 계산 함수 테스트가 아니다.

수정 후 최종 확인: npm test 255개 통과, npm run typecheck 통과, next build --webpack 통과. 빌드된 로컬 production 서버에서 시험 플래그를 켠 상태로도 /core-ui-review 및 /recommendation-ui 모두 HTTP 404를 확인했다. 검증용 3320/3331 서버는 종료했다.

증거 이미지: ../screenshots/core-ui-v2-policy-input-lost.png (수정 전), core-ui-v2-policy-input-preserved.png (수정 후 보존·재저장).

## 현재 범위와 남은 일

이 결과는 UI 컴포넌트의 로컬 검증·보완이다. 실제 Supabase 저장/권한/동시 요청, 실제 AI 응답 품질, 기존 고객/관리자 운영 경로와 새 서버 액션 연결, 결재·로그·공유·포장 왕복 연결, 최종 PC/모바일 통합 검증은 아직 완료하지 않았다.
운영 push/deploy, 운영 DB 쓰기, 카페24 변경은 하지 않았다. 안티그래비티 원본 소스와 기존 작업 폴더를 보존했다.
