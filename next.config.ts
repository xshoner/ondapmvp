import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'ecimg.cafe24img.com' }],
  },
};

export default nextConfig;
