---
name: project-ops-features-2026-10-22
description: "CR·CD(배포 완료)와 CO·AM·AP 20개 기능 상태, 운영 DB 마이그레이션 20261025 실행 여부"
metadata:
  node_type: memory
  type: project
  originSessionId: 0c65b06d-2416-45f0-9aea-30c6e22a766c
  modified: 2026-10-22T01:11:22.472Z
---

2026-10-22: 작업 리스트 문서의 CR 9개·CD 10개는 배포 완료. CO 4개(CO-01·03·04·05), AM 9개, AP 7개(AP-01·02·04~08)는 커밋 0089dcb로 개발·검증 완료.
CO·AM·AP는 운영 DB에 `supabase/migrations/20261025000000_operations.sql`을 먼저 실행해야 새 기능이 동작한다(사용자가 SQL Editor에서 실행). 코드는 SQL 전에 배포돼도 접수 목록은 열리게 되어 있다(42703 대체 조회).

**Why:** 다시 주문·변경 이력·상태 시각·진행 상황 조회가 새 칸·함수·표에 기대므로, 운영에서는 SQL을 먼저 실행해야 한다.
**How to apply:** 배포 전에 사용자에게 SQL 실행 여부를 확인한다. 실행됐으면 이 기억을 '실행 완료'로 고친다. 검증 도구(PGlite, headless Chrome)는 [[reference-headless-verify]], 푸시 방법은 [[reference-github-push-account]].
