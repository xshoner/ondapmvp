# 인계 시작점 — 다른 계정·다른 PC에서 온답 작업 이어 가기

Claude 계정이 바뀌거나 PC가 바뀌어도 **이 폴더 하나로 작업 맥락을 그대로 이어받기** 위한 묶음이다.
서비스를 새로 하나 더 만드는 절차(코드·DB·배포·카페24)는 [CLONE.md](../CLONE.md)에 있고, 이 문서는 **사람과 Claude의 기억**을 옮기는 절차다.

> ⚠️ **이 폴더는 비공개 저장소 전제다.** 고객 회의록, 대화 원문, 계정 이메일이 들어 있다(비밀번호·키는 가렸다).
> 저장소를 공개로 바꾸려면 먼저 `docs/handoff/`를 지우고 git 기록에서도 없애야 한다. 공개 전환 금지가 기본이다.

## 들어 있는 것

| 파일 | 내용 | 언제 보나 |
| --- | --- | --- |
| `README.md` | 이 문서. 옮기는 순서와 지금 상태 | 맨 처음 |
| `memory/` | Claude가 쓰던 기억 파일 그대로 (프로젝트 현황, 인프라 ID, 카페24 함정, 응답 규칙) | `npm run handoff:restore`가 제자리에 넣는다 |
| `CONVERSATION-HISTORY.md` | 온답 관련 **모든 대화**를 시간순으로 한 파일에. 앞부분에 사용자 요청 목차 | "왜 이렇게 했지?"를 찾을 때 |
| `CONVERSATION-HISTORY-2026-10-22.md` | 새 PC(10/22)에서 이어 한 대화: 개선 보고서·PRD·편의 기능 목록, CR·CD 기능 개발·배포. 이 PC에서 `handoff:export`를 돌리면 위 파일이 이 PC 대화만으로 덮이므로, 내보낸 결과는 날짜 붙인 새 파일로 남긴다 | 10/22 이후 작업 이유를 찾을 때 |
| `source/` | 고객 원자료: 첫 요청 카톡 이미지, `요구사항.txt`, `심이사 회의.txt`(1차 회의 녹취), PRD 기초자료(docx), Claude Docs로 만든 사전 질문지·PRD 기초자료 내보낸 본 | 심이사 관련 판단할 때 |

저장소 **바깥**에 두는 것 (온답 폴더 `_handoff/raw/`, 백업 zip에만):
- 대화 원본 jsonl — 가리지 않은 원문이라 비밀번호가 들어 있다. `/resume`으로 예전 대화를 그대로 열고 싶을 때만 필요
- 포장 예시 원본 그림(`00001~00003.png`, `011~018.png`) — 저장소에는 최적화본(`public/packaging/`)만 있다
- `.env.local` — 비밀값

## A. 같은 PC에서 Claude 계정만 바뀔 때 (가장 흔한 경우)

기록은 PC에 있으므로 거의 할 일이 없다.

1. Claude 데스크톱 앱에서 새 계정으로 로그인
2. Code 탭에서 `C:\Users\Curioud\Desktop\온답` 폴더를 연다 (예전과 같은 폴더 → 같은 기억 폴더를 읽는다)
3. 첫 메시지: **"docs/handoff/README.md 순서대로 인계 받고, 지금 상태와 다음 할 일을 알려줘"**
4. 아래 [C. 계정에 묶여 있어 다시 연결할 것](#c-계정에-묶여-있어-다시-연결할-것)을 처리

## B. 새 PC (또는 온답 폴더가 없는 환경)

| 순서 | 할 일 | 확인 |
| --- | --- | --- |
| 1 | Node 24, git 설치. GitHub에 xshoner 계정(또는 저장소 협업자)으로 로그인 | `node -v`가 v24 |
| 2 | 백업 zip이 있으면 원하는 위치에 풀기 (폴더 이름 `온답` 유지). 없으면 `온답` 폴더를 만들고 그 안에서 `git clone https://github.com/xshoner/ondapmvp.git ondap-mvp` | `온답/ondap-mvp/package.json` 있음 |
| 3 | `cd 온답/ondap-mvp` → `npm ci` | 오류 없음 |
| 4 | `npm run handoff:restore` | `✓ 기억 5개 넣음` 두 줄 |
| 5 | `.env.local` 준비: zip에서 왔으면 이미 있음. 없으면 `cp .env.example .env.local` 후 [CLONE.md 2장](../CLONE.md#2-envlocal-채우기)대로 채우기 | `npm run doctor` |
| 6 | `npm test` | 전부 통과 |
| 7 | Claude Code를 `온답` 폴더(또는 `ondap-mvp`)에서 열고 A-3의 첫 메시지 | Claude가 현황·다음 할 일을 말함 |

경로가 예전(`C:\Users\Curioud\Desktop\온답`)과 달라도 된다. `handoff:restore`가 지금 위치 기준으로 기억을 넣는다.

## C. 계정에 묶여 있어 다시 연결할 것

PC 파일이 아니라 Claude 계정에 붙어 있던 것들이다. 새 계정에서 다시 해야 한다.

| 무엇 | 다시 하는 법 | 없으면 |
| --- | --- | --- |
| Vercel 연결(MCP 플러그인) | 플러그인 `vercel` 설치 후 xshoner Vercel 계정으로 인증 | 배포·로그 조회를 Claude가 못 함. 사람은 vercel.com에서 가능 |
| Supabase 연결(MCP) | 원래도 이 프로젝트 소유 계정이 아니었다 → **연결 안 해도 됨**. SQL은 사용자가 SQL Editor에서 실행 | 영향 없음 |
| Claude in Chrome | 확장 프로그램 재로그인 | 카페24 화면 확인을 Claude가 못 함 |
| bkit 등 플러그인 | 필요하면 재설치 | 작업에는 필수 아님 |
| Claude Docs 2개 (사전 질문지, PRD 기초자료) | 내보낸 본이 `source/`에 있다. 고칠 일이 있으면 새 계정에서 새 문서로 | 원본 링크는 옛 계정에서만 열림 |
| claude.ai 웹 채팅 | 계정이 막히기 전에 Settings → Privacy → Export data | 온답 작업은 모두 Claude Code에서 했으므로 이 이력과 무관 |

## D. 계정이 막히기 전에 할 일 (지금 계정에서)

```bash
npm run handoff:export -- --zip
git add docs/handoff && git commit -m "인계 묶음 갱신" && git push
```

- `handoff:export`: 최신 대화까지 `CONVERSATION-HISTORY.md`·`memory/`를 다시 만들고, 대화 원본을 `../_handoff/raw/`에 복사
- `--zip`: 온답 폴더 전체(원자료·원본 그림·`.env.local`·대화 원본 포함, `node_modules` 제외)를 바탕화면 `온답-인계-날짜.zip`으로. **비밀값이 들어 있으니 공유 금지**, USB나 개인 클라우드에 보관
- 큰 작업을 마칠 때마다 한 번씩 해 두면 언제 막혀도 손실이 없다

## E. 새 환경의 Claude가 읽는 순서 (Claude용)

1. `ondap-mvp/CLAUDE.md` — 작업 규칙 (자동으로 읽힘)
2. 이 문서
3. `memory/MEMORY.md`와 그 안의 파일 4개 — 프로젝트 현황·인프라·카페24·소통 규칙. `handoff:restore`를 안 했으면 여기서 직접 읽는다
4. [CLONE.md](../CLONE.md) 7장 — 만든 것 14단계 한눈에
5. [RUNBOOK.md](../RUNBOOK.md) 0장(현재 상태), 5장(심이사 자료 도착 시 플레이북), 6장(남은 일)
6. 필요할 때만 `CONVERSATION-HISTORY.md` — 목차에서 찾아 해당 부분만 읽는다 (350KB라 통째로 읽지 않는다)

인계를 받았으면 사용자에게 **지금 상태 3줄 + 다음 할 일 + 다시 연결해야 할 것(C표)**을 한국어로 알려 준다.

## 지금 상태 (2026-10-21 기준)

- 엔진 v0.1, 고객·관리자 화면, Supabase, Vercel 운영(ondapmvp.vercel.app), 카페24 연동, 포장 디자인 → 주문서 코드 자동 입력 → 인쇄 PDF, 디자인 개편, 편의 기능, 신뢰감 마감, 복제 도구까지 **모두 커밋·배포 완료**
- 실제 주문 시험은 심이사 몰에서 하기로 하고 생략
- **다음 할 일: 심이사에게 보낼 PRD 초안** (시연 링크, 요청 자료 목록, 구현 범위, 추가 범위 제안). 기초 자료는 `source/PRD기초자료-claude-doc.md`
- 일정: 개발 완료 2026-12-20, 결과보고 2026-12-31. 개발 측 사업자 등록 2026-11-16 이후
- 보안: 2026-10-20에 카페24 쇼핑몰 비밀번호가 채팅에 노출됐다 → 아직 바꾸지 않았다면 교체 권장
