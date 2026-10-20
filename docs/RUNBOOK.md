# 온답 추천 엔진 — 구축 기록과 복제·전환 플레이북

작성 2026-10-20. 이 문서 하나로 ① 오늘 무엇을 어떤 순서로 했는지, ② 다른 환경에 그대로 복제하는 방법, ③ 심이사 자료(카페24 계정, 알고리즘 산식, 상품)가 오면 바로 할 일을 확인할 수 있다.

> **비밀값은 이 문서와 저장소에 넣지 않는다.** 키·비밀번호는 각 서비스 대시보드와 로컬 `.env.local`(git 제외)에만 둔다. 계정 이메일 같은 식별 정보도 저장소에는 적지 않는다.

---

## 0. 현재 상태 한눈에 보기

| 항목 | 상태 | 위치 |
| --- | --- | --- |
| 추천 엔진 (격식지수 가안 v0.1, 자체 모델) | 동작 | `src/engine/`, `data/config/engine.json` |
| 고객 화면 (입력 → 추천 3개) | 운영 중 | https://ondapmvp.vercel.app |
| 관리자 (상품 지표·가중치·32개 시나리오 검증) | 운영 중, 로그인 필요 | https://ondapmvp.vercel.app/admin |
| 데이터 | Supabase DB | 프로젝트 ref `ornwnlmprkxqwsheuzdb` |
| 카페24 연동 (Front API 상품 조회) | 동작 | 테스트몰 `axopenlab`, 앱 "온답 추천엔진 DEV" |
| 카페24 쇼핑몰 버튼 (PC·모바일) | 적용됨 | 메인 배너 바로 아래 |
| AI 점수 제안 (Gemini) | 배포됨, **실제 호출 성공은 미확인** | 관리자 상품 편집 화면 |
| 테스트 | 75개 통과 | `npm test` |
| 상품 지표 | **가안 40개, 검토 0/40** | 관리자에서 검토 필요 |

**주소**
- 운영: https://ondapmvp.vercel.app (예전 주소 `ondapmvp-iota.vercel.app`은 307로 넘겨줌)
- 로컬: http://127.0.0.1:3000 (**localhost 말고 127.0.0.1**, 이유는 단계 14)
- 저장소: https://github.com/xshoner/ondapmvp (`main` 푸시 = 자동 배포)

**관련 문서**
- 사전 질문지: https://claude.ai/artifact/3aNw1G4EVqY8wcoLnEnUPd
- 1차 PRD 기초자료(회의 분석): https://claude.ai/artifact/GpctUgHH3TZP1V688vQf5T (로컬 사본: `../온답 ‘추천 알고리즘’ 엔진 개발 1차 PRD 기초자료.docx`)
- 원자료: `../요구사항.txt`, `../심이사 회의.txt`, `../KakaoTalk_*.png|jpg`(시안 5장)

---

## 1. 리소스·계정 지도

| 서비스 | 리소스 | 소유 | 메모 |
| --- | --- | --- | --- |
| GitHub | `xshoner/ondapmvp` | 개발 측 | 공개 여부 확인 필요. 심이사 실데이터 들어오면 비공개 권장 |
| Vercel | 프로젝트 `ondapmvp` (팀 `xshoner-3375's projects`) | 개발 측, **Hobby(비상업)** | 서울 리전 icn1, Node 24.x. 운영 전 Pro 또는 고객 명의로 이전 |
| Supabase | 프로젝트 `ornwnlmprkxqwsheuzdb` | 개발 측 개인 계정 | **Claude의 Supabase MCP 연결 계정과 다른 계정** → SQL은 대시보드 SQL Editor에서 직접 실행 |
| 카페24 | 테스트몰 `axopenlab` | 개발 측 | 진열 영역: PC 5·9번 |
| 카페24 개발자센터 | 앱 "온답 추천엔진 DEV" (Web, 제작중) | 개발 측 | Client ID `mTzBW0tmAlLtHYR3aCdueH`(공개 가능 값). 심사요청 안 함 |
| Google Gemini | API 키 (무료 등급) | 개발 측 | 무료 등급은 입력이 Google 서비스 개선에 쓰일 수 있음 |
| Claude Docs | 질문지, PRD 기초자료 | 개발 측 | 위 링크 |

### 환경변수

| 이름 | 로컬 `.env.local` | Vercel | 비밀 | 용도 |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | O | O (Plain) | 아님 | Supabase 주소 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | O | O (Plain) | 아님(공개용, RLS가 막음) | Supabase 접속 |
| `ONDAP_DATA_SOURCE` | `supabase` | `supabase` | 아님 | `local`이면 `data/` JSON 사용 |
| `CAFE24_MALL_ID` | `axopenlab` | O | 아님 | 쇼핑몰 ID |
| `CAFE24_CLIENT_ID` | O | O | 아님 | 카페24 앱 Client ID |
| `CAFE24_FRONT_API_KEY` | O | O (**Sensitive**, Production) | **비밀** | 상품 조회 Basic 인증 (없으면 호출 한도 5) |
| `CAFE24_REDIRECT_URI` | O | - | 아님 | 앱 설치 주소 생성용 (`scripts/cafe24-install-url.mjs`) |
| `CAFE24_SCOPE` | `mall.read_product` | - | 아님 | 〃 |
| `CAFE24_API_VERSION` | 비움 | - | 아님 | 비우면 개발자센터 설정 버전 |
| `ondap_ai` | **아직 없음** | O (**Sensitive**, Production) | **비밀** | Gemini API 키 |
| `ONDAP_AI_MODEL` | 선택 | 미설정(기본 `gemini-3.6-flash`) | 아님 | 기본 모델 |
| `ONDAP_AI_FALLBACK_MODEL` | 선택 | 미설정(기본 `gemini-flash-latest`) | 아님 | 대체 모델, 빈 값이면 끔 |
| `ONDAP_ALLOW_LOCAL_ADMIN` | - | - | 아님 | 로컬 모드 운영 빌드에서 관리자 허용(쓰지 말 것) |

> Vercel에서 `ondap_ai`, `CAFE24_FRONT_API_KEY`는 **Production에만** 등록돼 있다. Preview 배포에서도 쓰려면 Preview에도 추가.

---

## 2. 오늘 진행한 순서 (누가 · 무엇을 · 주의사항)

표기: 👤 = 사용자가 직접, 🤖 = Claude가 수행

### 단계 1. 의뢰 자료 분석 → 사전 질문지
- 👤 고객 자료(요구사항, 시안 5장) 전달
- 🤖 분석: 핵심 난제는 ① 카페24 상품 연결 ② 인쇄물 자동생성. 사전 질문지 문서 작성(위 링크)
- **주의:** AI 이미지 생성은 한글을 정확히 못 쓴다 → 인쇄물은 "템플릿 + AI 문구" 방식 권장

### 단계 2. 1차 회의(52분) 분석 → PRD 기초자료
- 👤 회의록(`심이사 회의.txt`) 전달
- 🤖 결정 사항 정리: 1단계 별도 엔진 + 관리자 + 검증, 2단계 카페24 메인 연결, 3단계(여유 시) 이미지, 포장·장바구니 옵션은 2027년. **개발 마감 12/20, 결과보고 12/31**
- 🤖 공수 추정 1·2단계 약 29~41일, 예산 100만 원은 공수 대비 크게 부족(내부 메모)
- **미완료:** 심이사에게 보낼 **PRD 초안은 아직 보내지 않았다** (회의에서 "오늘~내일 송부" 약속)

### 단계 3. MVP 단계 계획
1. 로컬 엔진 → 2. 로컬 화면 → 3. 내 카페24 연동 → 4. Supabase → 5. Vercel + 카페24 버튼 → 6. 심이사 자료로 교체
- 카페24는 미확인 요소가 많아 **3단계를 4단계보다 먼저** 검증

### 단계 4. 카페24 개발자센터 앱 · 연결
1. 👤 개발자센터 → Apps → App 관리 → 앱 만들기: 유형 **Web**, 관리 상품명 `온답 추천엔진 DEV`
2. 👤 App URL / Redirect URI 입력 → **localhost 거부됨**("URL 형식을 확인해 주세요") → 임시로 쇼핑몰 주소 사용
   - App URL `https://axopenlab.cafe24.com`, Redirect URI `https://axopenlab.cafe24.com/api/cafe24/callback`
3. 👤 권한: 상품(Product) **읽기만**. OIDC·고객 권한 체크 안 함. Front API 사용함. 저장. **심사요청 누르지 않음**
4. 👤 "테스트 실행" → 쇼핑몰이 열림(이건 **설치가 아님**)
5. 🤖 `scripts/cafe24-product-test.mjs`로 조회 → **403 `Uninstalled app`**
6. 🤖 `scripts/cafe24-install-url.mjs`로 설치(동의) 주소 생성 → 👤 운영자 계정으로 열고 동의 → **하얀 빈 화면 + 주소창 `code=`** (정상)
7. 🤖 재조회 → 200, 상품 40개(11~50번)
8. 👤 Front API Key를 `.env.local`에 입력 → Basic 인증 확인(호출 한도 40)

**주의사항**
- Front API도 **앱 설치(운영자 동의)가 필수**. 미설치면 403 Uninstalled app
- Redirect URI는 개발자센터 값과 **글자 하나까지 같아야** 한다 (처음에 다른 값으로 주소를 만들었다가 다시 만듦)
- App URL·Redirect URI는 **https + 도메인만** 가능. IP·localhost 불가
- Client ID만 보내면 호출 버킷 5, Front API Key로 Basic 인증하면 40
- 동의 후 빈 화면은 정상. `/api/cafe24/callback` 페이지가 없을 뿐, 설치는 완료
- 개발자센터 페이지는 JS 렌더링이라 자동 수집으로 읽을 수 없음. API 문서는 apidocs.cafe24.com
- Client Secret·Front API Key는 화면에 `****`로 가려져 있다. 채팅에 붙여 넣지 말 것

### 단계 5. 1단계 로컬 엔진
- 🤖 상품 동기화(`npm run sync`), 엔진(`src/engine/`), 32개 시나리오 리포트(`npm run report`)
- **시행착오:** 처음 버전은 녹차·멸치·벌꿀이 **거의 모든 상황에서 1~3위** (1위 종류 3종)
  - 원인: 모든 지표가 "높을수록 좋음"이라 전 항목 고득점 상품이 어디서나 이김
  - 해결: ① 격식 적합도를 **상황별 목표 수준에 가까울수록** 좋게(target 모드) ② 행사 미지정 감점 ③ **1~3위 카테고리 중복 금지** → 1위 종류 7종
- **주의:** 엔진 변경 후에는 항상 `npm run report`로 "변별력"(1위 상품 종류 수)을 확인

### 단계 6. 자체 모델 v0.1 (심이사 자료 유사 적용)
- 🤖 지표 6개: 희소성·장인·전통성·지역 가치·격식 적합도(관리자 시안) + **신뢰·안전**(회의의 위생) + **실용성**(대량 답례)
- 🤖 가산: 선물의 의미 일치 +6(흐름도 "선물의 의미 매칭"), 소멸위기지역 +3(흐름도 "소멸위기지역 상품 매칭")
- 🤖 격식 단계(격을 갖춘 선택 / 실속 있는 정성 / 가벼운 안부의 예의), ONDAP'S PICK 문구 자동 생성
- 🤖 상품 40개 가안: `scripts/seed-attributes.mjs` (상품명만 보고 매김, `reviewed=false`)
- 결과: 1위 종류 10종. 결혼→꿀, 출산→미역·유기농쌀, 개업→천일염
- **주의:** `seed-attributes.mjs --force`는 관리자에서 고친 값을 덮어쓴다. 소멸위기지역 목록은 행안부 공식 목록과 대조 필요

### 단계 7. 2단계 화면 (Next.js 16)
- 🤖 고객 `/`, `/result` / 관리자 `/admin`, `/admin/weights`(실시간 미리보기), `/admin/verify`(32칸, 기대 정답)
- **시행착오:** 관리자 화면 **hydration 오류** — 서버(Node)와 브라우저의 날짜 표기 차이(`오후` vs `PM`) → 날짜를 직접 포맷(`kstLabel`)
- **주의:** Next 서버 코드는 `.next/`로 번들되므로 `import.meta.url` 기준 경로 금지 → `process.cwd()` 사용(`src/lib/paths.ts`)

### 단계 8. GitHub
- 👤 저장소 `xshoner/ondapmvp` 생성
- 🤖 `git init` → 비밀값 검사(`.env.local` 제외 확인) → 첫 커밋·푸시. `.gitattributes`로 줄바꿈 LF 고정
- **주의:** 커밋 전에 `.env.local`, `.next/`, `node_modules/`가 빠졌는지 `git check-ignore`로 확인

### 단계 9. 자동 보안 검토 지적 2건 (해결)
1. 관리자 저장 기능에 인증 없음 → 모든 서버 액션 첫 줄 `requireAdmin()`, 운영 빌드에서 로그인 없으면 차단, 개발 서버 `127.0.0.1` 바인딩
2. 로그인 후 이동 주소 오픈 리다이렉트(`/\evil.com`) → `/admin` 경로만 허용(`src/lib/safe-next.ts`)

### 단계 10. Supabase
1. 👤 Supabase 주소와 Publishable key 전달
2. 🤖 MCP 접근 시도 → **권한 없음**. MCP가 다른 계정(neurolens, axopenlab-lms)에 연결돼 있었음
3. 🤖 테이블·RLS SQL 작성 → PGlite(메모리 Postgres)로 실행과 권한 시나리오 12개 검증
4. 👤 SQL Editor에서 `supabase/migrations/20261020000000_init.sql` → `supabase/seed.sql` 순서로 실행
5. 👤 Authentication → Users → Add user(Auto Confirm) → `insert into public.admins …` 실행
6. 👤 "Allow new users to sign up" 끄기
7. 🤖 `ONDAP_DATA_SOURCE=supabase`로 전환 → 화면·추천 기록·로그인 보호 확인

**주의사항**
- SQL Editor는 INSERT가 성공해도 **"Success. No rows returned"**라고 표시 → 확인은 `select a.user_id, u.email from public.admins a join auth.users u on u.id = a.user_id;`, 추가는 `returning user_id`를 붙여서
- 관리자 비밀번호는 다시 볼 수 없다. **재설정 메일 링크용 화면은 앱에 없음** → 잊으면 새 사용자 만들고 `admins`에 추가
- anon으로 `admins`를 조회하면 빈 배열(기본 권한 + RLS) — 정상
- Next 16은 `middleware.ts` → **`proxy.ts`**. 서버에서 로그인 확인은 `getClaims()`(JWT 서명 검증), `getSession()` 쓰지 말 것

### 단계 11. Vercel
1. 👤 Vercel에서 GitHub 저장소 Import → 1차 배포
2. 🤖 점검: **배포된 코드가 Supabase 전환 이전 커밋**, **환경변수 0개** → 환경변수 5개 등록 → 남은 커밋 푸시 → 재배포
3. 🤖 서버 리전 iad1(미국) → `vercel.json` `icn1`(서울). `engines` `>=24` 경고 → `24.x`
4. 🤖 확인: 운영 주소 공개(200), 런타임 오류 없음
5. 👤 `CAFE24_FRONT_API_KEY`(Sensitive), `ondap_ai`(Sensitive) 등록

**주의사항**
- `*-xshoner-3375s-projects.vercel.app` 주소는 **Vercel 로그인 보호(SSO)**가 걸려 일반 방문자는 302. 외부에는 운영 주소만 사용
- 운영 주소가 `ondapmvp.vercel.app`으로 바뀌었고 `ondapmvp-iota`는 307로 넘겨줌 → 카페24 버튼·App URL은 `ondapmvp.vercel.app`으로 바꾸는 게 좋다(미적용)
- 환경변수는 **추가한 뒤 배포부터** 반영 → 등록 후 재배포(푸시 또는 Redeploy)
- Sensitive 변수는 저장 후 아무도 값을 다시 볼 수 없다(원본은 `.env.local`·각 서비스에서)
- Hobby 플랜: 런타임 로그 1시간 보관, 비상업 용도만

### 단계 12. 카페24 쇼핑몰 버튼
1. 👤 PC 디자인(카페24 PRO 디자인_기본형, `skin5`) → 스마트디자인 편집 → `index.html`
2. 🤖 위치: **메인 배너 모듈(6번 줄 근처) 바로 아래**
3. **시행착오:** 글씨가 안 보임 → 스킨 CSS가 글자색을 덮어씀 → `color:#fff !important` + 그라데이션·그림자, 문구 "✦ 내 상황에 맞는 AI 추천 선물 찾기"
4. **시행착오:** 휴대폰은 **별도 모바일 쇼핑몰(`/m`, 쇼핑몰 기본디자인)** → 버튼 없음, 상품도 0개
   - 원인: 모바일 메인 진열 모듈이 `product_listmain_1~4`(비어 있는 진열 영역), PC는 **5·9번** 사용
   - 사용자가 일부만 고치다 상단 배너 블록이 지워짐 → 🤖 **완성본 `cafe24/mobile-index.html`** 제공(진열 5·9 + 버튼, div 짝 검증) → 👤 전체 덮어쓰기
5. **시행착오:** 중간에 PC 주소에서 모바일 디자인이 보임 → PC 대표 디자인 확인·복구, 캐시
6. 🤖 최종 확인: PC·모바일 모두 버튼 + 상품 표시

**주의사항**
- 저장하면 대표 디자인이면 **즉시 실서비스 반영**. 위험한 수정은 디자인 복사본에서 먼저
- 편집 화면 **히스토리**로 저장 전 버전 복구 가능
- 반영이 안 보이면 **Ctrl+F5**, 그래도 안 되면 관리자 상단 **사이트캐시 삭제** (진열 모듈 `$cache = yes`)
- 모바일 메인 배너(`Mobile_Banner`)는 모바일 배너 미등록이라 비어 있음(디자인 → 배너/팝업에서 등록)
- 디자인 보관함의 PC/모바일 **탭과 대표 디자인 지정**을 혼동하지 말 것

### 단계 13. 관리자 계정
- 관리자 = Supabase Auth 사용자 + `public.admins` 등록. 로그인: `/login`
- 계정 이메일은 저장소에 기록하지 않는다(필요하면 Supabase → Authentication → Users에서 확인)

### 단계 14. AI 점수 제안 (Gemini)
1. 👤 Gemini 무료 모델로 시작 결정. 키 이름 `ondap_ai`, 모델 `gemini-3.6-flash`, Vercel에 등록
2. 🤖 `src/ai/suggest.ts`(프롬프트·JSON 스키마·응답 재검증), `src/ai/gemini.ts`(호출), 관리자 패널(항목별 적용/점수만/모두 적용)
3. 👤 운영에서 시도 → **503**
4. 🤖 재시도(429·500·503·504에 1초·2초 대기, 최대 3회) + 대체 모델 `gemini-flash-latest` + 서버 로그 `[ondap_ai]`
5. **미확인:** 재배포 후 실제 호출 성공 여부

**주의사항**
- `gemini-3.6-flash` 모델명은 실존 여부를 확인하지 못함. 404면 `ONDAP_AI_MODEL`을 AI Studio의 정확한 이름으로
- 로컬에서는 `.env.local`에 `ondap_ai`가 없어 실제 호출 불가 → 넣고 `npm run ai:suggest -- 23`
- **로컬 개발은 `http://127.0.0.1:3000`**: `localhost`로 접속하면 HMR 웹소켓이 무한 재연결되고 서버 액션 버튼이 "검토하는 중"에 멈춤 (서버를 127.0.0.1에만 열어 둔 탓)
- 같은 폴더에서 Next 개발 서버는 **하나만** 실행 가능
- AI는 **제안만** 한다. 저장·순위 계산은 사람과 규칙 엔진 (특허 기술 입증·설명 가능성)

---

## 3. 코드 지도

| 경로 | 역할 |
| --- | --- |
| `src/engine/` | 격식지수 계산(`formality.ts`), 추천·다양성·예산 확대(`recommend.ts`), 문구·단계(`explain.ts`), 타입 |
| `data/config/engine.json` | 지표 정의, 행사·관계 가중치, 격식 목표, 보너스, 소멸위기지역, 격식 단계 |
| `data/*.json` | 로컬 데이터(테스트·CLI용 사본). 운영 데이터는 Supabase |
| `src/data/repository.ts` | 앱의 데이터 입구(로컬/Supabase 전환) |
| `src/data/catalog.ts` | 로컬 JSON 읽기·쓰기 |
| `src/cafe24/client.ts` | 카페24 Front API |
| `src/ai/` | AI 점수 제안(Gemini) |
| `src/app/` | 고객·관리자·로그인 화면, 서버 액션(`admin/actions.ts`) |
| `src/lib/admin-guard.ts`, `safe-next.ts`, `supabase/` | 관리자 권한, 리다이렉트 검사, Supabase 클라이언트 |
| `src/proxy.ts` | 관리자 경로 세션 갱신 |
| `supabase/` | 마이그레이션(테이블·RLS), seed |
| `scripts/` | 동기화, 리포트, 추천 CLI, seed 생성, DB 내려받기, 카페24 테스트·설치 주소, AI 시험 |
| `cafe24/mobile-index.html` | 카페24 모바일 메인 완성본 |
| `test/` | 단위·시나리오 테스트 |

---

## 4. 처음부터 복제하기 (새 PC 또는 새 계정)

1. **코드**: Node 24 설치 → `git clone https://github.com/xshoner/ondapmvp.git` → `npm ci` → `cp .env.example .env.local`
2. **카페24** (단계 4와 동일)
   - 개발자센터 앱 생성(Web) → App URL·Redirect URI(https 도메인) → 상품 읽기 권한 → Front API 사용 → 저장
   - `.env.local`에 `CAFE24_MALL_ID`, `CAFE24_CLIENT_ID`, `CAFE24_FRONT_API_KEY`, `CAFE24_REDIRECT_URI`
   - `node scripts/cafe24-install-url.mjs` → 운영자 계정으로 열어 동의(빈 화면 + `code=`면 성공)
   - `node scripts/cafe24-product-test.mjs`로 200 확인 → `npm run sync`
3. **로컬로 먼저 확인**: `ONDAP_DATA_SOURCE=local` → `npm test` → `npm run dev` → http://127.0.0.1:3000
4. **Supabase** (단계 10과 동일)
   - 새 프로젝트 → SQL Editor: `supabase/migrations/20261020000000_init.sql` 실행
   - `npm run db:seed-sql` → `supabase/seed.sql` 실행
   - 관리자: Add user(Auto Confirm) → `insert into public.admins (user_id) select id from auth.users where lower(email)=lower('…') returning user_id;`
   - Allow new users to sign up 끄기
   - `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ONDAP_DATA_SOURCE=supabase`
5. **Vercel** (단계 11과 동일)
   - GitHub Import → 환경변수(1장 표) 등록 → 재배포 → 운영 주소(로그인 보호 없는 주소) 확인
6. **카페24 버튼** (단계 12와 동일): PC `index.html` 메인 배너 아래, 모바일은 진열 번호 확인 후 `cafe24/mobile-index.html` 기준으로
7. **AI**: Gemini 키 → Vercel `ondap_ai`(Sensitive) + 로컬 `.env.local` → 관리자에서 AI 점수 제안 시험

---

## 5. 심이사 자료 도착 시 플레이북

### 5-1. 심이사 카페24 계정을 받았을 때
1. **대표 계정 비밀번호 대신 부운영자 계정**을 요청(권한: 상품 조회, 디자인 편집)
2. 쇼핑몰 ID 확인 → **진열 영역 번호 확인**(PC·모바일 메인 `index.html`의 `product_listmain_N`)
3. 앱 설치
   - 우리 앱(제작중)을 심이사 몰에 설치: `CAFE24_MALL_ID`를 바꿔 `scripts/cafe24-install-url.mjs`로 주소 생성 → 심이사가 동의
   - **확인 필요:** 제작중(미심사) 앱을 다른 몰에 설치할 수 있는지. 안 되면 심이사 계정으로 개발자센터 가입 후 같은 설정으로 앱 생성
   - 앱의 App URL·Redirect URI는 Vercel 운영 주소로(`https://ondapmvp.vercel.app`, `…/api/cafe24/callback`)
4. **데이터 분리(중요):** 상품번호는 쇼핑몰마다 겹친다. 테스트몰 상품·지표와 섞이지 않게
   - 권장: **심이사 명의 Supabase 새 프로젝트**로 시작(4장 4번), 또는 기존 `products`·`product_attributes`·`scenario_expectations`·`recommendation_logs` 비우기
5. 환경변수 교체(로컬·Vercel): `CAFE24_MALL_ID`, `CAFE24_CLIENT_ID`, `CAFE24_FRONT_API_KEY`(+ Supabase 값) → 재배포
6. 관리자 → "카페24 상품 다시 가져오기" → 상품마다 **AI 점수 제안 → 검토 → 저장**
7. 심이사 쇼핑몰 PC·모바일 메인에 버튼 넣기(단계 12 주의사항 그대로)
8. `/admin/verify`에서 32개 시나리오 확인 → 심이사와 **기대 정답** 지정

### 5-2. 알고리즘 산식(특허 출원 자료)을 받았을 때
1. 청구항에서 **지표 목록·척도·가중치·계산식·제외 규칙**을 표로 뽑는다
2. 지표가 v0.1과 다르면 `data/config/engine.json`의 `indicators`(id, name, max, mode, reasonPhrase)와 `events`·`relations` 가중치를 교체
   - AI 점수 제안 프롬프트와 관리자 화면은 설정을 읽으므로 **자동으로 따라 바뀐다**
3. 계산식이 "가중 평균 + 가산" 형태가 아니면 `src/engine/formality.ts`에 **새 모델로 추가**하고 `modelVersion`으로 v0.1과 나란히 비교(검증 화면에서 두 결과 비교가 가능하도록)
4. 기존 상품 지표를 새 지표로 옮긴다(AI 점수 제안으로 재평가 → 검토)
5. `npm test`(픽스처는 독립적이라 대부분 그대로 통과), `npm run report`로 변별력 확인
6. 특허 청구항과 구현이 일치하는지 문서로 남긴다(기술성 입증 자료)
7. 민감 자료이므로 AI 무료 등급에 그대로 넣지 말 것 → 유료 등급 또는 해당 부분 제외

### 5-3. 실제 상품 정보를 받았을 때
- 카페24에 등록(진열·판매) → 다시 가져오기 → 스토리·산지 입력 → AI 점수 제안 → 검토 완료 체크
- 상품 수가 적으면(약 10개) 행사·관계 조합을 다 못 채운다 → 대체 규칙(예산 1.3배 확대) 동작 확인

### 5-4. 계정·플랜 이전 (실제 운영 전)
- Vercel: Pro 플랜 또는 심이사 명의 계정으로 프로젝트 이전, 환경변수 재등록
- Supabase: 심이사 명의 프로젝트(5-1 4번과 함께)
- Gemini: 심이사 명의 키 또는 유료 등급
- GitHub: 비공개 전환, 필요 시 심이사 쪽 저장소로 이전

### 5-5. 결과보고(12/31) 대비
- `recommendation_logs`에 고객 추천 사용 기록이 쌓인다(관리자만 조회) → 사용 실적
- `/admin/verify` 화면 캡처, `reports/scenario-report.md` → 알고리즘 검증 자료
- 개발 완료 목표 12/20, 이후 수정은 오류 수정 위주

---

## 6. 남은 일 · 미확인

| 구분 | 내용 |
| --- | --- |
| 급함 | 심이사에게 **PRD 초안 + 시연 링크 + 요청 자료 목록** 발송 |
| 확인 | 운영에서 AI 점수 제안 실제 성공, 실패 시 메시지·서버 로그 `[ondap_ai]` 확인(Hobby 로그는 1시간 보관) |
| 확인 | 운영 관리자 "카페24 상품 다시 가져오기" 동작 |
| 정리 | 카페24 버튼 링크와 개발자센터 App URL을 `https://ondapmvp.vercel.app`으로 변경 |
| 정리 | 상품 40개 지표 가안 검토(현재 0/40), 어색한 시나리오 가중치 조정 |
| 선택 | 로컬 `.env.local`에 `ondap_ai` 추가(터미널 시험용) |
| 선택 | 모바일 메인 배너 등록 |
| 다음 기능 | 추천 이유 문구 AI 생성(조합별 미리 생성·저장), 고객 자유 문장 입력 |
| 행정 | 사업자 등록(11/16 이후) → 견적서·합의서(범위·금액·지급일·소유권·비밀유지) |
| 운영 전 | Vercel Pro/고객 명의 이전, GitHub 비공개, 보안 재점검 |

---

## 7. 명령어 모음

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 → http://127.0.0.1:3000 |
| `npm test` / `npm run typecheck` | 테스트 / 타입 검사 |
| `npm run sync` | 카페24 상품 → `data/cafe24-products.json` |
| `npm run report -- 60000` | 32개 시나리오 결과표 + 변별력 |
| `npm run recommend -- 장례 상급자/어르신 50000` | 추천 1건 + 점수 내역 |
| `npm run db:seed-sql` | 로컬 JSON → `supabase/seed.sql` |
| `npm run db:pull` | Supabase → 로컬 JSON |
| `npm run ai:suggest -- 23` | AI 점수 제안 터미널 시험 (`ondap_ai` 필요) |
| `node scripts/cafe24-install-url.mjs` | 카페24 앱 설치(동의) 주소 |
| `node scripts/cafe24-product-test.mjs [상품번호]` | 카페24 연결 테스트 |
| `node scripts/seed-attributes.mjs --force` | 지표 가안 초기화(덮어씀 주의) |
