import type { Metadata } from 'next';
import { sans, serif } from './fonts.ts';
import './globals.css';

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
