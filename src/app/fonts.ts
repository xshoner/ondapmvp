// 사이트 글꼴. 포장 스티커 편집기는 이 중 네 가지를 문구 글꼴로 쓴다 (모두 SIL OFL이라 인쇄물 상업 사용 가능)
import { Gowun_Batang, Nanum_Pen_Script, Noto_Sans_KR, Noto_Serif_KR } from 'next/font/google';
import type { FontId } from '@/packaging/rules.ts';

export const sans = Noto_Sans_KR({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-sans' });
export const serif = Noto_Serif_KR({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-serif' });
const batang = Gowun_Batang({ subsets: ['latin'], weight: ['700'], preload: false });
const pen = Nanum_Pen_Script({ subsets: ['latin'], weight: ['400'], preload: false });

// 캔버스에는 CSS 변수를 쓸 수 없어 실제 글꼴 이름을 넘긴다
export const stickerFontFamilies: Record<FontId, string> = {
  sans: sans.style.fontFamily,
  serif: serif.style.fontFamily,
  batang: batang.style.fontFamily,
  pen: pen.style.fontFamily,
};
