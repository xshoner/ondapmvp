# 온답 추천 엔진 — 작업 규칙

온답(답례 큐레이션)의 격식지수 추천 엔진 + 포장 디자인 + 카페24 연동. 처음이면 [docs/CLONE.md](docs/CLONE.md)(복제·전체 그림) → [docs/RUNBOOK.md](docs/RUNBOOK.md)(단계별 기록·심이사 플레이북) 순서로 읽는다.

**새 계정·새 PC에서 처음 열었거나 "인계"라는 말이 나오면** [docs/handoff/README.md](docs/handoff/README.md)부터 읽는다. 이전 대화 전체(`CONVERSATION-HISTORY.md`), Claude 기억(`memory/`), 고객 원자료(`source/`)가 거기 있다. 큰 작업을 마치면 `npm run handoff:export`로 갱신해 함께 커밋한다.

## 소통
- 사용자에게는 **항상 한국어**로 답한다. 기술 용어는 쉬운 말로 풀어 쓴다
- 사용자에게 무언가를 해 달라고 하기 전에 **왜 필요한지 먼저 설명**한다 (처음 듣는 작업을 이유 없이 요청하지 않는다)

## 비밀값·계정
- 키·비밀번호는 저장소·문서·커밋·채팅 출력에 넣지 않는다. `.env.local`(git 제외)과 Vercel Sensitive 변수에만
- 관리자 이메일, 쇼핑몰 로그인 아이디 같은 계정 정보도 저장소에 적지 않는다. 예외는 `docs/handoff/`(대화 이력·기억 원문, **비공개 저장소 전제**, 비밀번호·키는 가림). 저장소를 공개로 바꾸자고 하면 먼저 이 폴더를 지우고 git 기록에서도 없애야 한다고 알린다
- 로그인 폼에 비밀번호를 대신 입력하지 않는다. 카페24 비회원 주문조회 비밀번호도 사용자가 직접 입력
- Vercel Sensitive 변수(`CAFE24_FRONT_API_KEY`, `ondap_ai`)는 복호화·출력하지 않는다

## 개발
- Node 24 (`.ts`를 그대로 실행). 개발 서버 `npm run dev` → **http://127.0.0.1:3000** (localhost 금지: HMR·서버 액션이 멈춘다). 같은 폴더에서 개발 서버는 하나만
- Next.js 16 App Router: `src/proxy.ts`(middleware 아님), 서버에서 로그인 확인은 `getClaims()`, `error.tsx`는 `retry` prop
- 데이터 입구는 `src/data/repository.ts`·`packaging-repository.ts` (`ONDAP_DATA_SOURCE` local|supabase). 화면 순서는 `eventIds()`·`relationIds()` (jsonb가 키 순서를 섞는다)
- 바꾼 뒤: `npm test` → `npm run typecheck` → 화면이면 미리보기로 확인 → 커밋. `main` 푸시 = Vercel 운영 배포
- 화면 흐름 검증: 로컬 모드 개발 서버를 띄운 채 `npm run e2e` (data/는 자동 백업·복원). DB 규칙은 `npm run e2e:db`, 인쇄 PDF QR은 `npm run e2e:pdf` (처음 한 번 `npm --prefix scripts/e2e ci`). 무엇이 어디 있는지는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 설정 점검: `npm run doctor` (배포까지: `npm run doctor -- https://ondapmvp.vercel.app`)

## DB (Supabase)
- 스키마 변경은 `supabase/migrations/`에 **새 파일**로. 운영 DB에는 사용자가 SQL Editor에서 직접 실행한다 (Claude의 Supabase MCP는 다른 계정에 연결돼 있어 이 프로젝트에 접근 못 함)
- 마이그레이션·seed를 바꾸면 `npm run db:setup-sql`로 `supabase/setup.sql`을 갱신 (테스트가 확인)
- 보안 정의 함수는 `set search_path = ''`, 관리자 판별은 `private.is_admin()`. PostgREST는 한 번에 1000행 → `range()`로 나눠 읽기

## 카페24
- Front API는 앱 설치(운영자 동의) 필수. App URL·Redirect URI는 https 도메인만
- 쇼핑몰 쪽 코드는 `public/cafe24/ondap-helper.js`(배포와 함께 바뀜)와 `cafe24/ondap-cta.html`. 주소를 바꾸면 `npm run cafe24:snippets -- https://주소`
- 스킨 수정은 사용자가 카페24 편집기에서 한다. 저장 즉시 실서비스 반영

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
