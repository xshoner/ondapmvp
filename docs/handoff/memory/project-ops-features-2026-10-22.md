---
name: project-ops-features-2026-10-22
description: "CR·CD·CO·AM·AP·AS 기능 상태와 운영 DB 마이그레이션 실행 여부(20261025·20261026 운영 적용 완료)"
metadata:
  node_type: memory
  type: project
  originSessionId: 0c65b06d-2416-45f0-9aea-30c6e22a766c
  modified: 2026-10-23T06:06:25.597Z
---

2026-10-22: 작업 리스트 문서의 CR 9·CD 10·CO 4·AM 9·AP 7·AS-02/06/07 모두 배포 완료(마지막 커밋 7e808cd).
운영 DB: `20261025000000_operations.sql`은 사용자가 실행 완료. `20261026000000_feedback_hardening.sql`(추천 의견 표 + 기록·접수 시각/상품명 위조 방지 트리거)은 **2026-10-23 적용 완료**. Codex가 ondap CLI 프로필로 미적용 구성요소 12개를 확인한 뒤, 사용자의 명시적 승인으로 단일 트랜잭션에 적용했다. 별도 연결에서 구성요소 12개·권한 4개가 모두 정상임을 확인했다. 다음 마이그레이션은 20261027… 이후 이름으로.
Supabase publishable 키가 git 기록(docs/handoff 이전 커밋)에 남아 있어 키 교체를 권했다(사용자 결정 대기).

**Why:** 새 표·트리거에 기대는 기능은 운영 SQL이 먼저여야 제대로 쌓인다. 운영 DB 변경은 프로젝트를 확인하고 사용자의 승인을 받은 뒤 실행한다. 현재 CLI의 `--profile ondap`에서 온답 프로젝트에 접근할 수 있다(다른 기본 프로필과 구분).
**How to apply:** 20261026은 운영 적용 완료이며 재실행하지 않는다. 상태 조회는 `supabase/checks/feedback-hardening.sql`. 화면 검증은 저장소의 `npm run e2e`(로컬 모드 개발 서버를 같은 폴더에서), DB는 `npm run e2e:db`. 푸시 방법은 [[reference-github-push-account]].
