# 온답 추천 엔진 MVP

행사 정보(행사 유형·관계·예산)를 넣으면 격식지수로 답례품 3개를 추천하는 엔진입니다. 상품은 카페24 쇼핑몰에서 가져옵니다.

## 화면 (`npm run dev` → http://localhost:3000)

| 주소 | 화면 |
| --- | --- |
| `/` | 고객: 행사·관계·예산·수량 입력 |
| `/result` | 고객: 추천 3개, 격식지수, ONDAP'S PICK, 점수 내역 |
| `/admin` | 관리자: 상품별 지표 입력, 카페24 상품 다시 가져오기 |
| `/admin/weights` | 관리자: 행사·관계별 가중치, 보너스 편집 + 실시간 미리보기 |
| `/admin/verify` | 관리자: 32개 시나리오 결과, 전체 순위, 기대 정답 지정 |

관리자는 로컬 전용(로그인 없음)이며 저장하면 `data/`의 JSON이 바뀝니다.

## 명령어

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 화면 개발 서버 |
| `npm run sync` | 카페24 상품을 `data/cafe24-products.json`으로 가져오기 |
| `npm run recommend -- 장례 상급자/어르신 50000` | 추천 1건과 점수 내역 보기 |
| `npm run report -- 60000` | 32개 시나리오(행사 8 × 관계 4) 결과표 → `reports/scenario-report.md` |
| `npm test` | 엔진 단위 테스트 + 시나리오 불변 조건 검사 |
| `npm run typecheck` | 타입 검사 |

Node 24 이상이 필요합니다(TypeScript를 그대로 실행).

## 데이터

| 파일 | 내용 | 원본 |
| --- | --- | --- |
| `data/cafe24-products.json` | 상품명, 가격, 진열·판매 상태, 이미지 | 카페24 (`npm run sync`) |
| `data/product-attributes.json` | 상품별 지표 점수, 적합 행사·관계, 제외 행사 | 온답 관리자 (현재는 개발 측 가안, `reviewed: false`) |
| `data/config/engine.json` | 지표 정의, 행사·관계별 가중치, 격식 목표, 보너스 | 온답 (특허 자료가 오면 교체) |

## 점수 계산 (온답 격식지수 가안 v0.1, 개발 측 자체 모델)

지표 6개: 희소성, 장인·전통성, 지역 가치, 신뢰·안전, 실용성, 격식 적합도. 앞의 4개는 심이사 관리자 시안, 신뢰·안전(위생)과 실용성은 회의 내용에서 가져왔다.

1. 거르기: 미진열·품절, 지표 미입력, 해당 행사 제외 상품, 예산 초과
2. 지표 점수: 행사 가중치 × 관계 보정. 격식 적합도는 상황별 목표 수준에 가까울수록 높음
3. 보너스: 행사 적합 +6, 행사 미지정 −12, 관계 적합 +4, 선물의 의미 일치 +6, 소멸위기지역 상품 +3 → 격식지수(0~100)
4. 순위대로 3개를 고르되 카테고리가 겹치지 않게. 부족하면 예산을 1.3배까지 넓힘
5. 격식 단계(격을 갖춘 선택 / 실속 있는 정성 / 가벼운 안부의 예의)와 추천 문구를 점수 내역으로 만든다

상품별 초기값은 `node scripts/seed-attributes.mjs --force`로 다시 만들 수 있다(관리자 화면 수정분을 덮어씀).

계산식은 `src/engine/formality.ts`, 선택 규칙은 `src/engine/recommend.ts`에 있습니다.

## 카페24 연결

`.env.local`에 쇼핑몰 ID, Client ID, Front API Key를 넣습니다. 앱이 쇼핑몰에 설치(운영자 동의)돼 있어야 하며, 설치 주소는 `node scripts/cafe24-install-url.mjs`로 만듭니다.

## Supabase 전환 (4단계)

데이터 저장소는 `.env.local`의 `ONDAP_DATA_SOURCE`로 고른다. `local`이면 `data/` JSON, `supabase`이면 Supabase DB.

1. Supabase 대시보드 → SQL Editor에서 `supabase/migrations/20261020000000_init.sql` 실행 (테이블·RLS)
2. 같은 곳에서 `supabase/seed.sql` 실행 (현재 로컬 데이터 40개 상품·지표·설정). 다시 만들려면 `npm run db:seed-sql`
3. Authentication → Users → Add user로 관리자 계정 생성 후, SQL Editor에서
   `insert into public.admins (user_id) select id from auth.users where email = '관리자 이메일';`
4. Authentication → Sign In / Providers에서 새 가입 허용(Allow new users to sign up)을 끈다 (관리자만 로그인)
5. `.env.local`의 `ONDAP_DATA_SOURCE=supabase`로 바꾸고 개발 서버 재시작 → `/login`

| 표 | 누가 읽나 | 누가 쓰나 |
| --- | --- | --- |
| products, product_attributes, engine_config | 누구나 | 관리자 |
| scenario_expectations | 관리자 | 관리자 |
| recommendation_logs | 관리자 | 누구나(추천할 때 자동 기록) |
| admins | 본인 행만 | SQL Editor에서만 |

`npm run db:pull`은 DB 내용을 `data/`로 내려받아 CLI(`report`, `recommend`)와 테스트에 쓴다.

## 배포 (5단계)

- 운영 주소: https://ondapmvp-iota.vercel.app (Vercel 프로젝트 `ondapmvp`, 서울 리전 icn1)
- `main` 브랜치에 푸시하면 자동 배포된다.
- `*-xshoner-3375s-projects.vercel.app` 주소는 Vercel 로그인 보호가 걸려 있어 일반 방문자는 열 수 없다. 외부에 공유할 때는 운영 주소를 쓴다.
- Vercel 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ONDAP_DATA_SOURCE=supabase`, `CAFE24_MALL_ID`, `CAFE24_CLIENT_ID`, (선택) `CAFE24_FRONT_API_KEY`를 Sensitive로 등록
- 현재 Vercel Hobby 플랜이라 비상업 시연용이다. 실제 운영은 Pro 플랜이나 고객 명의 계정으로 옮긴다.
