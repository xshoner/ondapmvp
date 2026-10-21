import { getCatalog } from '@/data/repository.ts';
import { getPackagingAssets } from '@/data/packaging-repository.ts';
import type { EventType } from '@/engine/types.ts';
import { CATEGORY_ORDER, categoryName } from '@/packaging/rules.ts';
import type { PackagingAssets } from '@/packaging/types.ts';
import { stickerFontFamilies } from './fonts.ts';
import { PackagingEditor, type PackagingEntry } from './packaging-editor.tsx';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 들어오는 길 세 가지 (from):
//   추천 결과 '이 상품으로 포장 꾸미기'  /packaging?product=12&qty=30&event=longevity&relation=senior&budget=50000
//   카페24 상품 페이지 버튼(도우미 스크립트) /packaging?product=12&qty=30&from=cafe24
//   온답 '포장만 꾸미기' 상품 선택          /packaging?product=12&from=pick
export default async function PackagingPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const catalog = await getCatalog();
  const product = catalog.products.find((p) => p.productNo === Number(sp.product));
  const quantity = Math.min(100000, Math.max(1, Math.round(Number(sp.qty ?? 1) || 1)));
  const event = catalog.config.events[String(sp.event) as EventType] ? (String(sp.event) as EventType) : null;

  let assets: PackagingAssets | null = null;
  try {
    assets = await getPackagingAssets();
  } catch (e) {
    console.error('[포장 디자인] 자산 읽기 실패:', e instanceof Error ? e.message : e);
  }

  const from: PackagingEntry = sp.from === 'cafe24' || sp.from === 'pick' ? sp.from : 'recommend';
  // 돌아갈 곳: 카페24 상품 페이지 / 상품 고르기 / 추천 결과(행사·관계·예산·수량을 그대로 넘겨받는다) / 처음
  const backQuery = new URLSearchParams();
  for (const k of ['event', 'relation', 'budget', 'qty']) if (typeof sp[k] === 'string') backQuery.set(k, sp[k] as string);
  const [backHref, backLabel] =
    from === 'cafe24' && product ? [product.url, '‹ 상품으로']
    : from === 'pick' ? ['/packaging/pick', '‹ 상품 고르기']
    : sp.relation ? [`/result?${backQuery}`, '‹ 추천 결과']
    : ['/', '‹ 처음으로'];

  const back = (
    <header className="topbar">
      <a className="back" href={backHref}>{backLabel}</a>
      <span className="title">포장 꾸미기</span>
      <span style={{ width: 72 }} />
    </header>
  );

  if (!product || !assets || assets.styles.length === 0) {
    return (
      <main className="mobile">
        {back}
        <section className="card" style={{ padding: 20, marginTop: 24, textAlign: 'center' }}>
          <p style={{ margin: 0 }}>{!product ? '상품을 찾을 수 없어요.' : '포장 꾸미기를 준비하고 있어요.'}</p>
          {product && <a className="btn" style={{ marginTop: 14 }} href={product.url} target="_blank" rel="noreferrer">상품 보러 가기</a>}
        </section>
      </main>
    );
  }

  const eventNames = Object.fromEntries(Object.entries(catalog.config.events).map(([k, v]) => [k, v.name]));
  const categoryNames = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, categoryName(c, eventNames)]));

  return (
    <main className="mobile" style={{ paddingBottom: 24 }}>
      {back}
      <PackagingEditor
        product={{ productNo: product.productNo, name: product.name, price: product.price, image: product.image ?? null, url: product.url }}
        quantity={quantity}
        event={event}
        events={(Object.keys(catalog.config.events) as EventType[]).map((id) => ({ id, name: eventNames[id] }))}
        from={from}
        styles={assets.styles}
        images={assets.images}
        texts={assets.texts}
        categoryNames={categoryNames}
        fontFamilies={stickerFontFamilies}
      />
    </main>
  );
}
