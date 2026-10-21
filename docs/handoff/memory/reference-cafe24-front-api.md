---
name: reference-cafe24-front-api
description: "카페24 실제 검증 결과 — 앱 설치 필수, localhost 불가, 호출 한도, 스마트디자인 PC/모바일 함정"
metadata:
  node_type: memory
  type: reference
  originSessionId: c8b233ef-13ef-4492-b2ea-efbe725df5be
  modified: 2026-10-20T10:36:55.850Z
---

API (2026-10-20 axopenlab 몰로 직접 검증):
- Front API(`GET https://{mall}.cafe24api.com/api/v2/products[/{no}]`)도 **앱이 몰에 설치(운영자 OAuth 동의)돼야** 동작. 미설치 시 `403 Uninstalled app`. 개발자센터 '테스트 실행'은 설치가 아님.
- 설치 = 브라우저에서 `/api/v2/oauth/authorize?...&scope=mall.read_product` 동의(redirect_uri 정확히 일치). 동의 후 빈 화면+code= 정상. 토큰 교환 없이 Front API 사용 가능.
- 개발자센터 App URL/Redirect URI는 localhost·IP 거부, https+도메인만. 현재 Redirect URI = https://axopenlab.cafe24.com/api/cafe24/callback (임시, 운영 주소로 바꿀 예정).
- Client ID 헤더만 쓰면 호출 버킷 5, Basic(client_id:front_api_key)은 40.
- 문서 위치: apidocs.cafe24.com. 개발자센터 화면은 JS 렌더링이라 자동 수집 불가 → 사용자 캡처나 Claude in Chrome으로 확인.
- 미확인: 제작중(미심사) 앱을 다른 몰(심이사 몰)에 설치 가능한지.

스마트디자인:
- 스킨 CSS가 삽입 HTML 글자색을 덮어씀 → `!important` 필요.
- 모바일은 별도 쇼핑몰(`/m`)·별도 스킨. 기본 모바일 메인은 `product_listmain_1~4`를 쓰는데 테스트몰 상품은 PC PRO 디자인이 쓰는 진열 5·9번에만 있음 → 모바일 진열 번호를 PC와 맞춰야 상품이 나옴. 완성본은 ondap-mvp/cafe24/mobile-index.html.
- 사용자가 부분 수정하다 블록을 지우기 쉬움 → 전체 덮어쓸 완성본 파일을 주는 편이 안전. 반영 안 보이면 Ctrl+F5 → 사이트캐시 삭제. 디자인 보관함 PC/모바일 탭의 대표 디자인 지정 혼동 주의.

관련: [[project-ondap-recommendation-engine]]
