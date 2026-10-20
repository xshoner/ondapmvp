import type { Metadata } from 'next';
import { Noto_Sans_KR, Noto_Serif_KR } from 'next/font/google';
import './globals.css';

const sans = Noto_Sans_KR({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-sans' });
const serif = Noto_Serif_KR({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-serif' });

export const metadata: Metadata = {
  title: '온답 — 내 상황에 맞는 답례 찾기',
  description: '행사와 관계에 맞는 지역 답례품을 격식지수로 추천합니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
