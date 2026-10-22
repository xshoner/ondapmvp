// 사이트 기준 주소: 공유 미리보기 그림·검색 안내(robots·sitemap)의 절대 주소를 만든다 (운영 주소 → Vercel이 알려 주는 주소 → 로컬)
// 빈 값(.env.example을 그대로 복사한 경우)도 '없음'으로 본다. 끝의 /는 뗀다
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim()
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://127.0.0.1:3000')).replace(/\/+$/, '');
