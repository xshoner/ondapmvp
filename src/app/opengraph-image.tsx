// 기본 공유 미리보기 (메인·포장 등 결과 화면이 아닌 곳)
import { ImageResponse } from 'next/og';
import { OG_COLORS as C, OG_SIZE, ogFonts } from '@/og/font.ts';

export const alt = '온답 답례 큐레이션: 자리에 맞는 답례, 온답이 골라 드립니다';
export const size = OG_SIZE;
export const contentType = 'image/png';

const TITLE = ['자리에 맞는 답례,', '온답이 골라 드립니다'];
const SUB = ['행사와 받는 분, 예산만 알려 주시면', '격식지수로 비교해 지역 답례품 세 가지를 추천합니다.'];
const BRAND = '온답 답례 큐레이션';
const MARKS = '弔婚壽誕榮開謝生';

export default async function Image() {
  const fonts = await ogFonts(TITLE.join('') + MARKS, SUB.join('') + BRAND);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: C.pine, padding: 28 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '2px solid rgba(201,173,116,0.55)', borderRadius: 18, padding: '56px 64px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: '#e9eee9', fontFamily: 'Noto Sans KR', fontSize: 28 }}>
            <div style={{ width: 18, height: 18, background: '#c4493b', transform: 'rotate(45deg)', borderRadius: 2 }} />
            {BRAND}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Hahmlet', fontSize: 72, color: '#ffffff', lineHeight: 1.25, letterSpacing: -2 }}>
            <span>{TITLE[0]}</span>
            <span>{TITLE[1]}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Noto Sans KR', fontSize: 28, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
              <span>{SUB[0]}</span>
              <span>{SUB[1]}</span>
            </div>
            <span style={{ fontFamily: 'Hahmlet', fontSize: 30, color: '#d6be8c', letterSpacing: 18 }}>{MARKS}</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
