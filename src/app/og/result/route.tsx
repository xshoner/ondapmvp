// 추천 결과 공유 미리보기: /og/result?event=&relation=&budget=&qty=&exclude=
// 결과 화면과 같은 계산으로 1순위 상품 사진·이름·격식지수 도장을 그린다 (추천 기록은 남기지 않는다)
import { ImageResponse } from 'next/og';
import { getCatalog } from '@/data/repository.ts';
import { recommend } from '@/engine/recommend.ts';
import { isEvent, isRelation } from '@/engine/labels.ts';
import { OG_COLORS as C, OG_SIZE, ogFonts } from '@/og/font.ts';
import { clampQty, parseBudget, parseExclude } from '@/lib/result-query.ts';

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const catalog = await getCatalog();
  const event = q.get('event');
  const relation = q.get('relation');
  if (!isEvent(catalog.config, event) || !isRelation(catalog.config, relation)) return new Response('잘못된 조건입니다.', { status: 400 });
  const budgetMax = parseBudget(q.get('budget')) ?? undefined;
  const quantity = clampQty(q.get('qty') ?? 1);
  const seal = event === 'funeral' ? C.sealCalm : C.seal; // 장례는 축하 느낌의 인주색 대신 차분한 색

  const result = recommend(catalog, { event, relation, budgetMax, quantity, exclude: parseExclude(q.get('exclude')) });
  const main = result.results[0];
  const eventName = catalog.config.events[event].name;
  const title = `${eventName} 자리에 맞춘 답례품`;
  const name = main ? main.product.name : '조건에 맞는 상품을 찾지 못했습니다';
  const score = main ? String(Math.round(main.matchScore)) : '';
  const tier = main?.tier ?? '';
  const others = result.results.length - 1;
  // 그림 글꼴 엔진은 단어 단위 줄바꿈을 못 하므로 줄을 직접 나눈다
  const metaLines = [
    `${catalog.config.relations[relation].name}, ${budgetMax ? `1개 ${budgetMax.toLocaleString('ko-KR')}원 이하` : '예산 상관없음'}`,
    others > 0 ? `외 ${others}가지 함께 추천` : '',
  ].filter(Boolean);
  const meta = metaLines.join('');
  const image = main ? (main.product.detailImage ?? main.product.image) : null;

  const fonts = await ogFonts(title + score + '격식지수', name + tier + meta + '온답 답례 큐레이션');
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: C.paper }}>
        {image ? (
          <img src={image} width={630} height={630} style={{ width: 630, height: 630, objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 630, height: 630, background: '#e8eae4', display: 'flex' }} />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '52px 52px 48px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'Noto Sans KR', fontSize: 24, color: C.muted }}>
            <div style={{ width: 14, height: 14, background: seal, transform: 'rotate(45deg)', borderRadius: 2 }} />
            온답 답례 큐레이션
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Hahmlet', fontSize: 50, color: C.ink, lineHeight: 1.25, letterSpacing: -1.5 }}>
              <span>{`${eventName} 자리에 맞춘`}</span>
              <span>답례품</span>
            </div>
            {tier && <span style={{ fontFamily: 'Noto Sans KR', fontSize: 24, color: C.brass }}>{tier}</span>}
            <span style={{ fontFamily: 'Noto Sans KR', fontSize: 30, color: C.ink, lineHeight: 1.4, wordBreak: 'keep-all' }}>{name.length > 34 ? `${name.slice(0, 33)}…` : name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Noto Sans KR', fontSize: 22, color: C.muted, lineHeight: 1.5 }}>
              {metaLines.map((l) => <span key={l}>{l}</span>)}
            </div>
            {score && (
              <div style={{ width: 136, height: 136, background: seal, borderRadius: 10, transform: 'rotate(-4deg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
                <div style={{ flex: 1, height: '100%', border: '2px solid rgba(255,255,255,0.55)', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <span style={{ fontFamily: 'Hahmlet', fontSize: 18 }}>격식지수</span>
                  <span style={{ fontFamily: 'Hahmlet', fontSize: 58, lineHeight: 1 }}>{score}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } },
  );
}
