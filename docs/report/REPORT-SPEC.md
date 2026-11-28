# 답례큐 최종 결과보고서 — 공동 작업 명세 (Claude · GPT 공용)

두 작성자(Claude, GPT)가 **이 파일 하나를 기준**으로 각자 맡은 장만 쓴다. 맡지 않은 장은 쓰지 않는다. 바꿔야 할 것이 있으면 이 파일을 고치지 말고 사용자에게 알린다.

## 1. 문서 정보

| 항목 | 내용 |
| --- | --- |
| 사업명 | 답례큐 격식지수 등 상품추천엔진 및 관리자 총괄 시스템 구축 |
| 발주처 | 포춘크래프트 |
| 수행사 | NALLIJAKU |
| 사업 기간 | 2026-10-20 ~ 2026-11-30 |
| 운영 주소 | https://dapcue.vercel.app (구 주소 ondapmvp.vercel.app) |
| 쇼핑몰 | https://dapcue.cafe24.com (구 쇼핑몰 axopenlab.cafe24.com은 2026-11-11 전환 이전) |
| 저장소 | github.com/xshoner/ondapmvp (`main` = 운영 배포본) |
| 최종 형식 | 한글(HWPX) + PDF. 원고는 Markdown으로 쓰고 Claude가 조립한다 |

## 2. 목차와 담당

| ID | 장 | 담당 | 원고 파일 |
| --- | --- | --- | --- |
| S-0 | 표지 | Claude | (조립 시) |
| S-요약 | 요약 (1쪽) | **GPT** | `docs/report/gpt/00-summary.md` |
| S-1 | 1. 추진 개요 (배경·목적 / 범위 / 기간 / 추진 체계 / 추진 경과 요약) | **GPT** | `docs/report/gpt/01-overview.md` |
| S-2 | 2. 시스템 구성 (흐름도, 구성 요소, 운영 환경) | Claude | `docs/report/claude/02-system.md` |
| S-3 | 3. 세부 작업 내역 (영역별 표) | Claude | `docs/report/claude/03-work.md` |
| S-4 | 4. 개발·배포 이력 (날짜별 주요 배포 12~15건, 품질 지표) | Claude | `docs/report/claude/04-history.md` |
| S-5 | 5. 주요 기능 소개 및 사용법 (F-01~F-13) | **GPT** | `docs/report/gpt/05-features.md` |
| S-6 | 6. 품질 검증 및 운영 점검 | Claude | `docs/report/claude/06-quality.md` |
| S-7 | 7. 운영 안내 (일상 업무, 되돌리기, 계정·보안 원칙) | Claude | `docs/report/claude/07-operations.md` |
| S-8 | 8. 향후 과제 및 제언 | **GPT** | `docs/report/gpt/08-next.md` |
| S-부록A | 용어 풀이 (10~15개) | **GPT** | `docs/report/gpt/09-glossary.md` |
| S-부록B | 화면·주소 목록 | Claude | `docs/report/claude/10-appendix.md` |
| — | 최종 조립·사실 대조·HWPX/PDF 생성·한글 검수 | Claude | `docs/report/답례큐_결과보고서.hwpx` / `.pdf` |

## 3. 기능 목록 (5장 절 구성, GPT가 이 순서·ID로 쓴다)

| ID | 기능 | 대상 | 주요 화면·코드 |
| --- | --- | --- | --- |
| F-01 | 조건 입력 (행사·받는 분·예산·수량, 지난 조건 이어 하기, 찜한 답례) | 고객 | `/`, `src/app/page.tsx`, `gift-finder-form.tsx` |
| F-02 | 추천 결과 (격식지수 기반 3개, 추천점수 설명, 조건 바꾸기, 제외하고 다시, 비교표, 찜·공유·의견) | 고객 | `/result`, `src/app/recommendation-ui/customer-view.tsx`, `pick-cards.tsx` |
| F-03 | 포장·스티커 꾸미기 (포장지, 문구·받는 분/보내는 분 이름, 미리보기, 확인 후 저장 → 디자인 코드) | 고객 | `/packaging`, `src/app/packaging/` |
| F-04 | 내 디자인 (저장한 디자인, 코드로 진행 상황 조회, 같은 디자인 다시 주문, 그림 받기) | 고객 | `/packaging/mine` |
| F-05 | 카페24 쇼핑몰 연동 (상품 상세 꾸미기 버튼, 수량 맞춤, 주문서 디자인 코드 자동 입력·포장 요약) | 고객 | `public/cafe24/ondap-helper.js` |
| F-06 | 결재 문서 (지출결의·품의서 초안, 검토·편집, HWPX·DOCX·PDF 내려받기) | 고객 | `/approval/[id]`, `src/approval/` |
| F-07 | 대시보드 (오늘 할 일, 기간별 실적, 결재 문서 생성 수, CSV·A4 인쇄) | 관리자 | `/admin` |
| F-08 | 격식지수 판정 (상품별 근거·점수 입력과 검수) | 관리자 | `/admin/formality` |
| F-09 | 가중치 설정 (행사별 가중치·관계 보정·보너스, 전후 미리보기) | 관리자 | `/admin/weights` |
| F-10 | 알고리즘 검증 (행사 8 × 관계 4 시나리오, 기대 정답·일치율) | 관리자 | `/admin/verify` |
| F-11 | 포장 디자인 및 접수 (포장지·이미지·문구·배너 관리, 접수 목록, 주문번호 잇기, 인쇄 PDF) | 관리자 | `/admin/packaging` |
| F-12 | QR 스캔 인쇄 완료 처리 | 관리자 | `/admin/scan` |
| F-13 | 운영상태 점검 | 관리자 | `/admin/health` |

## 4. 그림 목록 (번호 고정, 본문에서는 `[그림 G-xx]`로만 가리킨다)

| ID | 내용 | 담당 | 파일 |
| --- | --- | --- | --- |
| G-01 | 첫 화면 (모바일) | Claude | `images/G-01.png` |
| G-02 | 추천 결과 1위 카드 (모바일) | Claude | `images/G-02.png` |
| G-03 | 추천점수 설명 펼침·비교표 | Claude | `images/G-03.png` |
| G-04 | 추천 결과 (PC) | Claude | `images/G-04.png` |
| G-05 | 포장 편집기 2단계 — 문구·이름 입력 | Claude | `images/G-05.png` |
| G-06 | 포장 편집기 3단계 — 확인·저장 | Claude | `images/G-06.png` |
| G-07 | 디자인 코드 발급 안내 | Claude | `images/G-07.png` |
| G-08 | 내 디자인 | Claude | `images/G-08.png` |
| G-09 | 쇼핑몰 상품 상세의 "포장·스티커 꾸미기" 버튼 | **GPT** | `images/G-09.png` |
| G-10 | 쇼핑몰 주문서 — 디자인 코드 자동 입력·포장 요약 | **GPT** | `images/G-10.png` |
| G-11 | 결재 문서 검토·편집 화면 | Claude | `images/G-11.png` |
| G-12 | 내려받은 결재 문서(HWPX)를 한글에서 연 모습 | Claude | `images/G-12.png` |
| G-13 | 관리자 대시보드 | Claude | `images/G-13.png` |
| G-14 | 격식지수 판정 | Claude | `images/G-14.png` |
| G-15 | 가중치 설정 | Claude | `images/G-15.png` |
| G-16 | 알고리즘 검증 | Claude | `images/G-16.png` |
| G-17 | 포장 접수 목록 | Claude | `images/G-17.png` |
| G-18 | 인쇄 PDF (QR 포함) | Claude | `images/G-18.png` |
| G-19 | QR 스캔 | Claude | `images/G-19.png` |
| G-20 | 운영상태 | Claude | `images/G-20.png` |
| G-21 | 전체 흐름도 (고객 → 추천 → 포장 → 카페24 주문 → 관리자 인쇄) | Claude | `images/G-21.png` |

그림 파일은 모두 `docs/report/images/` 아래에 둔다. PNG, PC는 가로 1440px, 모바일은 390px 화면을 2배로 찍는다. 주소창·북마크·개인 정보는 잘라 낸다.

## 5. 문체·표기 규칙

- 본문은 개조식: `○` 큰 항목, `-` 세부 항목, 문장 끝은 "~함 / ~임 / ~음"
- 사용법만 번호 단계 `1. 2. 3.` (한 단계에 한 동작)
- 개발 용어(커밋, 배포, API, 서버 등)는 처음 나올 때 괄호로 쉬운 말 풀이
- 이름 표기: 서비스명 **답례큐** (구 이름 "온답"은 경과 설명에서만), **격식지수**(상품의 격식 수준 점수), **추천점수**(격식지수에 행사·예산 적합도를 더한 최종 순위 점수), **디자인 코드**(OD-XXXX-XXXX)
- 날짜 `2026-11-28`, 금액 `30,000원`, 수량 `10개`
- 각 절 제목 앞에 절 ID를 붙인다: `## [S-1.1] 배경 및 목적`, `### [F-03] 포장·스티커 꾸미기`
- 저장소에서 확인되지 않는 숫자·날짜·기능은 만들지 말고 `[확인 필요: 무엇을]`으로 남긴다

## 6. 금지 사항 (둘 다)

- `main` 브랜치에 커밋·푸시 금지 (푸시하는 순간 운영 사이트에 배포됨). 작업 브랜치: Claude `report/claude`, GPT `report/gpt`
- 키·비밀번호·토큰·관리자 이메일·쇼핑몰 로그인 아이디·실제 고객 이름·전화번호·주소·주문번호를 원고나 그림에 넣지 않는다
- 로그인 폼에 비밀번호를 대신 입력하지 않는다. 결제를 진행하지 않는다
- 상대 담당 장·그림을 쓰거나 고치지 않는다
