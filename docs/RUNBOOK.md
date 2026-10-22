# 온답 추천 엔진 — 구축 기록과 복제·전환 플레이북

작성 2026-10-20, 갱신 2026-10-21. **새 환경에 빨리 복제하려면 [CLONE.md](CLONE.md)부터.** 이 문서 하나로 ① 오늘 무엇을 어떤 순서로 했는지, ② 다른 환경에 그대로 복제하는 방법, ③ 심이사 자료(카페24 계정, 알고리즘 산식, 상품)가 오면 바로 할 일을 확인할 수 있다.

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
| AI 점수 제안 (Gemini) | 운영 동작 확인(10/21). 기본 모델이 503(혼잡)이면 대체 모델 `gemini-flash-latest`가 응답 | 관리자 상품 편집 화면 |
| 포장 디자인 (포장 스타일 + 무료 스티커 편집 → 디자인 코드 → 카페24 주문서 자동 입력 → 인쇄 PDF) | 운영 동작 확인(10/21). 실제 주문 시험은 심이사 몰에서 | `/packaging`, `/admin/packaging` |
| 테스트 | 98개 통과 | `npm test` |
| 복제 도구 | `supabase/setup.sql`(DB 한 번에), `npm run doctor`(설정 점검), `npm run cafe24:snippets`(쇼핑몰 코드) | [CLONE.md](CLONE.md) |
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

### 단계 15. 포장 디자인 (스티커 편집기, 2026-10-21)
1. 👤 기획: 추천 → 상품 → 포장 스타일 → 스티커 꾸미기(사진·추천 이미지·문구) → 저장. 관리자에 스타일·추천 이미지·추천 문구 메뉴
2. 👤 결정: 포장은 **실물 스타일 선택**(인쇄 아님), 스티커 **원형·사각 × 4·6cm**, **무료 포함**, "단계는 적게, 가장 편하게", 주문 연결은 **A안**(디자인 코드를 카페24 주문서 추가항목에 적기)
3. 🤖 예시 이미지(`../00001~00003.png` 포장, `../011~018.png` 스티커)를 웹용 webp로 줄여 `public/packaging/`에 넣음(3MB → 100~300KB)
4. 🤖 DB: `supabase/migrations/20261021000000_packaging.sql` — 표 4개(`packaging_styles`, `design_images`, `design_texts`, `designs`), RLS, 저장소 2개(`packaging-assets` 공개, `design-files` 비공개), 예시 데이터. PGlite로 권한 17가지 검증
5. 🤖 고객 화면 `/packaging?product=&qty=&event=&relation=&budget=` (추천 결과의 "🎀 이 상품으로 포장 꾸미기")
   - 한 화면: ① 포장 스타일 3개 ② 인쇄물(스티커 무료 / 엽서·띠지 준비 중 / 인쇄물 없이) ③ 모양·크기 + 캔버스 + 이미지·문구 탭
   - **처음부터 행사에 맞는 추천 이미지를 깔아 둠** → 바로 저장해도 됨. 이미지가 없는 행사(장례 등)는 추천 문구 한 줄
   - 이미지: 내 사진(JPG·PNG 10MB, 사용 권한 동의 필수, 해상도 낮으면 경고), 추천 이미지(행사 → 공통 → 나머지 순), AI 이미지 만들기(**준비 중 버튼**), 바탕색
   - 문구: 추천 문구(행사·공통 먼저, 나머지는 "더 보기"), 글꼴 4종(고딕·명조·바탕·손글씨, 모두 OFL), 크기, 색, 테두리, 그림자. `{받는분}` `{보내는분}` `{날짜}`가 문구에 있으면 이름 칸이 나타나고 비우면 ○○○로 보임
   - 끌어서 이동, 모서리로 크기·회전, 자르는 선(빨강)·안전선(회색) 안내
   - 저장: 브라우저에서 **300dpi PNG**(재단 여백 사방 2mm 포함, 4cm → 520px, 6cm → 756px, 원형은 원 밖 투명)를 만들어 서버 액션으로 보냄 → 코드 `OD-XXXX-XXXX` 발급, 자동 복사 시도, "주문하러 가기"(카페24 상품 상세)
6. 🤖 관리자 `/admin/packaging`: 디자인 접수(코드 검색, 미리보기, **인쇄 파일 받기**, 상태 접수 → 주문 확인 → 인쇄 완료/취소, 카페24 주문번호·메모) / 포장 스타일 / 추천 이미지(분류별) / 추천 문구(분류별). '사용'은 스타일 전체·분류별 **최대 10개**, 올리는 이미지는 브라우저에서 1200px webp로 줄여 저장
7. 👤 **할 일:** SQL Editor에서 마이그레이션 실행, 카페24 주문서 추가항목 "온답 포장 디자인 코드" 만들기(아래)

**카페24 주문서 추가항목 (A안)**
- 쇼핑몰 관리자 → 쇼핑몰 설정 → 주문 설정 → 주문서 추가항목(메뉴 이름은 관리자 화면 기준으로 확인) → 항목 추가
- 항목명 `온답 포장 디자인 코드`, 입력 형식 텍스트, **필수 아님**(포장 꾸미기를 안 한 고객도 주문 가능), 안내 문구 "포장 꾸미기에서 받은 코드(OD-XXXX-XXXX)를 붙여 넣어 주세요"
- 주문이 들어오면: 주문 상세의 추가항목 코드 → 온답 관리자 디자인 접수에서 검색 → 주문번호 적고 "주문 확인" → 인쇄 파일 받기 → 인쇄 후 "인쇄 완료"

**주의사항**
- 표를 만들기 전(SQL 미실행)에는 고객 화면이 "포장 꾸미기를 준비하고 있어요"로 나온다(오류 아님)
- Konva(캔버스)는 브라우저 전용이라 `next/dynamic`의 `ssr:false`로 불러온다(`packaging-editor.tsx`)
- 캔버스는 CSS 변수 글꼴을 못 쓴다 → `src/app/fonts.ts`의 `stickerFontFamilies`로 실제 글꼴 이름을 넘기고, 저장 전 `document.fonts.load`로 기다린다
- Supabase 저장소 이미지를 캔버스에 그릴 때 `crossOrigin='anonymous'`가 없으면 내보내기가 막힌다(캔버스 오염)
- 6cm 인쇄 파일이 약 0.9MB → 서버 액션 본문 한도를 `next.config.ts`에서 4MB로 올림(Vercel 요청 한도 4.5MB 안쪽, 파일 자체는 3MB까지 받음)
- 고객이 올린 사진 원본은 저장하지 않는다. 인쇄 파일에만 300dpi로 들어가고, 디자인 정보에는 `upload`로만 남음
- 다시 저장하면 **새 코드**가 나온다(이전 코드도 접수 목록에 남음 → 주문서에 적힌 코드 기준으로 처리)
- 같은 브라우저 창이 가려져 있으면 ResizeObserver·requestAnimationFrame이 멈춘다 → 편집기 첫 크기는 바로 재고, 내보내기 대기는 setTimeout으로(자동 점검 중 발견)
- 고객 저장은 로그인 없이 누구나 가능(RLS로 '접수' 상태만 추가 허용). 남용이 보이면 요청 횟수 제한을 붙인다
- 운영 흐름 확인(10/21): 진짜 코드로 상품(수량 30) → 비회원/회원 주문서 자동 입력 → 관리자 접수·인쇄 파일 받기까지 OK. **실제 주문 제출은 생략, 심이사 몰에서 시험**(테스트몰은 무통장입금 계좌가 없어 결제 단계 불가). 시험 접수 OD-PR4N-HKPP·OD-BA3B-WKKA는 '취소' 처리
- 관리자로 로그인한 크롬은 쇼핑몰 상단 "쇼핑몰 관리자 기능 사용함" 상태에서 바로 구매가 반응하지 않을 수 있다 → '사용안함'으로 바꾸거나 시크릿 창으로 시험
- 비회원 주문은 '비회원 주문조회 비밀번호'가 필수(카페24 기본)

**카페24 도우미 스크립트 (코드 → 주문서 자동 연결)**
- 문제: 코드를 받은 뒤 상품 페이지 수량이 1개로 돌아가고, '바로 구매'에서 로그인 화면이 나와 막힌 느낌, 코드를 직접 붙여 넣어야 했다
- 해결: '주문하러 가기' 주소에 `ondap_code`·`ondap_qty`를 붙이고, 쇼핑몰에서 `public/cafe24/ondap-helper.js`가 이어받는다
  - 상품 상세: 수량 자동 선택(`#quantity` 값 + change), 화면 위쪽 안내 띠
  - 로그인 화면(`noMember=1`): '비회원 구매'로도 주문 가능 안내
  - 주문서: 항목 이름 "온답 포장 디자인 코드"로 칸을 찾아 자동 입력, 칸이 없으면 복사 버튼
  - 주문 완료(`order_result.html`): 기억한 코드 삭제. 기억은 브라우저 localStorage 24시간
- 👤 스킨에 한 줄: 디자인 편집 → `layout/basic/layout.html`의 `</body>` 바로 위, **그리고 `order/orderform.html` 맨 아래** (PC·모바일 스킨 각각, 모두 4곳). 주문서는 결제용 레이아웃을 따로 써서 layout.html만으로는 실리지 않음
- 휴대폰은 앱이 처음부터 `/m/` 주소로 보낸다(PC 주소로 가면 카페24가 /m/으로 넘기며 `ondap_code`를 버림)
- 수량은 카페24 상품 스크립트가 로딩 뒤 1로 되돌리므로 4초 동안 몇 번 더 맞춘다(고객이 직접 바꾸면 멈춤)
- 추가 항목 칸은 상품마다 생긴다(`oa_content[항목|상품번호]`) → 코드를 받은 상품 칸에만 넣는다
  `<script src="https://ondapmvp.vercel.app/cafe24/ondap-helper.js" defer></script>`
- 스크립트를 고치면 Vercel 배포만으로 쇼핑몰에 반영된다(스킨 재수정 불필요). 운영 주소가 바뀌면 이 한 줄도 바꿀 것
- 주의: 카페24에서 '바로 구매'를 누르면 로그인 화면이 먼저 나오는 게 정상(아래 '비회원 구매' 버튼). 관리자로 로그인한 브라우저에서는 상단·우측에 관리자 도구가 보이는데 고객에게는 안 보인다

### 단계 16. 인쇄 PDF·묶어 받기·최적화·안정성 점검 (2026-10-21)
1. 👤 결정: 인쇄용 판걸이는 A4·A3 둘 다, 여러 건 묶어 받기, 다른 추천 상품에도 포장 버튼, 이어서 최적화·안정성 점검
2. 🤖 인쇄 PDF (`src/packaging/sheet.ts`, `print-pdf.ts`, `/admin/packaging/print/[code]/sheet?paper=A4|A3&fill=1`)
   - 실제 크기 mm, 칸 = 스티커 + 재단 여백 2mm, 용지 여백 6mm. 장당 6cm A4 12·A3 24, 4cm A4 24·A3 54
   - 마젠타 0.25pt 칼선, 네 모서리 재단 표시, 위쪽에 코드·주문번호·장 번호, 아래쪽에 "100% 크기로 인쇄" 안내 (기본 글꼴이라 영문만)
   - 이미지는 PDF에 한 번만 넣고 재사용 → 장 수가 늘어도 1MB 안팎. 한 번에 200장까지, 넘으면 잘라 내지 않고 거절
3. 🤖 묶어 받기: 접수 목록에서 선택 → 브라우저가 한 건씩 받아 ZIP(PNG+PDF)으로 묶음 (Vercel 응답 4.5MB 한도 때문에 서버에서 묶지 않음)
4. 🤖 추천 결과의 다른 두 상품 카드에 "🎀 포장 꾸미기"
5. 🤖 최적화
   - 한글 글꼴을 가변 글꼴로, 포장 전용 글꼴(바탕·손글씨)은 `src/app/packaging/fonts.ts`로 → 모든 페이지 CSS 477KB→160KB(gzip 160→53KB)
   - 포장 화면 썸네일을 `next/image`로 (첫 화면 이미지 약 1.6MB→0.27MB). Supabase 공개 저장소를 `remotePatterns`에 등록
   - 관리자 목록 미리보기를 160px webp 썸네일(sharp)로, 목록 조회에서 draft 제외
6. 🤖 안정성
   - 고객 저장 요청 횟수 제한(접속 주소당 10분 20회, 인스턴스 메모리 기준), 전체 오류 안내 화면(`src/app/error.tsx`, Next 16.3은 `retry` prop), 보안 헤더(X-Frame-Options 등)
   - 코드 검토 에이전트 지적 8건 반영: DB 제약·접수 폭주 제한(`20261022000000_packaging_hardening.sql`), PDF·썸네일 경로에서 DB 값 재검사(규격·크기), 주문번호 형식(숫자·영문·하이픈), 내보내기 전 이미지 로딩 대기, 관리자 액션 권한 오류를 화면 오류 대신 메시지로, 자산 이미지 주소를 우리 저장소로 제한, 도우미 스크립트는 주문서에 넣은 뒤 1시간이면 코드를 잊음
7. 👤 SQL Editor에서 `supabase/migrations/20261022000000_packaging_hardening.sql` 실행 → 🤖 운영 확인(10/21): 공개 키로 잘못된 규격·남의 파일 경로를 직접 넣으면 제약 위반(23514)으로 거절, 정상 저장은 그대로 됨

**주의사항**
- 공개 키로 고객이 저장하는 구조라, 서버를 거치지 않는 직접 호출은 DB 제약·폭주 제한으로만 막는다. 완전히 막으려면 Supabase 서비스 키(서버 전용 비밀값)를 Vercel에 넣고 서버에서만 쓰게 바꾼다(운영 전 검토)
- Vercel Hobby는 이미지 최적화 횟수 한도가 있다. 실제 운영(Pro 이전) 때 사용량 확인
- 인쇄 색은 RGB 그대로. 심이사 인쇄 거래처가 정해지면 CMYK·칼선 별도 파일 등 규격에 맞춘다

### 단계 17. 추천 없이 '포장만 꾸미기' 입구 (2026-10-21)
1. 👤 문제 제기: 추천을 원하지 않고 상품을 직접 고른 고객도 포장 디자인만 쓸 수 있어야 한다
2. 🤖 카페24 상품 상세(PC·모바일) 구매 버튼 아래 "🎀 포장·스티커 꾸미기 (무료)" 버튼 — 도우미 스크립트가 붙이므로 **스킨 수정 없음**
   - 누르는 순간의 수량을 넘김 → `/packaging?product=N&qty=Q&from=cafe24`, 돌아가기는 "‹ 상품으로", 저장 뒤 "주문하러 가기"는 같은 창
   - 화면 아래 고정 구매 막대(#orderFixArea 등)에는 넣지 않음. 앱 주소는 스크립트 src에서 읽음
3. 🤖 온답 `/packaging/pick`: 상품 검색·분류 → 편집기 (`from=pick`). 메인 화면에 "추천 없이 원하는 상품의 포장만 꾸미기" 링크
4. 🤖 편집기: "어떤 자리인가요?" 행사 칩(고르면 그 행사 이미지·문구가 먼저, 화면이 자동으로 깐 바탕은 새 행사 것으로 교체, 고객이 넣은 문구는 유지), 수량 조절
5. 🤖 확인: 카페24 모바일 상품에서 수량 15 → 버튼 → 편집기 수량 15·돌아가기 링크 정상, PC 버튼 위치 정상

**주의사항**
- 장바구니에 여러 상품을 담아도 코드는 상품마다 따로 받는다(카페24 추가 항목 칸도 상품마다 생김). 한 주문에 같은 스티커를 쓰는 '주문 단위 포장 디자인'은 PRD 후속 항목
- 개발 모드(StrictMode)는 첫 효과를 두 번 돌린다 → 편집기 첫 바탕은 `started` 표시로 한 번만 깐다

### 단계 18. 디자인 전면 개편 (2026-10-21)
1. 👤 요청: 고객·관리자 화면 모두 아마추어 느낌을 없애고 전문적·고급스럽게, 밋밋하지 않되 산만하지 않게, UI/UX 고도화
2. 🤖 방향: 경조사 봉투와 낙관에서 가져온 단정한 인상. 토큰은 `src/app/globals.css` 맨 위 `:root`
   - 바탕 `--paper` 백자, 글자 `--ink` 먹, 주요 버튼 `--pine` 소나무, 등급 `--brass` 놋쇠, **인주 `--seal`은 격식지수 도장에만**
   - 글꼴: 제목·숫자 Hahmlet(가변), 본문 Noto Sans KR(가변) — `src/app/fonts.ts`
   - 예전 변수 이름(`--green`, `--gold`, `--red` 등)은 새 토큰을 가리키게 남겨 둠(인라인 스타일 호환)
3. 🤖 화면: 메인(경조사 한자 타일, 관계 목록, 수량 스테퍼, 조건 요약 버튼), 추천 결과(격식지수 도장, 가격 표, 고른 이유, 다른 단계는 가로 목록), 포장 꾸미기·상품 고르기·로그인·오류, 관리자(흰 상단 메뉴·밑줄 위치·화면 제목)
4. 🤖 카페24 메인 버튼 완성본: `cafe24/ondap-cta.html` (PC·모바일 공통 블록, 링크 ondapmvp.vercel.app). 👤 스킨 index.html의 예전 '온답 AI 답례 추천 버튼' 블록을 통째로 교체. 모바일 메인 전체본 `cafe24/mobile-index.html`도 반영됨
5. 주의: 피해야 할 것 — 모든 곳의 이모지·화살표(→)·가운뎃점 나열, 같은 그림자 카드 반복, 강조색 여러 개. 강조는 도장 한 곳에 모은다

### 단계 19. 고객·관리자 편의 기능 (2026-10-21)
1. 👤 결정: 결과 공유, 내 디자인 다시 보기, 편집 되돌리기, 접수 필터·CSV, 실적 대시보드, AI 지표 일괄 제안. (완성 모습 미리보기·AI 문구·견적서·마감일 안내·주문 자동 연결·접수 알림은 PRD 추가 범위)
2. 🤖 고객
   - 추천 결과 "결과 공유": 휴대폰은 기기 공유 창(카카오톡 등), PC는 주소 복사
   - 스티커 편집 "되돌리기"(최근 40단계, 0.6초 안의 연속 변경은 한 번)·"모두 지우기". 올린 사진 blob 주소는 되돌리기 때문에 지우지 않음
   - `/packaging/mine` 내 디자인: 이 기기에 저장한 최근 10개(160px 미리보기, localStorage) + 코드 조회(`lookup_design` 함수, 접속 주소당 10분 30회). 메인 화면·저장 완료 창에 입구
3. 🤖 관리자
   - 디자인 접수: 상태·접수일(한국 날짜) 거르기, 같은 조건 CSV `/admin/packaging/export`(엑셀용 BOM, `=`로 시작하는 값은 앞에 `'`)
   - 실적 `/admin/stats`: 추천 사용·포장 접수·주문 연결·인쇄 완료, 날짜별 막대(차트색 `--chart` #23805f, 검사 도구 통과), 행사·관계별, 많이 추천된 상품, 일별 CSV `/admin/stats/export`. 추천 기록은 1,000건씩 나눠 최대 2만 건
   - AI 일괄 제안 `/admin/ai-batch`: 여러 상품을 차례로(호출 사이 2.5초) 제안받고 상품마다 지금/제안 비교 → 저장. "검토 완료로 표시" 선택. 상품 지표에 `?product=번호`로 바로 열기
4. 🤖 운영 확인 중 발견·수정: 기본 모델 503 뒤 대체 모델 응답이 오지 않아 3분 넘게 멈춤 → 호출마다 40초 제한(`CALL_TIMEOUT_MS`)
5. 👤 SQL Editor에서 `supabase/migrations/20261023000000_design_lookup.sql` 실행 → 🤖 운영 확인(10/21): 접수 코드는 요약 조회, 취소·없는 코드는 빈 결과, designs 표 직접 읽기는 0행, `/packaging/mine?code=` 화면 조회·주문하러 가기 정상

### 단계 20. 신뢰감 마감 (2026-10-21)
1. 🤖 공유 미리보기: 기본 그림 `src/app/opengraph-image.tsx`, 결과별 그림 `/og/result?event=&relation=&budget=&qty=`(1순위 상품 사진·이름·격식지수 도장). 결과 화면 `generateMetadata`가 제목·설명·그림을 넣음. `metadataBase`는 `VERCEL_PROJECT_PRODUCTION_URL`(운영 ondapmvp.vercel.app)
   - 그림 속 한글: `src/og/font.ts`가 들어갈 글자만 Google Fonts에서 woff로 받음(그림 엔진은 woff2 불가). 단어 중간 줄바꿈은 줄을 직접 나누거나 `wordBreak: 'keep-all'`
   - 카카오톡은 미리보기를 오래 기억한다. 바뀐 그림이 안 보이면 카카오 개발자 도구의 '공유 디버거'에서 주소 캐시를 지운다
2. 🤖 `/formality` 격식지수 소개(관리자 설정을 그대로 읽음). 결과 도장·계산 보기·메인에서 연결
3. 🤖 기다림 화면(`loading.tsx`: 결과·포장·상품 고르기·내 디자인), `not-found.tsx`
4. 🤖 메인 "이번 달 n번 답례를 골라 드렸습니다"(10번 이상일 때만). 👤 SQL Editor에서 `supabase/migrations/20261024000000_usage_count.sql` 실행 → 🤖 운영 확인(10/21): 함수 38 반환, 기록 표 직접 읽기는 0행, 메인에 "이번 달 38번" 표시. 지금 숫자에는 개발·시험 사용이 섞여 있음 → 실제 운영(심이사 새 프로젝트) 때는 0부터
5. 🤖 아이콘: `src/app/icon.svg`(인주 마름모 표지), `apple-icon.png`, `public/icons/*`, `manifest.ts`(홈 화면 추가), 테마색
6. 🤖 운영 DB(jsonb)는 설정 키 순서를 바꾼다 → `engine/labels.ts`의 `eventIds`·`relationIds`로 화면 순서 고정

### 단계 21. 복제 도구 정리 (2026-10-21)
1. 🤖 운영 DB를 로컬로 내려받아(`npm run db:pull`) 비교: 엔진 설정은 같고(키 순서만 다름) 상품 지표 2개(34번 나주배, 48번 우전녹차)가 관리자에서 고쳐져 있었음 → `data/product-attributes.json`·`supabase/seed.sql`을 운영 기준으로 갱신
2. 🤖 `npm run db:setup-sql` → `supabase/setup.sql`: 마이그레이션 5개 + seed를 한 파일로. 새 프로젝트 SQL Editor에서 한 번 Run. 빠진 파일은 테스트(`test/setup-sql.test.ts`)가 잡음
3. 🤖 `npm run doctor [-- https://주소]`: Node·패키지·.env 값 유무·Supabase 표/함수/RLS·카페24 조회·배포 화면·도우미 스크립트·관리자 보호를 한 번에 점검(비밀값 출력 안 함). 운영 기준 모두 통과
4. 🤖 `npm run cafe24:snippets -- https://주소`: 메인 버튼 블록의 링크를 새 주소로 바꾸고 붙이는 곳 안내를 `cafe24/out/`(git 제외)에 만듦
5. 🤖 `docs/CLONE.md`(수 분 복제 순서), 저장소 `CLAUDE.md`(작업 규칙), `.claude/launch.json`(미리보기 서버)
6. 🤖 리허설: GitHub에서 빈 폴더로 clone → `npm ci`(45초) → `.env.example` 복사 → 테스트 98개 통과(합계 50초) → 키 없이 `npm run build` 성공 → 고객 화면·결과·포장·도우미 스크립트·미리보기 그림 200. 키 없는 local 모드에서 카페24 값을 실패로 보던 점검을 '선택'으로 고침

### 단계 22. 편의 기능 CR·CD (2026-10-22)
1. 🤖 결과 화면: 조건 칩으로 바로 바꾸기, 이 상품 빼고 다시(`?exclude=`), 세 상품 비교표, 장례 차분 모드, 배송비·예상 결제 금액, 찜. 첫 화면: 지난 조건 이어 하기, 전체 예산 ÷ 수량, 수량 +10/+50/+100
2. 🤖 포장 편집기: 포장된 모습·실제 크기 보기, 글자 잘림 경고·긴 이름 자동 맞춤·가운데 자석, 행사와 어긋난 말 알림, 자동 보관(사진은 IndexedDB), 내 디자인 다시 꾸미기, PC 저장 시 휴대폰 QR

### 단계 23. 주문 후·관리자 운영 기능 CO·AM·AP (2026-10-22)
1. 👤 **운영 DB에 `supabase/migrations/20261025000000_operations.sql` 실행** (2026-10-22 실행 완료) (상태 바뀐 시각, 같은 디자인 다시 주문 함수, 지표 변경 이력 표, 고객 조회에 진행 상황·취소 포함). 코드는 이 SQL 전에 배포돼도 접수 목록이 열리게 해 두었지만, 새 기능은 SQL 뒤에 동작
2. 🤖 고객: 내 디자인에 진행 단계(접수→주문 확인→인쇄 완료), 같은 디자인으로 다시 주문(새 코드, 인쇄 파일은 원본 것), 스티커 그림 받기·공유. 카페24 주문서 띠에 포장·스티커·수량 요약과 주문 수량이 다를 때 알림(`/api/design/코드`)
3. 🤖 관리자 상품 지표: 저장 전 '바꾸면 무엇이 달라지나'(32가지 상황), 추천 진단 표, 고객 카드 미리보기, 변경 이력·되돌리기, 키보드 입력(막대에서 숫자·↑↓, Ctrl+S, Ctrl+Enter), 엑셀(CSV) 일괄 수정 `/admin/bulk`, 점수 기준 예시(가중치 설정), 카페24 가져오기 요약, 자주 1위였던 상품 품절 경고
4. 🤖 관리자 주문·인쇄: 맨 위 '오늘 할 일', 여러 건 상태 한꺼번에, 늦어지는 건 빨간 표시(접수 3일·주문 확인 2일), 주문 상세 붙여넣어 주문번호 잇기, 시험 인쇄 1장, 인쇄 PDF 오른쪽 위 QR → `/s/코드` → `/admin/scan`에서 인쇄 완료(되돌리기 가능), 접수 목록 단축키(j·k·x·p·t·s·?)
5. 🤖 검증: 마이그레이션은 PGlite(Postgres 17)에서 권한·트리거·함수 26가지 확인, 인쇄 PDF QR은 판독기로 4가지 판형 확인, 화면 없는 Chrome으로 20개 기능 32가지 시나리오 + 이전 CR·CD 26가지 회귀

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
| `src/packaging/` | 포장 디자인 규칙(인쇄 크기, 디자인 코드, 자리표시자, 입력 검사)·타입 |
| `src/data/packaging-repository.ts` | 포장 자산·디자인 접수·인쇄 파일 저장(로컬/Supabase) |
| `src/app/packaging/` | 고객 포장 꾸미기(편집기 `packaging-editor.tsx`, 캔버스 `sticker-canvas.tsx`, 저장 `actions.ts`, 상품 고르기 `pick/`) |
| `src/app/admin/packaging/` | 관리자 포장 디자인(접수 목록, 자산 관리, 인쇄 파일 내려받기 라우트) |
| `public/packaging/` | 예시 포장 스타일·스티커 이미지 |
| `src/app/` | 고객·관리자·로그인 화면, 서버 액션(`admin/actions.ts`) |
| `src/lib/admin-guard.ts`, `safe-next.ts`, `supabase/` | 관리자 권한, 리다이렉트 검사, Supabase 클라이언트 |
| `src/proxy.ts` | 관리자 경로 세션 갱신 |
| `supabase/` | 마이그레이션(테이블·RLS), seed |
| `scripts/` | 동기화, 리포트, 추천 CLI, seed·setup SQL 생성, DB 내려받기, 설정 점검(`doctor.ts`), 카페24 테스트·설치 주소·붙일 코드, AI 시험 |
| `cafe24/mobile-index.html` | 카페24 모바일 메인 완성본 |
| `test/` | 단위·시나리오 테스트 |

---

## 4. 처음부터 복제하기 (새 PC 또는 새 계정)

**[CLONE.md](CLONE.md)로 옮겼다.** 요약: `git clone` → `npm ci` → `.env.local` → Supabase SQL Editor에 `supabase/setup.sql` 한 번 → 관리자 등록·가입 끄기 → Vercel Import·환경변수 → 카페24 앱 설치·`npm run cafe24:snippets` 붙이기·주문서 항목 → `npm run doctor -- https://주소`.

---

## 5. 심이사 자료 도착 시 플레이북

### 5-1. 심이사 카페24 계정을 받았을 때
0. 포장 디자인 연결: 주문서 추가 항목 "온답 포장 디자인 코드"(텍스트 한 줄·전체 상품·선택) 만들기, 도우미 스크립트 한 줄을 `layout/basic/layout.html`과 `order/orderform.html`(PC·모바일)에 넣기 → **실제 주문 1건 시험**(주문 상세에 코드가 찍히는지, 관리자 접수에서 찾기)
1. **대표 계정 비밀번호 대신 부운영자 계정**을 요청(권한: 상품 조회, 디자인 편집)
2. 쇼핑몰 ID 확인 → **진열 영역 번호 확인**(PC·모바일 메인 `index.html`의 `product_listmain_N`)
3. 앱 설치
   - 우리 앱(제작중)을 심이사 몰에 설치: `CAFE24_MALL_ID`를 바꿔 `scripts/cafe24-install-url.mjs`로 주소 생성 → 심이사가 동의
   - **확인 필요:** 제작중(미심사) 앱을 다른 몰에 설치할 수 있는지. 안 되면 심이사 계정으로 개발자센터 가입 후 같은 설정으로 앱 생성
   - 앱의 App URL·Redirect URI는 Vercel 운영 주소로(`https://ondapmvp.vercel.app`, `…/api/cafe24/callback`)
4. **데이터 분리(중요):** 상품번호는 쇼핑몰마다 겹친다. 테스트몰 상품·지표와 섞이지 않게
   - 권장: **심이사 명의 Supabase 새 프로젝트**로 시작([CLONE.md](CLONE.md) 3장, `setup.sql` 한 번), 또는 기존 `products`·`product_attributes`·`scenario_expectations`·`recommendation_logs` 비우기
5. 환경변수 교체(로컬·Vercel): `CAFE24_MALL_ID`, `CAFE24_CLIENT_ID`, `CAFE24_FRONT_API_KEY`(+ Supabase 값) → 재배포
6. 관리자 → "카페24 상품 다시 가져오기" → 상품마다 **AI 점수 제안 → 검토 → 저장**
7. 심이사 쇼핑몰 PC·모바일 메인에 버튼 넣기(단계 12 주의사항 그대로)
   - 주문서 추가항목 "온답 포장 디자인 코드"도 같이 만든다(단계 15)
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
| 다음 기능 | 포장: 엽서·띠지, AI 이미지 생성(지금은 준비 중 버튼), 카페24 주문 자동 연결(관리자 API), 접수 알림, 서비스 키로 저장 경로 잠그기, 결과보고용 실적 화면 |
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
| `npm run db:setup-sql` | 마이그레이션 + seed → `supabase/setup.sql` (새 프로젝트용 한 파일) |
| `npm run doctor [-- https://주소]` | 설정·DB·카페24·배포 점검 |
| `npm run cafe24:snippets -- https://주소` | 카페24에 붙일 메인 버튼·스크립트 줄을 주소에 맞춰 생성 |
| `npm run ai:suggest -- 23` | AI 점수 제안 터미널 시험 (`ondap_ai` 필요) |
| `node scripts/cafe24-install-url.mjs` | 카페24 앱 설치(동의) 주소 |
| `node scripts/cafe24-product-test.mjs [상품번호]` | 카페24 연결 테스트 |
| `node scripts/seed-attributes.mjs --force` | 지표 가안 초기화(덮어씀 주의) |
