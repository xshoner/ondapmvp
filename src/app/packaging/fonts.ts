// 포장 스티커 편집기 글꼴 (모두 SIL OFL이라 인쇄물 상업 사용 가능).
// 바탕·손글씨는 이 화면에서만 쓰므로 여기서 선언해 다른 페이지 CSS에 실리지 않게 한다.
import { Gowun_Batang, Nanum_Pen_Script } from 'next/font/google';
import type { FontId } from '@/packaging/rules.ts';
import { sans, serif } from '../fonts.ts';

const batang = Gowun_Batang({ subsets: ['latin'], weight: ['700'], preload: false });
const pen = Nanum_Pen_Script({ subsets: ['latin'], weight: ['400'], preload: false });

// 캔버스에는 CSS 변수를 쓸 수 없어 실제 글꼴 이름을 넘긴다
export const stickerFontFamilies: Record<FontId, string> = {
  sans: sans.style.fontFamily,
  serif: serif.style.fontFamily,
  batang: batang.style.fontFamily,
  pen: pen.style.fontFamily,
};
