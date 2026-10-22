---
name: reference-github-push-account
description: "온답 저장소(xshoner/ondapmvp, 비공개)에 푸시할 때 쓰는 GitHub 계정과 방법"
metadata:
  node_type: memory
  type: reference
  originSessionId: 0c65b06d-2416-45f0-9aea-30c6e22a766c
  modified: 2026-10-22T00:10:07.366Z
---

저장소는 xshoner 계정 소유(비공개). 이 PC의 gh에는 jeebs0627(활성)과 xshoner(비활성) 둘 다 로그인돼 있고, jeebs0627로는 404가 난다.
활성 계정을 바꾸지 않고 명령에만 xshoner를 쓴다:
`git -c credential.helper= -c 'credential.helper=!f() { echo username=x-access-token; echo password=$(gh auth token --user xshoner); }; f' push origin main`
(gh api는 `GH_TOKEN=$(gh auth token --user xshoner) gh api ...`). 토큰 값은 출력하지 않는다.

**Why:** 사용자가 "이 깃허브는 xshoner 계정"이라고 알려 줬고, 계정 전환은 사용자 설정을 바꾸는 일이라 피했다.
**How to apply:** main 푸시 = Vercel 운영 배포. 작업 폴더는 zip에서 시작했으면 `git init` 후 origin/main에 `reset --mixed`로 붙여 차이를 먼저 확인한다. 관련: [[reference-headless-verify]]

주의: 이 PC에서 `npm run handoff:export`를 돌리면 docs/handoff/CONVERSATION-HISTORY.md와 memory/MEMORY.md가 이 PC 대화·기억만으로 덮인다(이전 PC 기록 6천여 줄 손실). 돌린 뒤 두 파일은 `git checkout`으로 되돌리고, 새 이력은 `CONVERSATION-HISTORY-날짜.md`로, 기억 목록은 합쳐서 커밋한다.
