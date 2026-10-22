import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site.ts';

// 검색엔진에 알릴 고객 화면 (추천 결과는 조건마다 주소가 달라 넣지 않는다)
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${siteUrl}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${siteUrl}/formality`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${siteUrl}/packaging/pick`, changeFrequency: 'weekly', priority: 0.7 },
  ];
}
