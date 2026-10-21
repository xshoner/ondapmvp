// 사이트 글꼴. 가변 글꼴(weight 'variable') 하나로 모든 굵기를 쓴다:
// 한글 글꼴은 굵기마다 @font-face가 약 120개씩 생겨 굵기를 나열하면 모든 페이지의 CSS가 커진다.
//   본문: Noto Sans KR (작은 글씨에서도 또렷함)
//   제목·숫자: Hahmlet (획 끝이 날렵한 현대 명조. 경조사 봉투의 붓글씨 느낌을 단정하게 옮긴 것)
import { Hahmlet, Noto_Sans_KR } from 'next/font/google';

export const sans = Noto_Sans_KR({ subsets: ['latin'], weight: 'variable', variable: '--font-sans' });
export const serif = Hahmlet({ subsets: ['latin'], weight: 'variable', variable: '--font-serif' });
