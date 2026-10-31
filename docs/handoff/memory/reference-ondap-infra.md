---
name: reference-ondap-infra
description: "온답 MVP 인프라 식별자(Vercel·Supabase·GitHub)와 운영상 함정 — MCP 계정 불일치, SSO 보호, 127.0.0.1"
metadata:
  node_type: memory
  type: reference
  originSessionId: c8b233ef-13ef-4492-b2ea-efbe725df5be
  modified: 2026-10-20T10:36:47.725Z
---

- Vercel: 팀 `team_qyl03XzqdOia1gxvLOgQ1l3Z`(xshoner-3375's projects, Hobby), 프로젝트 `prj_4DnJ1lacxdsAtGJo8raqqvfTrufV`(ondapmvp), 리전 icn1. 운영 도메인 ondapmvp.vercel.app(공개). `*-xshoner-3375s-projects.vercel.app`은 SSO 보호라 일반 방문자 302 — 확인은 web_fetch_vercel_url로. Hobby 런타임 로그 1시간 보관. `ondap_ai`·`CAFE24_FRONT_API_KEY`는 Sensitive·Production 전용. Vercel MCP는 xshoner 계정에 연결돼 있어 env 등록·배포 조회 가능.
- Supabase: 프로젝트 ref `ornwnlmprkxqwsheuzdb`. **Claude의 Supabase MCP는 다른 계정(neurolens, axopenlab-lms)에 연결** → 이 프로젝트는 get_project/list_tables 권한 없음. SQL은 사용자가 SQL Editor에서 실행, 검증은 PGlite로 미리. 공개 읽기 확인은 REST(`/rest/v1/products`, apikey=[가림]
- GitHub: xshoner/ondapmvp, main 푸시 = Vercel 자동 배포.
- 로컬: Next dev는 `-H 127.0.0.1` → 반드시 http://127.0.0.1:3000 (localhost면 HMR 무한 재연결, 서버 액션 멈춤). 같은 폴더에 dev 서버 2개 불가 — 모드 바꿔 시험할 땐 `.env.local`의 `ONDAP_DATA_SOURCE` 전환 후 preview 재시작, 끝나면 `supabase`로 복구.
- 자동 보안 검토 플러그인이 커밋마다 돈다(관리자 인증, 오픈 리다이렉트 지적 이력).

관련: [[project-ondap-recommendation-engine]]
