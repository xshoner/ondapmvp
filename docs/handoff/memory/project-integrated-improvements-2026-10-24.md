---
name: project-integrated-improvements-2026-10-24
description: OD-06/08/13/30/19/20/21/26 통합 개발과 적용 선행 조건
---

작업 브랜치 codex/ondap-integrated-improvements. 최신 원격 bb365db에서 시작했다. 코드/시험/배포 점검표는 docs/INTEGRATION-REVIEW-2026-10-24.md, docs/INTEGRATED-VERIFICATION-2026-10-24.md, docs/INTEGRATED-ROLLOUT.md.

새 DB 파일은 20261027000000_integrated_improvements.sql. 기존 운영에는 새 파일만, 새 프로젝트에는 갱신된 setup.sql. 예약 작업/운영 기록은 SUPABASE_SERVICE_ROLE_KEY와 32자 이상 CRON_SECRET를 서버에만 설정해야 한다. 운영 DB 적용·배포는 아직 하지 않았다.

주문 코드는 단일 상품 행·동일 수량·서버 요약 확인 때만 자동 입력한다. 동일 상품 여러 옵션/디자인은 OD-09 연결 전까지 수동 확인. 포장 목적은 편집기에 한해 구분하며 엔진 목적은 OD-02, 실물 규격은 OD-07 후속이다.

카탈로그는 React 요청 메모만 사용. 추천 기록은 Next after이며 쿠키 값은 미리 캡처. 전체 통계 RPC로 2만/5천 행 상한을 제거. 피드백은 요청 ID로 재시도·새로고침 중복 방지. 운영 기록과 계측에는 개인 정보/인증값을 넣지 않는다.

검증 결과와 운영 미확인 범위는 위 검증 문서를 기준으로 확인한다. 이 기록은 현재 Codex 작업의 인계 메모이며 기존 Claude 대화 기록을 덮어쓰지 않는다.
