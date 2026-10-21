# 온답 빠른 복제 안내 — 새 PC·새 계정에서 같은 서비스 만들기

이 문서 순서대로 하면 **코드 → DB → 배포 → 카페24 연결**까지 같은 서비스가 하나 더 생긴다. 계정이 준비돼 있으면 사람 손이 가는 시간은 15분 안팎이다.
왜 이렇게 만들었는지, 시행착오 전체는 [RUNBOOK.md](RUNBOOK.md)에 있다.

> **비밀값은 저장소·문서·채팅에 넣지 않는다.** 키는 `.env.local`(git 제외)과 Vercel 환경변수(Sensitive)에만 둔다. 관리자 이메일 같은 계정 정보도 저장소에 적지 않는다.

| 단계 | 누가 | 걸리는 시간 | 끝났는지 확인 |
| --- | --- | --- | --- |
| 1. 코드 받기·로컬 실행 | 개발자 | 2분 | `npm test` 통과, 127.0.0.1:3000 열림 |
| 2. `.env.local` 채우기 | 개발자 | 2분 | `npm run doctor` 의 .env 항목 |
| 3. Supabase 새 프로젝트 | 개발자 | 3분 | `npm run doctor` 의 Supabase 항목 |
| 4. Vercel 배포 | 개발자 | 3분 | `npm run doctor -- https://주소` |
| 5. 카페24 연결 | 쇼핑몰 운영자 권한 | 5분 | 상품 상세의 꾸미기 버튼, 주문서 코드 자동 입력 |

---

## 0. 준비물

- **Node 24** (TypeScript 파일을 그대로 실행한다. 22 이하에서는 스크립트·테스트가 안 돈다), git
- 계정: GitHub, Vercel, Supabase, 카페24(쇼핑몰 운영자 + 개발자센터), 선택으로 Google AI Studio(Gemini 키)
- 저장소: https://github.com/xshoner/ondapmvp (`main`에 푸시하면 Vercel이 자동 배포)

## 1. 코드 받기·로컬 실행 (키 없이도 된다)

```bash
git clone https://github.com/xshoner/ondapmvp.git
cd ondapmvp
npm ci
cp .env.example .env.local
npm test
npm run dev
```

- 브라우저는 **http://127.0.0.1:3000** (localhost로 열면 HMR이 끊기고 서버 액션 버튼이 멈춘다)
- `.env.example` 기본값은 `ONDAP_DATA_SOURCE=local`: 저장소의 `data/*.json`(테스트몰 상품 40개·지표·설정)로 추천·포장 꾸미기·관리자(로그인 없음)가 바로 돈다. 로컬 모드의 디자인 접수는 `data/designs.json`·`data/design-files/`에 쌓인다(git 제외). 로컬 모드 관리자는 개발 서버(`npm run dev`)에서만 열린다(운영 빌드에서는 404)

## 2. `.env.local` 채우기

| 이름 | 어디서 얻나 | 비밀 | 비고 |
| --- | --- | --- | --- |
| `ONDAP_DATA_SOURCE` | — | | `supabase` (3장 끝나면) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 〃 Publishable key | | 공개용, RLS가 막는다 |
| `CAFE24_MALL_ID` | 쇼핑몰 주소 `{ID}.cafe24.com` | | |
| `CAFE24_CLIENT_ID` | 카페24 개발자센터 → 앱 → 기본 정보 | | |
| `CAFE24_FRONT_API_KEY` | 〃 Front API Key | **비밀** | 없으면 호출 한도 5 |
| `CAFE24_REDIRECT_URI` | 개발자센터에 적은 값과 **글자 하나까지 같게** | | 앱 설치 주소 만들 때만 |
| `ondap_ai` | Google AI Studio API 키 | **비밀** | 선택: 관리자 AI 점수 제안 |
| `ONDAP_AI_MODEL`, `ONDAP_AI_FALLBACK_MODEL` | — | | 비우면 `gemini-3.6-flash` → `gemini-flash-latest` |

```bash
npm run doctor
```

`✗` 줄 아래 `→` 안내대로 고치면 된다. 값은 출력하지 않는다(있음/없음만).

## 3. Supabase 새 프로젝트 (SQL 한 번)

1. Supabase에서 새 프로젝트를 만든다. 리전은 Seoul(ap-northeast-2)
2. **SQL Editor**에 `supabase/setup.sql` 전체를 붙여넣고 **Run**
   - 들어 있는 것: 테이블·RLS·관리자 판별 함수, 포장 디자인 표·저장소 버킷(`packaging-assets` 공개, `design-files` 비공개)·보강 제약, 디자인 코드 조회·이용 실적 함수, 초기 데이터(상품 40·지표 40·엔진 설정·포장 예시)
   - **빈 프로젝트에서 한 번만.** 다시 실행하면 "already exists" 오류가 난다
3. **Authentication → Users → Add user** (Auto Confirm User 체크)로 관리자 계정을 만들고, SQL Editor에서 이메일만 바꿔 실행:
   ```sql
   insert into public.admins (user_id) select id from auth.users where lower(email) = lower('관리자 이메일') returning user_id;
   ```
   (`returning`을 붙여야 행이 보인다. 안 붙이면 성공해도 "No rows returned")
4. **Authentication → Sign In / Providers → Allow new users to sign up 끄기** (관리자만 로그인)
5. `.env.local`에 Supabase 두 값과 `ONDAP_DATA_SOURCE=supabase` → `npm run doctor` → 개발 서버 재시작 → `/login`으로 관리자 로그인

**다른 쇼핑몰로 시작한다면** (상품번호가 몰마다 겹치므로 테스트몰 상품을 지운다) setup.sql 다음에:

```sql
truncate public.products, public.product_attributes, public.scenario_expectations, public.recommendation_logs;
```

그 뒤 5장에서 카페24를 연결하고 관리자 → **카페24 상품 다시 가져오기** → **AI 일괄 제안**으로 지표 가안을 채운다.

> 이 DB 구조를 바꿀 때: `supabase/migrations/`에 새 파일을 추가 → 운영 DB SQL Editor에서 그 파일만 실행 → `npm run db:setup-sql`로 setup.sql 갱신(빠뜨리면 `npm test`가 잡는다).
> 운영 DB의 상품 지표를 새 복제본 초기값으로 옮기려면 `npm run db:pull` → `npm run db:seed-sql` → `npm run db:setup-sql`.

## 4. Vercel 배포

1. Vercel → **Add New → Project → GitHub 저장소 Import** (Framework는 Next.js 자동 인식, 서울 리전 icn1은 `vercel.json`, Node 24는 `package.json`이 정한다)
2. **Environment Variables**에 2장 값을 넣는다. `CAFE24_FRONT_API_KEY`, `ondap_ai`는 **Sensitive**로. `CAFE24_REDIRECT_URI`는 필요 없다
3. Deploy → 끝나면 Settings → Domains의 **운영 주소**(예: `ondapmvp.vercel.app`)를 확인
4. 점검:
   ```bash
   npm run doctor -- https://운영주소
   ```

- 환경변수는 **추가한 뒤의 배포부터** 반영된다 → 바꾸면 Redeploy
- `*-팀이름.vercel.app` 같은 배포별 주소는 Vercel 로그인 보호가 걸려 손님이 못 연다. 바깥에 알리는 주소는 운영 주소 하나
- 공유 미리보기 그림·링크의 기준 주소는 Vercel이 주는 운영 주소를 자동으로 쓴다. 자체 도메인을 붙이면 `NEXT_PUBLIC_SITE_URL=https://도메인`을 추가

## 5. 카페24 연결

### 5-1. 앱 (상품 읽기)
1. 카페24 **개발자센터 → 앱 만들기**: 유형 Web
   - App URL: `https://운영주소`, Redirect URI: `https://운영주소/api/cafe24/callback` (https 도메인만 된다. localhost·IP 불가)
   - 권한: 상품(Product) **읽기만**, Front API 사용. 심사요청은 누르지 않는다
2. `.env.local`에 `CAFE24_MALL_ID`, `CAFE24_CLIENT_ID`, `CAFE24_FRONT_API_KEY`, `CAFE24_REDIRECT_URI`
3. 앱 설치(운영자 동의): `node scripts/cafe24-install-url.mjs`가 찍은 주소를 **쇼핑몰 운영자로 로그인된 브라우저**에서 열고 동의 → 하얀 빈 화면 + 주소창에 `code=`가 붙으면 성공(빈 화면이 정상)
4. `npm run doctor` 의 카페24 항목 → 관리자 → **카페24 상품 다시 가져오기**

### 5-2. 쇼핑몰에 붙이기
```bash
npm run cafe24:snippets -- https://운영주소
```
`cafe24/out/`에 주소가 맞춰진 메인 버튼 블록과 붙이는 곳 안내가 생긴다. 요약:

| 무엇을 | 어디에 (PC 스킨·모바일 스킨 각각) |
| --- | --- |
| 메인 버튼 `cafe24/out/ondap-cta.html` 통째로 | 메인 `index.html`의 메인 배너 바로 아래 |
| `<script src="https://운영주소/cafe24/ondap-helper.js" defer></script>` | `layout/basic/layout.html`의 `</body>` 바로 위 |
| 같은 한 줄 | `order/orderform.html` 맨 아래 (주문서는 다른 레이아웃이라 따로) |
| 주문서 추가 항목 **"온답 포장 디자인 코드"** (텍스트 한 줄·전체 상품·선택) | 쇼핑몰 설정 → 주문 설정 → 주문서 추가 항목 관리 |

- 대표 디자인에 저장하면 **즉시 실서비스 반영**. 편집 화면 히스토리로 되돌릴 수 있다
- 반영이 안 보이면 Ctrl+F5, 그래도 안 되면 관리자 상단 **사이트캐시 삭제**
- 모바일은 별도 쇼핑몰(`/m/`)이다. 모바일 메인 진열 영역 번호가 PC와 다를 수 있다(테스트몰은 PC 5·9번을 모바일에도 맞춤, `cafe24/mobile-index.html` 참고)
- 운영자로 로그인한 브라우저는 관리자 바 때문에 '바로 구매'가 막힐 수 있다 → 관리자 바 사용안함, 또는 다른 브라우저로 시험

### 5-3. 마지막 확인 (실제 주문 1건)
상품 상세 → **포장·스티커 꾸미기** → 저장해 디자인 코드 받기 → **이 상품 주문하러 가기** → 수량이 맞춰졌는지 → 주문서의 "온답 포장 디자인 코드" 칸이 자동으로 채워졌는지 → 주문 후 카페24 주문 상세에 코드가 있는지 → 온답 관리자 → 포장 디자인 → 접수에서 코드 검색 → 인쇄 PDF(A4/A3) 받기.
시험 주문은 카페24 관리자에서 취소한다(비회원 주문은 주문조회 비밀번호를 손님이 직접 정한다).

---

## 6. 다 됐는지 한 장으로

- [ ] `npm test` 통과, `npm run doctor -- https://운영주소` 모두 통과
- [ ] 고객: 행사 고르기 → 추천 3개 → 격식지수 도장 → 상품 보기·포장 꾸미기·공유
- [ ] 고객: `/packaging/pick` 상품 골라 꾸미기 → 코드 → `/packaging/mine`에 남음
- [ ] 관리자: `/login` → 상품 지표·가중치·알고리즘 검증·포장 디자인·실적 화면 열림
- [ ] 카페24: PC·모바일 메인 버튼, 상품 상세 꾸미기 버튼, 주문서 코드 자동 입력
- [ ] Supabase 가입 허용 꺼짐, Vercel Sensitive 변수 2개

---

## 7. 이틀 동안 만든 것 (2026-10-20 ~ 21) 한눈에

| 순서 | 만든 것 | 핵심 결정·함정 |
| --- | --- | --- |
| 1 | 격식지수 엔진 v0.1 (지표 6개 × 행사 8 × 관계 4, 보너스, 다양성, 예산 1.3배 확대) | 특허 산식이 오면 `data/config/engine.json`과 `src/engine/formality.ts`만 바꾸면 된다 |
| 2 | 카페24 Front API 상품 가져오기 | **앱 설치(운영자 동의)가 필수**, 미설치면 403 Uninstalled app |
| 3 | 고객 화면·관리자(지표·가중치·32 시나리오 검증) | Next 16: `middleware` 대신 `src/proxy.ts`, 로그인 확인은 `getClaims()` |
| 4 | Supabase 전환 (RLS, 관리자 표) | jsonb는 키 순서를 섞는다 → 화면 순서는 `eventIds()`·`relationIds()`로 고정. 한 번에 1000행까지 → `range()`로 나눠 읽기 |
| 5 | Vercel 배포 (icn1) | 환경변수 추가 후 재배포, 배포별 주소는 로그인 보호 |
| 6 | AI 점수 제안·일괄 제안 (Gemini) | 기본 모델이 자주 503 → 재시도 + 대체 모델 + 호출당 40초 제한. AI는 제안만, 저장은 사람 |
| 7 | 포장 디자인: 스타일 선택 + 무료 스티커 편집기(Konva) → 디자인 코드 `OD-XXXX-XXXX` | 인쇄 300dpi + 도련 2mm (4cm→520px, 6cm→756px). 저장은 파일 먼저, 행 나중 |
| 8 | 인쇄 PDF A4/A3 묶음 판짜기 (pdf-lib), ZIP 묶어 받기 | PDF 글꼴은 영문만(WinAnsi) → 머리글은 ASCII. 장수 상한 200 |
| 9 | 카페24 주문 연결 도우미 (`public/cafe24/ondap-helper.js`) | 스킨이 수량을 1로 되돌림 → 4초간 다시 맞춤. 주문서는 레이아웃이 달라 스크립트를 따로 넣어야 함. 모바일은 `/m/`로 넘어가며 주소 뒤 값을 버림 → 처음부터 `/m/` 주소로 보냄 |
| 10 | 추천 없이 '포장만 꾸미기' 입구, 상품 상세 꾸미기 버튼, 행사 칩 | |
| 11 | 디자인 전면 개편 (함렛(Hahmlet) 명조 + Noto Sans KR, 소나무색·놋쇠색, 인주색은 격식지수 도장에만) | 가변 글꼴로 CSS 477KB → 160KB |
| 12 | 편의 기능: 결과 공유, 내 디자인, 되돌리기, 접수 필터·CSV, 실적 대시보드 | |
| 13 | 신뢰감 마감: 공유 미리보기 그림, 격식지수 소개, 기다림·404 화면, 이번 달 이용 실적, 아이콘 | 미리보기 그림 엔진은 woff2를 못 읽고 단어 단위 줄바꿈을 못 한다 → woff 받기, 줄 직접 나누기 |
| 14 | 복제 도구: `supabase/setup.sql`, `npm run doctor`, `npm run cafe24:snippets` | 이 문서 |

자세한 단계별 기록(누가·무엇을·주의사항)은 [RUNBOOK.md 2장](RUNBOOK.md#2-오늘-진행한-순서-누가--무엇을--주의사항), 심이사 자료가 오면 할 일은 [RUNBOOK.md 5장](RUNBOOK.md#5-심이사-자료-도착-시-플레이북).

## 8. 새 환경에서 개발을 이어 갈 때

- 저장소 루트의 `CLAUDE.md`가 작업 규칙(한국어, 127.0.0.1, 비밀값, 테스트·배포 순서)을 담고 있다. Claude Code로 열면 자동으로 읽는다
- `.claude/launch.json`의 `ondap-dev`로 미리보기 서버를 띄운다
- 자주 쓰는 명령은 [RUNBOOK.md 7장](RUNBOOK.md#7-명령어-모음)
