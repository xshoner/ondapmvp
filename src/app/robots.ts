import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site.ts';

// 검색엔진 안내: 고객 화면만 열고 관리자·로그인·내부 주소는 뺀다.
// 공유 미리보기 그림(/og/)은 막지 않는다: 카카오톡·SNS 수집기가 robots.txt를 따르면 링크 그림이 안 뜬다
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/login', '/api/', '/s/', '/packaging/mine'] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
