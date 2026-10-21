import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'ecimg.cafe24img.com' }],
  },
  experimental: {
    // 포장 스티커 인쇄 파일(300dpi PNG, 최대 3MB)을 서버 액션으로 받는다. Vercel 요청 한도 4.5MB 안쪽
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
