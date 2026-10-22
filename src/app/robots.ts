import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site.ts';

// 검색엔진 안내: 고객 화면만 열고 관리자·로그인·내부 주소는 뺀다
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/login', '/api/', '/s/', '/og/', '/packaging/mine'] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
