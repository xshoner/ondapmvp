---
name: feedback-korean-and-credentials
description: "사용자에게는 항상 한국어로 답하고(요약·버튼 포함), 채팅으로 받은 비밀번호는 저장하지 않는다"
metadata:
  node_type: memory
  type: feedback
  originSessionId: c8b233ef-13ef-4492-b2ea-efbe725df5be
  modified: 2026-10-20T10:37:00.244Z
---

모든 응답은 한국어로 쓴다. wrap_up의 recap·ask·버튼 문구도 한국어.
**Why:** 영어로 요약을 남겼더니 사용자가 "한글로 설명해"라고 다시 요청함(2026-10-20).
**How to apply:** 도구 호출 사이의 짧은 진행 안내까지 한국어로.

사용자가 채팅에 비밀번호·키를 보내는 경우가 있다(카페24 비밀번호를 보낸 적 있음). 문서·저장소·메모리에 기록하지 않고, 노출됐으니 교체를 권한다. 계정 이메일 같은 식별 정보는 로컬 메모리에만, 공개될 수 있는 저장소에는 넣지 않는다.

관련: [[project-ondap-recommendation-engine]]
