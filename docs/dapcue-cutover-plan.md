# 답례큐(`dapcue.cafe24.com`) 운영 전환 · DB 초기화 · 백업/복구 절차서

> **상태:** 준비 완료(실제 운영 미적용). 사용자의 명시적 이관 실행 요청 전에는 운영 DB 삭제, 스키마 적용, Vercel 변수 변경/배포, OAuth 연결, 카페24 스킨 반영을 실행하지 않습니다.
> **기준 저장소:** `xshoner/ondapmvp` (`codex/dapcue-mall-switch`, 기반 `main` SHA `23ec65794ff87ddbd77e1618f152ed754fc9340f`)
> **대상:** Customer App `https://dapcue.vercel.app` · Vercel `dapcue` · Supabase `ornwnlmprkxqwsheuzdb` · New Mall `https://dapcue.cafe24.com`

---

## 1. 운영 전환 전 실 DB/서비스 현황 (`2026-11-11 KST` 읽기 점검 결과)

- **Supabase `ornwnlmprkxqwsheuzdb` (ap-northeast-2, Postgres 17.11):**
  - **폐기 대상(옛 `axopenlab` 데이터):** `products` 29건(`11~53`), `product_evidence` 15건(`reviewed=true` 15건), `product_attributes` 42건, `product_attributes_history` 3건, `designs` 53건(`printed` 32, `pending` 12, `order_confirmed` 5, `canceled` 3, `received` 1), `approval_drafts` 21건, `recommendation_logs` 129건, `cafe24_tokens` 1건(`mall_id='axopenlab'`, 액세스 토큰 만료), `operation_events` 124건.
  - **Storage 버킷:** `approval-assets` 54개, `design-files` 51개, `packaging-assets` 1개(**공용 자산 — 보존 필수**).
  - **보존 대상(공용 자산 및 계정):** `admins` 1건, `engine_config` 1건, `packaging_styles` 4건, `design_images` 8건, `design_texts` 17건, `formality_policies` 0건, Storage `packaging-assets`.
  - **미적용 스키마:** `cafe24_payment_events` 테이블에 `event_revision` 컬럼이 없으며 `cancel_paid_designs` 함수가 아직 적용되지 않음 (`supabase/migrations/20261111000000_payment_retry.sql` 미적용 상태).
- **현재 `https://dapcue.vercel.app` 라이브 응답:**
  - `/packaging/pick` HTML의 `og:image`가 아직 `https://ondapmvp.vercel.app/opengraph-image...`로 출력됨 (`NEXT_PUBLIC_SITE_URL` 점검 필요), 상품 목록/이미지는 `axopenlab` 데이터를 반환함.
  - `/api/packaging/option-price?product=11`은 옛 상품 11(+200원 `포장 디자인 서비스`/`포장신청`)을 반환함(새 몰 `dapcue` 상품 11 쿠키는 `답례포장 서비스` / `신청 (+100원)`).
  - `/api/cron/daily`는 `404 Not Found` (아직 배포 전).

---

## 2. 단기 제한 백업 절차 (삭제/마이그레이션 직전 실행)

Supabase 무료/기본 대시보드 자동 백업에 의존하지 않으므로, 전환 실행 직전 **저장소 바깥의 접근 제한 로컬 폴더**에 단기 백업(14~30일 보관 후 파기)을 생성·검증합니다. (비밀값·JWT·원문 개인정보는 문서/커밋/로그에 남기지 않음)

1. **운영 DB·스토리지 스냅샷 백업 및 검증:**
   - `npm run ops:backup -- <안전한_저장소_외부_경로>`
     - `export_application_snapshot` 14개 테이블(`products`, `product_attributes`, `product_evidence`, `formality_policies`, `engine_config`, `scenario_expectations`, `packaging_styles`, `design_images`, `design_texts`, `designs`, `recommendation_logs`, `recommendation_feedback`, `product_attributes_history`, `approval_drafts`)
     - Storage 3개 버킷(`design-files`, `packaging-assets`, `approval-assets`) 다운로드
   - `npm run ops:verify-backup` 으로 `restoreSql` 복구 무결성 검증
2. **`export_application_snapshot` 미포함 항목 별도 확인/메타 기록:**
   - `public.admins` (`user_id`), `auth.users` 관리자 이메일 확인
   - `public.cafe24_payment_events`, `public.operation_events` (필요 시 읽기 전용 JSON 내보내기)
   - `public.cafe24_tokens`는 백업 본문에 토큰 원문을 평문 저장하지 않고 연결 상태만 기록(`axopenlab` 토큰은 새 몰 전환 시 폐기)

---

## 3. 쓰기 차단 · DB 정리 · 마이그레이션 적용 순서

> **충돌 및 트리거 주의:**
> - 옛 몰 웹훅(`axopenlab`)이나 브라우저 트래픽이 정리 중에 옛 데이터를 다시 쓰지 않도록 먼저 차단한 뒤 삭제합니다.
> - `product_attributes` 테이블의 `product_attributes_audit` 삭제 트리거가 `product_attributes_history`에 `op='delete'` 이력을 남기므로, 반드시 **`product_attributes`를 먼저 지운 뒤 `product_attributes_history`를 삭제**합니다.
> - `designs.source_code`는 자기참조 FK(`ON DELETE SET NULL`)가 있으므로 전체 `designs` 일괄 삭제 또는 `source_code` 정리 순서를 지킵니다.

1. **사전 쓰기 차단:**
   - 카페24 개발자센터(또는 앱 설정)에서 옛 몰 `axopenlab` 웹훅 비활성화 / 이전 배포 cron 호출 중지 확인.
2. **스토리지 옛 객체 정리 (공용 `packaging-assets` 보존):**
   - `design-files` 버킷 객체 51건 및 `approval-assets` 버킷 객체 54건 삭제 (`packaging-assets` 1건은 **절대 삭제하지 않음**).
3. **DB 트랜잭션 정리 (단일 SQL 트랜잭션):**
   ```sql
   begin;
   delete from public.cafe24_payment_events;
   delete from public.cafe24_tokens;
   delete from public.approval_drafts;
   delete from public.designs;
   delete from public.recommendation_logs;
   delete from public.recommendation_feedback;
   delete from public.scenario_expectations;
   delete from public.product_evidence;
   delete from public.product_attributes;
   delete from public.product_attributes_history;
   delete from public.products;
   delete from public.operation_events;
   commit;
   ```
4. **공용 자산 보존 확인:**
   - `admins` (1), `engine_config` (1), `packaging_styles` (4), `design_images` (8), `design_texts` (17), `storage.objects WHERE bucket_id='packaging-assets'` (1)이 그대로인지 확인.
5. **신규 마이그레이션 적용:**
   - `supabase/migrations/20261111000000_payment_retry.sql` 실행 (`event_revision` 추가, `claim_payment_events` 갱신, `cancel_paid_designs` 함수 추가 및 `service_role` 권한 부여).

---

## 4. Vercel 환경변수 및 배포 경계 (Production vs Preview)

Vercel 프로젝트 `dapcue`에서 Production과 Preview 경계를 명확히 분리합니다.

| 변수 | Production (`dapcue.vercel.app`) | Preview / Local 주의사항 |
|---|---|---|
| `ONDAP_DATA_SOURCE` | `supabase` | 로컬 E2E는 `local` |
| `NEXT_PUBLIC_SITE_URL` | `https://dapcue.vercel.app` | Preview가 Production OAuth Redirect를 덮어쓰지 않도록 확인 (`ondapmvp.vercel.app` 제거 필수) |
| `CAFE24_MALL_ID` | `dapcue` | 옛 `axopenlab` 제거 |
| `CAFE24_CLIENT_ID` / `CAFE24_CLIENT_SECRET` / `CAFE24_FRONT_API_KEY` | 새 앱(또는 동일 앱) 운영 키 | 과거 노출 이력 있는 시크릿은 전환 시점에 재발급 권장(사용자 확인 필요) |
| `CAFE24_REDIRECT_URI` | `https://dapcue.vercel.app/api/cafe24/callback` | 카페24 개발자센터 App URL/Redirect URI와 정확히 일치 |
| `CAFE24_WEBHOOK_KEY` | 개발자센터 **WebHook 인증정보** (32자 이상) | Service Key 아님. Preview/로컬과 구분 |
| `CAFE24_API_VERSION` | `2026-09-01` | 코드 기본값과 동일 |
| `CRON_SECRET` | 32자 이상 랜덤 시크릿 | Preview에 노출 금지 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | `ornwnlmprkxqwsheuzdb` 키 유지 | 노출 이력 평가 후 교체 시 즉시 재배포 필요 |
| `GEMINI_API_KEY` | 유지(노출 평가 후 필요 시 교체) | 서버 전용 |

> **Vercel Hobby 플랜 Cron 제한 (공식 문서 확인 기준):**
> - Hobby 플랜에서는 일일 1회만 허용되며(`0 9 * * *` = UTC 09:00), 실행 시각은 **해당 시(18:00~18:59 KST)** 범위 내 가변 윈도우로 동작합니다.
> - Hobby 플랜 약관상 **비상업용 제한**이 적용되므로 실제 상업 운영 시 Vercel **Pro 플랜 전환**이 필요합니다. Pro 전환 후 원하면 결제 재처리(health) 주기를 5~15분 간격으로 단축할 수 있습니다.

---

## 5. 애플리케이션 배포 · 카페24 앱 · 상품/검수 · 스킨 전환 순서

1. **GitHub 브랜치 병합 및 Vercel Production 배포**
   - `codex/dapcue-mall-switch` 검증 통과본을 `main`으로 병합 → Vercel `dapcue` 배포 완료 및 `/api/cron/daily` 응답 확인(`401 Unauthorized` 정상).
2. **카페24 개발자센터 & 쇼핑몰 관리자 설정 (사용자 + AI 단계)**
   - 앱 설정: App URL `https://dapcue.vercel.app`, Redirect URI `https://dapcue.vercel.app/api/cafe24/callback`, WebHook URL `https://dapcue.vercel.app/api/cafe24/payment-webhook`, 이벤트 **`90025`(입금상태), `90026`(취소상태), `90029`(환불상태)** 구독.
   - 주문서 추가입력항목: `답례큐 포장 디자인 코드` (한 줄 텍스트, 선택) 생성.
   - `/admin/health`에서 **"카페24 관리자 계정 연동하기"** 실행 → 사용자 로그인/앱 동의 → `cafe24_tokens`에 `mall_id='dapcue'` 저장 확인.
3. **상품 동기화 및 상품 11(쿠키) 신규 검수 근거 입력**
   - `/admin/formality` (또는 `/api/packaging/option-price?product=11`)에서 `dapcue` 상품 11(+100원 `답례포장 서비스`/`신청`) 동기화 확인.
   - 주의: DB가 1개 상품(상품 11)인 동안 고객 추천 화면은 미검수 상태에서 안내 배너(`no_candidates`)를 표시하고, 상품 11 검수 완료 후 `1개` 후보(`few_candidates`)로 안전 동작합니다. 옛 `axopenlab` 상품 11(한우)의 검수 근거를 절대 재사용하지 않고 새 쿠키 상품 설명으로 5요소 근거를 새로 검토·판정합니다.
4. **카페24 스킨 사본 시험 → 대표 스킨 공개**
   - `gemini-output/patches/*` 기준으로 **시험 스킨 사본**에 4파일 반영 후 검증:
     - `/index.html` (`main-cta.draft.md`)
     - `/layout/basic/layout.html` (`helper-common-layout.draft.md`)
     - `/order/orderform.html` (`helper-orderform.draft.md` — `https://dapcue.vercel.app/cafe24/ondap-helper.js`)
     - `/order/order_result.html` (`ondap-helper.js` 1회 삽입 — 주문 완료 시 `localStorage.ondap_packaging` 즉시 비움)
   - 모바일/PC 360px/1280px, 상품 11 옵션 `신청 (+100원)` 자동선택 및 수량, 주문서 코드 자동입력 및 `oa_content`, 비회원 구매, `/order/order_result.html` 정리 확인 후 대표 스킨으로 전환.
5. **실주문 결제·취소 종단 검증 (사용자 협조)**
   - 디자인 저장 (`pending`) → 포장 신청 결제 → `90025` 웹훅으로 `order_confirmed` 자동 전환 확인 → 주문 취소/환불 → `90026`/`90029` 웹훅으로 `canceled` 복구 확인 → 시험 데이터 정리 → 일반 비포장 주문(`신청안함`) 결제 시 `/admin/health` 및 `/api/cron/daily`가 `failedPayments=0`, `200 OK` 유지 확인.

---

## 6. 장애 시 복구(롤백) 방안

1. **카페24 스킨 즉시 원복:** 카페24 스마트디자인에서 기존 대표 스킨(또는 백업한 `index.html`, `layout.html`, `orderform.html`, `order_result.html`)으로 즉시 복원.
2. **Vercel 즉시 롤백:** Vercel Deployments에서 직전 정상 Deployment(`23ec65794ff87ddbd77e1618f152ed754fc9340f`)로 Promote/Rollback + `CAFE24_MALL_ID`/`NEXT_PUBLIC_SITE_URL` 원복.
3. **DB·Storage 복구 (필요 시):** 단기 백업 폴더의 스냅샷 JSON으로 `restoreSql` 실행 및 백업한 스토리지 파일 재업로드.
4. **안정화 후 사후 정리:** 전환 안정화(예: 14일) 확인 후 단기 로컬 백업 파일 안전 파기.
