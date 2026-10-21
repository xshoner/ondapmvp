import type { Metadata, Viewport } from 'next';
import { sans, serif } from './fonts.ts';
import './globals.css';

// 공유 미리보기 그림 주소를 절대 주소로 만드는 기준 (운영 주소 → Vercel이 알려 주는 주소 → 로컬)
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://127.0.0.1:3000');

export const viewport: Viewport = { themeColor: '#1f4436' };

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: '온답 답례 큐레이션',
  description: '행사와 받는 분, 예산에 맞춰 지역 답례품을 격식지수로 골라 드립니다.',
  openGraph: { siteName: '온답', locale: 'ko_KR', type: 'website' },
  appleWebApp: { title: '온답', statusBarStyle: 'default' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
