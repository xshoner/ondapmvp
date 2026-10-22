import Image from 'next/image';
import { getCatalog } from '@/data/repository.ts';
import { won } from '@/lib/result-query.ts';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 추천 없이 포장만 꾸미고 싶은 고객: 상품을 직접 고른 뒤 편집기로 간다.
// 검색·분류는 주소(?q=&cat=)로 처리해 자바스크립트 없이도 동작한다.
export default async function PickProductPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 40) : '';
  const cat = typeof sp.cat === 'string' ? sp.cat : '';
  const { products, attributes } = await getCatalog();
  const categoryOf = new Map(attributes.map((a) => [a.productNo, a.category]));

  const sellable = products.filter((p) => p.display && p.selling && !p.soldOut);
  const categories = [...new Set(sellable.map((p) => categoryOf.get(p.productNo)).filter((c): c is string => Boolean(c)))].sort();
  const shown = sellable.filter((p) => (!cat || categoryOf.get(p.productNo) === cat) && (!q || p.name.includes(q)));
  const href = (next: { q?: string; cat?: string }) => {
    const u = new URLSearchParams();
    if (next.q) u.set('q', next.q);
    if (next.cat) u.set('cat', next.cat);
    return `/packaging/pick${u.size ? `?${u}` : ''}`;
  };

  return (
    <main className="mobile" style={{ paddingBottom: 24 }}>
      <header className="topbar">
        <a className="back" href="/">‹ 처음으로</a>
        <span className="title">포장만 꾸미기</span>
        <span style={{ width: 72 }} />
      </header>

      <section style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>포장할 상품을<br />골라 주세요</h1>
        <p className="lead">고른 상품을 원하는 포장지와 스티커로 꾸밀 수 있습니다. 포장과 스티커는 무료입니다.</p>
      </section>

      <form method="get" action="/packaging/pick" className="row" style={{ marginTop: 14, gap: 8, flexWrap: 'nowrap' }}>
        {cat && <input type="hidden" name="cat" value={cat} />}
        <input className="num-input" type="search" name="q" defaultValue={q} placeholder="상품 이름 검색 (예: 곶감, 한우)" aria-label="상품 이름 검색" />
        <button type="submit" className="btn small" style={{ flex: 'none', whiteSpace: 'nowrap' }}>찾기</button>
      </form>

      {categories.length > 1 && (
        <nav className="chips event-chips" style={{ marginTop: 12 }} aria-label="분류">
          <a className="chip" href={href({ q })} aria-pressed={!cat} style={{ textDecoration: 'none' }}>전체</a>
          {categories.map((c) => (
            <a key={c} className="chip" href={href({ q, cat: c })} aria-pressed={cat === c} style={{ textDecoration: 'none' }}>{c}</a>
          ))}
        </nav>
      )}

      {shown.length === 0 ? (
        <p className="small muted" style={{ marginTop: 20, textAlign: 'center' }}>맞는 상품이 없어요. 다른 이름으로 찾아 보세요.</p>
      ) : (
        <div className="pick-grid">
          {shown.map((p, i) => (
            <a key={p.productNo} className="card pick-card" href={`/packaging?product=${p.productNo}&from=pick`}>
              {p.image ? (
                <Image src={p.image} alt="" width={240} height={240} sizes="(max-width: 480px) 45vw, 220px" priority={i < 2} />
              ) : (
                <div style={{ aspectRatio: '1', background: '#efe9dc' }} />
              )}
              <div style={{ padding: '8px 10px 10px' }}>
                <div className="small" style={{ fontWeight: 600, lineHeight: 1.35 }}>{p.name}</div>
                <div className="small muted num" style={{ marginTop: 2 }}>{won(p.price)}</div>
                <div className="small" style={{ marginTop: 6, color: 'var(--pine)', fontWeight: 600 }}>포장 꾸미기</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
