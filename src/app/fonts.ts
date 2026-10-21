// 사이트 글꼴. 가변 글꼴(weight 'variable') 하나로 모든 굵기를 쓴다:
// 한글 글꼴은 굵기마다 @font-face가 약 120개씩 생겨 굵기를 나열하면 모든 페이지의 CSS가 커진다.
import { Noto_Sans_KR, Noto_Serif_KR } from 'next/font/google';

export const sans = Noto_Sans_KR({ subsets: ['latin'], weight: 'variable', variable: '--font-sans' });
export const serif = Noto_Serif_KR({ subsets: ['latin'], weight: 'variable', variable: '--font-serif' });
