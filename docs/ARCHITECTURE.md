# 온답 기능 지도 — 화면·데이터·코드가 어디에 있나

코드에서 직접 뽑은 현재(2026-10-22) 구조다. 새로 복제하는 순서는 [CLONE.md](CLONE.md), 시행착오와 결정 배경은 [RUNBOOK.md](RUNBOOK.md).

## 1. 한 장으로 보는 흐름

```
고객 ── 처음 화면(행사·관계·예산·수량) ── 추천 결과 3개(격식지수) ──┬─ 쇼핑몰 상품 보기
                                                                 └─ 포장 꾸미기(스타일 + 스티커 편집기)
                                                                       │ 저장 → 디자인 코드 OD-XXXX-XXXX
                                                                       ▼
카페24 쇼핑몰 ── 상품 상세(도우미가 수량 맞춤) ── 주문서(도우미가 코드 자동 입력·포장 요약) ── 주문
                                                                       ▼
관리자 ── 포장 디자인 접수(주문번호 잇기·상태) ── 인쇄 PDF(A4/A3, QR) ── QR 찍어 인쇄 완료 ── 실적
```

- 추천 엔진은 서버에서 돈다(`src/engine/`). 같은 입력이면 늘 같은 결과(동점은 정해진 순서로 가른다)
- 데이터 입구는 두 파일뿐: `src/data/repository.ts`(상품·지표·설정·기록), `src/data/packaging-repository.ts`(포장 자산·접수·인쇄 파일). `ONDAP_DATA_SOURCE=local`이면 `data/*.json`, `supabase`면 Supabase

## 2. 화면과 주소

### 고객

| 주소 | 하는 일 | 주요 파일 |
| --- | --- | --- |
| `/` | 행사·관계·예산(1개당 또는 전체÷수량)·수량 고르기, 지난 조건 이어 하기, 찜한 답례, 이번 달 이용 수 | `src/app/page.tsx`, `gift-finder-form.tsx`, `saved-picks.tsx` |
| `/result?event&relation&budget&qty&exclude` | 추천 3개 + 격식지수 도장, 조건 칩 바로 바꾸기, 이 상품 빼고 다시, 합계·배송비, 비교표, 공유, 찜, 추천 의견(도움 됐어요/아쉬워요) | `src/app/result/*` |
| `/formality` | 격식지수 소개(지표·가중치·보너스) | `src/app/formality/page.tsx` |
| `/packaging?product&qty&event` | 포장 스타일 + 스티커 편집기(사진·문구·이름 자동 채우기·실물 크기 미리보기·되돌리기·자동 보관) → 디자인 코드 | `src/app/packaging/packaging-editor.tsx`, `sticker-canvas.tsx`, `editor-store.ts` |
| `/packaging/pick` | 추천 없이 상품 골라 꾸미기 | `src/app/packaging/pick/page.tsx` |
| `/packaging/mine` | 이 기기에 저장한 디자인, 코드로 진행 상황 조회, 같은 디자인 다시 주문, 스티커 그림 받기 | `src/app/packaging/mine/mine-view.tsx` |
| `/og/result` | 결과 공유 미리보기 그림(PNG) | `src/app/og/result/route.tsx` |
| `/api/design/[code]` | 카페24 주문서 도우미용 포장 요약(편집 내용·주문번호 없음, CORS 허용) | `src/app/api/design/[code]/route.ts` |
| `/s/[code]` | 인쇄 PDF의 QR이 가리키는 주소 → 관리자 스캔 화면 | `src/app/s/[code]/route.ts` |

### 관리자 (`/login` → `/admin/*`, `src/proxy.ts`가 로그인 확인)

| 주소 | 하는 일 |
| --- | --- |
| `/admin` | 상품 지표 입력(키보드 단축키), 추천 진단(바꾸면 1위가 달라지는 조건), 고객 카드 미리보기, 변경 이력, AI 점수 제안, 카페24 다시 가져오기 요약 |
| `/admin/bulk` | 엑셀(CSV, UTF-8·EUC-KR)로 한꺼번에 고치기: 바뀐 칸만 미리 보고 저장 |
| `/admin/ai-batch` | AI 일괄 제안(제안만, 저장은 사람) |
| `/admin/weights` | 행사별 가중치·관계별 보정·보너스·예산 확대·소멸위기지역, 점수 기준 예시, 바꾸기 전후 미리보기 |
| `/admin/verify` | 행사 8 × 관계 4 = 32 시나리오 표, 기대 정답 지정·일치율 |
| `/admin/packaging` | 포장 스타일·추천 이미지·문구 관리, 접수 목록(필터·단축키 j/k/x/p/s·한꺼번에 상태 바꾸기·주문 상세 붙여넣어 주문번호 잇기·늦어지는 건), 인쇄 PDF·시험 1장·ZIP·CSV |
| `/admin/scan` | QR 찍어 인쇄 완료(브라우저 카메라 또는 휴대폰 카메라 앱), 되돌리기 |
| `/admin/stats` | 기간별 추천·접수·주문·인쇄, 행사·관계별, 많이 추천된 상품, 고객 목소리, 찾았지만 없던 것, CSV, A4 인쇄 |
| 모든 관리자 화면 위 | 오늘 할 일 띠(주문 확인 대기·인쇄 대기·늦어지는 건) |

### 카페24 쇼핑몰 쪽

- `public/cafe24/ondap-helper.js`: 쇼핑몰 스킨이 불러오는 도우미. 상품 상세에 "포장·스티커 꾸미기" 버튼, 링크로 받은 수량 맞추기, 주문서 "온답 포장 디자인 코드" 칸 자동 입력 + 포장 요약·수량 비교. 배포와 함께 바뀐다
- `cafe24/ondap-cta.html`: 메인 화면 버튼 블록 (`npm run cafe24:snippets -- https://주소`로 주소를 맞춘 사본 생성)

## 3. 데이터

### Supabase 표 (`supabase/migrations/`, 새 프로젝트는 `supabase/setup.sql` 한 번)

| 표 | 내용 | 누가 쓰나 |
| --- | --- | --- |
| `admins` | 관리자 사용자 id | 관리자 판별 `private.is_admin()` |
| `products` | 카페24 상품(가격·진열·판매·품절·이미지·주소) | 누구나 읽기, 관리자(동기화) 쓰기 |
| `product_attributes` | 상품 지표(점수 6개·행사·관계·제외 행사·선물의 의미·산지·태그·스토리) | 누구나 읽기, 관리자 쓰기 |
| `product_attributes_history` | 지표 변경 이력(트리거가 자동으로, 바꾼 사람 이메일) | 관리자 읽기 |
| `engine_config` | 엔진 설정 한 행(`id = 'active'`) | 누구나 읽기, 관리자 쓰기 |
| `scenario_expectations` | 32 시나리오 기대 정답 | 관리자 |
| `recommendation_logs` | 추천 기록(행사·관계·예산·수량·결과 상품). 봇·'빼고 다시'는 안 남김 | 누구나 추가, 관리자 읽기 |
| `recommendation_feedback` | 추천 의견(도움 여부·이유 보기 5개 중 선택) | 누구나 추가, 관리자 읽기 |
| `packaging_styles`, `design_images`, `design_texts` | 포장 스타일·추천 이미지·추천 문구 | 누구나 사용 중인 것 읽기, 관리자 쓰기 |
| `designs` | 디자인 접수(코드·상품·수량·스타일·스티커·편집 내용·상태·주문번호·메모·원본 연결) | 누구나 추가(제한 있음), 관리자 읽기·쓰기 |

함수·트리거 (모두 `set search_path = ''`)

| 이름 | 하는 일 |
| --- | --- |
| `private.is_admin()` | 지금 로그인한 사람이 관리자인지 (RLS 규칙이 쓴다) |
| `public.lookup_design(code)` | 고객 코드 조회: 상태·상품·수량만(편집 내용·주문번호·메모 없음) |
| `public.reorder_design(code, new_code, qty)` | 같은 디자인 다시 주문(취소 건 불가, 인쇄 파일은 처음 원본 것) |
| `public.monthly_recommendation_count()` | 처음 화면 '이번 달 n번' (한국 시간 기준 달) |
| `designs_pin_insert` | 접수 시각을 DB가 찍고, 상품명·포장 이름은 DB 값으로, 없는 상품 거절 |
| `designs_status_changed` | 상태가 바뀔 때만 상태 시각 갱신 |
| `designs_throttle`, `feedback_throttle` | 10분에 너무 많이 들어오면 거절 |
| `recommendation_logs_pin`, `recommendation_feedback_pin` | 기록 시각을 DB가 찍는다(미래 시각 위조 방지) |
| `product_attributes_audit` | 지표 추가·수정·삭제 이력(내용이 같으면 안 남김) |

저장소(Storage): `packaging-assets`(공개, 관리자 업로드 그림), `design-files`(비공개, 인쇄 PNG). PostgREST는 한 번에 1,000행까지라 목록은 `src/data/db.ts`의 `readPages()`로 나눠 읽는다.

### 로컬 모드 파일 (`data/`)

| 파일 | 내용 | git |
| --- | --- | --- |
| `cafe24-products.json`, `product-attributes.json`, `config/engine.json`, `packaging.json` | 테스트몰 상품 40개·지표·엔진 설정·포장 자산 | 포함 |
| `designs.json`, `design-files/`, `attribute-history.json`, `feedback.json` | 접수·인쇄 파일·지표 이력·추천 의견 | 제외 |

### 브라우저에 남기는 것 (고객 기기, 서버로 안 감)

| 이름 | 내용 |
| --- | --- |
| `ondap_last_query` | 지난 조건(30일) |
| `ondap_saved_picks` | 찜한 답례(최대 30) |
| `ondap_feedback_sent` | 의견을 보낸 결과(같은 결과에 다시 안 묻기) |
| `ondap_my_designs` | 이 기기에 저장한 디자인(최근 10개, 작은 그림·다시 꾸미기 정보) |
| `ondap_editor_autosave` | 꾸미던 디자인 자동 보관(저장하면 지움) |
| `ondap_fields` | 받는 분·보내는 분 이름(편집기 자동 채우기) |
| `ondap_px_per_mm` | 실물 크기 미리보기 화면 보정값 |
| `ondap_packaging` | (쇼핑몰 쪽 도우미) 방금 받은 코드·수량·상품 번호, 24시간 |
| IndexedDB `ondap` / `photos` | 올린 사진 원본·스티커 그림(다시 꾸미기·그림 받기) |

## 4. 코드 지도

| 폴더 | 내용 |
| --- | --- |
| `src/engine/` | 격식지수 엔진: `formality.ts`(지표·가중치·보너스), `recommend.ts`(거르기·순위·다양성·예산 확대), `explain.ts`(추천 문구), `impact.ts`(관리자 진단), `labels.ts`(행사·관계 순서·검사) |
| `src/data/` | 데이터 입구(위 1장), `catalog.ts`(로컬 JSON), `rows.ts`(DB 행 ↔ 객체), `attributes-csv.ts`(엑셀), `db.ts`(오류·나눠 읽기) |
| `src/packaging/` | 포장 규칙(크기·도련·글꼴·주의 단어·디자인 코드), 인쇄 판짜기 `sheet.ts`, PDF `print-pdf.ts`, 주문 붙여넣기 해석, 접수 필터 |
| `src/lib/` | 결과 주소 해석 `result-query.ts`(금액 표시 `won` 포함), 브라우저 저장 `device.ts`, 고객 의견 `feedback.ts`, 요청 횟수 제한, 관리자 확인, 한국 시간 |
| `src/stats/` | 실적 집계(일별·행사·관계·상품·찾았지만 없던 것) |
| `src/ai/` | Gemini 점수 제안(재시도·대체 모델·40초 제한) |
| `src/cafe24/` | Front API 상품 가져오기, 동기화 전후 비교 |
| `src/proxy.ts` | 관리자 주소 로그인 확인(Next 16에서 middleware 대신) |
| `scripts/` | `doctor`(설정 점검), `db:*`(SQL 만들기·내려받기), `cafe24:*`, `handoff:*`, `e2e/`(아래) |

## 5. 검증 체계

| 명령 | 무엇을 | 개수 |
| --- | --- | --- |
| `npm test` | 엔진·포장 규칙·판짜기·실적·주소 해석·보안 도우미·SQL 동기 상태·32 시나리오 | 121 |
| `npm run typecheck` | 타입 | — |
| `npm run e2e` | 화면 없는 Chrome으로 고객·관리자·카페24 도우미 흐름 끝까지(로컬 모드 개발 서버 필요, `data/`는 자동 백업·복원) | 77 |
| `npm run e2e:db` | 마이그레이션·setup.sql을 PGlite(Postgres)에서 실행해 RLS·함수·트리거 시험(Supabase 계정 불필요) | 37 |
| `npm run e2e:pdf` | 인쇄 PDF의 QR이 실제로 읽히는지, 장수가 늘어도 파일이 커지지 않는지 | 6 |
| `npm run doctor -- https://운영주소` | 환경변수·Supabase·카페24·배포 상태 | — |

`e2e:db`·`e2e:pdf`는 처음 한 번 `npm --prefix scripts/e2e ci`(PGlite·jsQR, 앱 의존성과 분리). Chrome 위치가 특이하면 `CHROME_PATH`.

## 6. 보안 요점

- 키는 `.env.local`과 Vercel 환경변수(Sensitive)에만. 공개 키(publishable)는 브라우저 번들에 넣지 않고 서버에서만 쓴다
- 고객이 넣는 표는 모두 RLS로 "추가만", 읽기는 관리자. 시각·상품명은 DB가 정한다. 요청 횟수 제한은 서버 액션(접속 주소당)과 DB(전체) 두 겹
- 주소로 들어온 행사·관계 값은 `isEvent`·`isRelation`(기본 속성 이름 `constructor` 등 거름)으로 검사
- CSV 내려받기는 수식으로 읽히는 값(`= + - @` 탭·줄바꿈 시작) 앞에 `'`
- 관리자 로그인은 접속 주소당 10분 10회, 가입은 Supabase에서 꺼 둔다

## 7. 기획 문서 (claude.ai 문서, 저장소 밖)

| 문서 | 내용 |
| --- | --- |
| [온답 서비스 개선 과제 보고서](https://claude.ai/artifact/KF9yXoBKqa9iJFYiTSBTKq) | 현황 점검과 과제 A·B·C, 로드맵 |
| [온답 쇼핑몰 PRD](https://claude.ai/artifact/BKSUnkjWMLWpYrmpa3tbXu) | Part 1 MVP 재현 명세 ~ Part 4 차별화 |
| [온답 세부 편의 기능 작업 리스트](https://claude.ai/artifact/XmufB7f1hVpmgoLK3LXVYm) | CR·CD·CO·AM·AP·AS 53개와 상태 |

비공개 문서라 다른 계정에서는 작성자가 공유해야 열린다. 각 문서 오른쪽 위 메뉴에서 Markdown·PDF·Word로 내려받을 수 있다.
