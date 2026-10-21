import type { Metadata } from 'next';
import { sans, serif } from './fonts.ts';
import './globals.css';

export const metadata: Metadata = {
  title: '온답 답례 큐레이션',
  description: '행사와 받는 분, 예산에 맞춰 지역 답례품을 격식지수로 골라 드립니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
