---
name: reference-headless-verify
description: 데스크톱 앱 브라우저 창이 숨겨지면 화면 확인이 멈추는 문제와 화면 없는 Chrome(CDP) 검증 방법
metadata:
  node_type: memory
  type: reference
  originSessionId: 0c65b06d-2416-45f0-9aea-30c6e22a766c
  modified: 2026-10-22T00:10:13.826Z
---

Claude 데스크톱 앱의 브라우저 창이 숨겨져 있으면 requestAnimationFrame이 돌지 않아 React 19의 스트리밍 화면 공개(`$RC`→rAF)와 하이드레이션이 멈춘다. `/packaging/mine` 같은 loading.tsx 아래 화면이 "찾고 있습니다"에서 멈춰 보이면 코드 문제가 아니다.
대신 `C:/Program Files/Google/Chrome/Application/chrome.exe --headless=new --remote-debugging-port=…`를 띄워 Node 24 내장 WebSocket으로 CDP를 직접 부르면 된다 (모바일은 Emulation.setUserAgentOverride로 안드로이드 UA, 사진 올리기는 DOM.setFileInputFiles). 2026-10-22 CR·CD 기능 검증 때 이 방식으로 26개 시나리오를 돌렸다.

**Why:** 숨겨진 창에서 몇십 초씩 기다려도 진행이 안 됐다.
**How to apply:** 화면 검증이 멈추면 먼저 `tabs_context`에서 "hidden"인지 보고, 그렇다면 headless Chrome으로 검증한다. 관련: [[reference-github-push-account]]
