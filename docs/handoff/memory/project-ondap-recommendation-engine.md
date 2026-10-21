---
name: project-ondap-recommendation-engine
description: "온답(답례큐) 격식지수 추천 엔진 용역 — 고객 심이사, 범위·마감, 10/21 기준 완료 상태, 다음 할 일(PRD 초안)"
metadata:
  node_type: memory
  type: project
  originSessionId: c8b233ef-13ef-4492-b2ea-efbe725df5be
  modified: 2026-10-21T10:45:44.103Z
---

고객 심이사(온답/답례큐, 사회적기업 지원사업)의 답례품 추천 엔진 개발 건. 2026-10-20 1차 회의에서 범위 확정:
- 1단계: 특허 출원한 '격식지수' 기반 추천 엔진 + 관리자 + 검증 도구 (별도 웹서비스)
- 2단계: 카페24 메인 버튼 → 추천 3개 → 카페24 상품 상세
- 3단계: 인쇄물 이미지. 포장은 원래 2027 고도화였으나 10/21에 앞당겨 구현함
- 개발 완료 2026-12-20, 결과보고 2026-12-31. 예산 100만 원 책정(공수 29~41일 대비 부족). 개발 측 사업자 등록 2026-11-16 이후

**2026-10-21 기준 상태 (모두 커밋·배포·운영 확인):** 엔진 v0.1, 고객·관리자 화면, Supabase, Vercel, 카페24 연동, 포장 디자인(스티커 편집 → 코드 → 카페24 주문서 자동 입력 → 인쇄 PDF A4/A3), 디자인 전면 개편, 편의 기능(공유·내 디자인·되돌리기·실적·AI 일괄 제안), 신뢰감 마감(OG 그림·격식지수 소개·404·아이콘). 복제 도구: `supabase/setup.sql`, `npm run doctor`, `npm run cafe24:snippets`, `docs/CLONE.md`, 저장소 `CLAUDE.md`. 실제 주문 시험은 사용자 결정으로 생략(심이사 몰에서 하기로).

**다음 할 일:** 심이사 PRD 초안(시연 링크, 요청 자료 목록, 구현 범위, 추가 범위 제안) — 사용자 확인 대기 중.

**Why:** 심이사가 카페24 계정·알고리즘 산식·상품을 보내면 즉시 전환해야 함. 회의에서 약속한 PRD 초안은 아직 미발송.
**인계 장치 (2026-10-21):** 계정이 막힐 수 있어 `ondap-mvp/docs/handoff/`(README 순서, 대화 이력 전체, 이 기억 파일 사본, 고객 원자료)를 만들고 비공개 저장소에 올림. 큰 작업 뒤 `npm run handoff:export`(+`--zip`) → 커밋. 새 환경은 `npm run handoff:restore`. 대화 원본은 `온답/_handoff/raw/`(저장소 밖).
**How to apply:** 새 세션은 먼저 `ondap-mvp/docs/CLONE.md`(전체 그림·복제) → `docs/RUNBOOK.md`(21단계 기록, 5장 심이사 플레이북, 6장 남은 일)를 읽는다. 계정 식별: Supabase 프로젝트 소유 계정과 온답 관리자 로그인 계정은 둘 다 wonderajae@naver.com(사용자 제공, 저장소에는 기록 안 함). 카페24 테스트몰 로그인 ID는 axopenlab. 비밀번호는 어디에도 저장하지 않는다. 관련: [[reference-cafe24-front-api]], [[reference-ondap-infra]], [[feedback-korean-and-credentials]].
