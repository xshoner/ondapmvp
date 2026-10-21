import type { NextConfig } from 'next';

// 관리자가 올린 포장 스타일·추천 이미지 (Supabase 공개 저장소)
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'ecimg.cafe24img.com' },
      ...(supabaseHost ? [{ protocol: 'https' as const, hostname: supabaseHost, pathname: '/storage/v1/object/public/packaging-assets/**' }] : []),
    ],
    localPatterns: [{ pathname: '/packaging/**', search: '' }],
  },
  // 기본 보안 헤더: 다른 사이트가 관리자 화면을 틀(iframe) 안에 넣는 것(클릭재킹)과 형식 추측을 막는다
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  experimental: {
    // 포장 스티커 인쇄 파일(300dpi PNG, 최대 3MB)을 서버 액션으로 받는다. Vercel 요청 한도 4.5MB 안쪽
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
