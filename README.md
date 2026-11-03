# 온답 추천 엔진 MVP

> **작업 시작 전 필독:** [인계 기록 START-HERE.md](START-HERE.md) — 운영 배포(https://ondapmvp.vercel.app , commit `5a24fa7`) 완료 및 결재 활성화(`ENABLE_APPROVAL_DOCS=true`). 현재 통합·검증 브랜치: `codex/core-ui-validation`.

행사 정보(행사 유형·관계·예산)를 넣으면 격식지수로 답례품 3개를 추천하는 엔진입니다. 상품은 카페24 쇼핑몰에서 가져옵니다.

> 새 환경에 같은 서비스를 복제: **[docs/CLONE.md](docs/CLONE.md)** (코드 → DB `supabase/setup.sql` 한 번 → Vercel → 카페24, `npm run doctor`로 점검)
> 구축 기록, 심이사 자료 도착 시 할 일: **[docs/RUNBOOK.md](docs/RUNBOOK.md)** · 작업 규칙: [CLAUDE.md](CLAUDE.md)

## 화면 (`npm run dev` → http://127.0.0.1:3000, localhost가 아닌 127.0.0.1로 접속)

| 주소 | 화면 |
| --- | --- |
| `/` | 고객: 행사·관계·예산·수량 입력 |
| `/result` | 고객: 추천 3개, 격식지수, ONDAP'S PICK, 점수 내역 |
| `/packaging` | 고객: 포장 스타일 고르기 + 무료 스티커 꾸미기 → 디자인 코드 (카페24 주문서에 적음) |
| `/packaging/pick` | 고객: 추천 없이 상품을 직접 골라 포장만 꾸미기 |
| `/packaging/mine` | 고객: 이 기기에서 만든 디자인 코드 다시 보기 |
| `/formality` | 고객: 격식지수 소개 (관리자 설정을 그대로 읽음) |
| `/login` | 관리자 로그인 (Supabase 모드) |
| `/admin` | 관리자: 상품별 지표 입력, 카페24 상품 다시 가져오기 |
| `/admin/weights` | 관리자: 행사·관계별 가중치, 보너스 편집 + 실시간 미리보기 |
| `/admin/verify` | 관리자: 32개 시나리오 결과, 전체 순위, 기대 정답 지정 |
| `/admin/ai-batch` | 관리자: AI 지표 일괄 제안 → 비교 후 저장 |
| `/admin/packaging` | 관리자: 디자인 접수(필터·CSV·인쇄 PDF A4/A3·ZIP·주문번호), 포장 스타일, 추천 이미지·문구 |
| `/admin/stats` | 관리자: 실적(추천 수·행사별·많이 추천된 상품·디자인 접수) |

`ONDAP_DATA_SOURCE=local`이면 관리자는 개발 서버에서 로그인 없이 열리고 저장하면 `data/`의 JSON이 바뀝니다. `supabase`면 `/login`으로 로그인한 관리자만 열립니다.

## 명령어

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 화면 개발 서버 |
| `npm run sync` | 카페24 상품을 `data/cafe24-products.json`으로 가져오기 |
| `npm run recommend -- 장례 상급자/어르신 50000` | 추천 1건과 점수 내역 보기 |
| `npm run report -- 60000` | 32개 시나리오(행사 8 × 관계 4) 결과표 → `reports/scenario-report.md` |
| `npm test` | 엔진 단위/통합 테스트 + 시나리오 불변 조건 검사 (276개 전체 통과) |
| `npm run typecheck` | TypeScript 타입 검사 (`tsc --noEmit`) |
| `node node_modules/next/dist/bin/next build --webpack` | 프로덕션 Next.js Webpack 빌드 검증 |
| `npm run doctor [-- https://주소]` | 설정·DB·카페24·배포 점검 |
| `npm run db:setup-sql` | 마이그레이션 + seed → `supabase/setup.sql` |
| `npm run cafe24:snippets -- https://주소` | 카페24에 붙일 코드 생성 |

Node 24 이상이 필요합니다(TypeScript를 그대로 실행).

## 데이터

| 파일 | 내용 | 원본 |
| --- | --- | --- |
| `data/cafe24-products.json` | 상품명, 가격, 진열·판매 상태, 이미지 | 카페24 (`npm run sync`) |
| `data/product-attributes.json` | 상품별 지표 점수, 적합 행사·관계, 제외 행사 | 온답 관리자 (현재는 개발 측 가안, `reviewed: false`) |
| `data/config/engine.json` | 지표 정의, 행사·관계별 가중치, 격식 목표, 보너스 | 온답 (특허 자료가 오면 교체) |

## 점수 계산 (추천 엔진 평가 모델)

고객이 입력한 행사·관계·예산·수량 조건을 바탕으로 `evaluateRecommendation`(`src/recommendation/evaluate.ts`)을 통해 적합 상품을 평가하고 종합점수 순위로 추천 3개를 선정합니다.

1. **사전 필터링 (거르기)**: 미진열·품절 상품, 필수 지표 미입력 상품, 해당 행사 제외 상품, 1인당 예산 초과 상품 제외
2. **행사 적합도 점수 ($E$, Event Fit Score, 0~100점)**: 행사 가중치와 관계 적합도, 상품 지표 가중합 및 선물의 의미 보너스 반영
3. **가격 대비 가치 점수 ($V$, Price Value Score, 0~100점)**: 1인당 예산 대비 상품 단가의 적정성 및 가격 만족도 평가
4. **종합 추천 점수 ($S$, Recommendation Score, 0~100점)**:
   - 예산 설정 시: $S = \frac{E \times w_E + V \times w_V}{w_E + w_V}$ (기본 가중치 비율 70:30)
   - 예산 미설정 시: $S = E$
5. **추천 1~3위 선정 (종합점수 순위)**:
   - 정렬 순서: 종합점수($S$) 내림차순 → 행사적합도($E$) 내림차순 → 단가 오름차순 → 상품번호 오름차순
   - 종합점수 1위가 **ONDAP'S PICK**으로 선정되며, 2위와 3위가 순차적으로 추천 후보로 제공됩니다.
   - (참고: 과거 v0.1 가안의 카테고리 강제 분산이나 예산 1.3배 자동 완화 규칙은 폐기되었습니다.)
   - 상세 산식 및 계산 규칙은 [docs/추천-산식-정리.md](docs/추천-산식-정리.md)를 참조합니다.

## 카페24 연결

`.env.local`에 쇼핑몰 ID, Client ID, Front API Key를 넣습니다. 앱이 쇼핑몰에 설치(운영자 동의)돼 있어야 하며, 설치 주소는 `node scripts/cafe24-install-url.mjs`로 만듭니다.

## Supabase 전환 (4단계)

데이터 저장소는 `.env.local`의 `ONDAP_DATA_SOURCE`로 고른다. `local`이면 `data/` JSON, `supabase`이면 Supabase DB.

1. 새 프로젝트: Supabase 대시보드 → SQL Editor에서 `supabase/setup.sql` 한 번 실행 (마이그레이션 전부 + 초기 데이터 40개 상품·지표·설정·포장 예시)
   - 이미 운영 중인 DB에는 `supabase/migrations/`의 새 파일만 실행한다
2. 초기 데이터를 다시 만들려면 `npm run db:seed-sql` → `npm run db:setup-sql`
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

- 운영 주소: https://ondapmvp.vercel.app (main 브랜치 커밋 `5a24fa7` 배포 완료, 서울 리전 icn1)
- 결재 문서 활성화: `ENABLE_APPROVAL_DOCS=true`로 운영 활성화 완료
- `main` 브랜치에 푸시하면 자동 배포된다.
- `*-xshoner-3375s-projects.vercel.app` 주소는 Vercel 로그인 보호가 걸려 있어 일반 방문자는 열 수 없다. 외부에 공유할 때는 운영 주소를 쓴다.
- Vercel 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ONDAP_DATA_SOURCE=supabase`, `ENABLE_APPROVAL_DOCS=true`, `CAFE24_MALL_ID`, `CAFE24_CLIENT_ID`, (선택) `CAFE24_FRONT_API_KEY`를 Sensitive로 등록
- 실환경 미확인 상태: 실제 물리 모바일 단말기 렌더링, 한컴오피스 데스크톱 실프로그램 레이아웃, 운영 관리자 AI 실환경 API 호출 검증은 미실시 상태임 (상세 내용은 [START-HERE.md](START-HERE.md) 참조)
- 현재 Vercel Hobby 플랜이라 비상업 시연용이다. 실제 운영은 Pro 플랜이나 고객 명의 계정으로 옮긴다.
