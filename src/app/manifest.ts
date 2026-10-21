import type { MetadataRoute } from 'next';

// 휴대폰 '홈 화면에 추가' 했을 때의 이름·아이콘·색
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '온답 답례 큐레이션',
    short_name: '온답',
    description: '행사와 받는 분, 예산에 맞춰 지역 답례품을 격식지수로 골라 드립니다.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f4f1',
    theme_color: '#1f4436',
    lang: 'ko',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
