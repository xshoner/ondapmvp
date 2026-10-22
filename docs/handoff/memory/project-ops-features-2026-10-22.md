---
name: project-ops-features-2026-10-22
description: "CR·CD·CO·AM·AP·AS 기능 상태와 운영 DB 마이그레이션 실행 여부(20261025 완료, 20261026 미실행)"
metadata:
  node_type: memory
  type: project
  originSessionId: 0c65b06d-2416-45f0-9aea-30c6e22a766c
  modified: 2026-10-22T03:06:14.580Z
---

2026-10-22: 작업 리스트 문서의 CR 9·CD 10·CO 4·AM 9·AP 7·AS-02/06/07 모두 배포 완료(마지막 커밋 7e808cd).
운영 DB: `20261025000000_operations.sql`은 사용자가 실행 완료. `20261026000000_feedback_hardening.sql`(추천 의견 표 + 기록·접수 시각/상품명 위조 방지 트리거)은 **아직 미실행**(10/22 사용자에게 요청함). 실행 전에도 앱은 동작하지만 고객 의견은 저장되지 않고 실적 '고객 목소리'에 SQL 안내가 뜬다. 다음 마이그레이션은 20261027… 이후 이름으로.
Supabase publishable 키가 git 기록(docs/handoff 이전 커밋)에 남아 있어 키 교체를 권했다(사용자 결정 대기).

**Why:** 새 표·트리거에 기대는 기능은 운영 SQL이 먼저여야 제대로 쌓인다. 사용자가 SQL Editor에서 직접 실행한다(Claude의 Supabase MCP는 다른 계정).
**How to apply:** 다음 작업 시작 때 20261026 실행 여부를 먼저 묻고, 실행됐으면 이 기억을 '실행 완료'로 고친다. 화면 검증은 저장소의 `npm run e2e`(로컬 모드 개발 서버를 같은 폴더에서), DB는 `npm run e2e:db`. 푸시 방법은 [[reference-github-push-account]].
