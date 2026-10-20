import { loadCatalog } from '@/data/catalog.ts';
import { recommend } from '@/engine/recommend.ts';
import type { EventType, Relation, ScoredProduct } from '@/engine/types.ts';
import { ScoreBreakdown } from '../components/score-breakdown.tsx';

export const dynamic = 'force-dynamic';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResultPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const catalog = loadCatalog();
  const { config } = catalog;

  const event = String(sp.event ?? '') as EventType;
  const relation = String(sp.relation ?? '') as Relation;
  if (!config.events[event] || !config.relations[relation]) {
    return (
      <main className="mobile">
        <header className="topbar"><a className="brand" href="/">ONDAP<small>온답</small></a></header>
        <p>행사와 관계를 다시 선택해 주세요.</p>
        <a className="btn" href="/">처음으로</a>
      </main>
    );
  }
  const budgetMax = sp.budget ? Number(sp.budget) : undefined;
  const quantity = Math.max(1, Number(sp.qty ?? 1) || 1);

  const result = recommend(catalog, { event, relation, budgetMax, quantity });
  const [main, ...others] = result.results;
  const eventName = config.events[event].name;
  const bannedCount = result.excluded.filter((x) => x.reason.startsWith(`${eventName} 제외`)).length;

  return (
    <main className="mobile">
      <header className="topbar">
        <a className="small muted" href="/" style={{ textDecoration: 'none' }}>‹ 다시 고르기</a>
        <span className="serif" style={{ fontSize: 15 }}>AI 답례 큐레이션 결과</span>
        <span style={{ width: 60 }} />
      </header>

      <section style={{ textAlign: 'center', marginTop: 16 }}>
        <div style={{ fontSize: 40 }} aria-hidden>🎁</div>
        <h1 style={{ marginTop: 8 }}>준비하신 상황에<br />딱 맞는 선물을 골랐어요</h1>
        <div style={{ marginTop: 12 }}>
          <span className="pill">
            {eventName} / {config.relations[relation].name}
            {budgetMax ? ` / 1개 ${won(budgetMax)} 이하` : ''}
          </span>
        </div>
      </section>

      <section className="card" style={{ padding: 16, marginTop: 20, textAlign: 'center' }}>
        <b>상품 {catalog.products.length}개를 검토했어요</b>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {bannedCount > 0
            ? `${eventName} 자리에 맞지 않는 ${bannedCount}개 상품은 미리 제외했습니다.`
            : '조건에 맞지 않는 상품은 미리 제외했습니다.'}
          {' '}이제 마음 놓고 골라보세요.
        </p>
        {result.notice && <p className="small" style={{ margin: '8px 0 0', color: 'var(--red)' }}>{result.notice}</p>}
      </section>

      {main ? <MainPick item={main} quantity={quantity} /> : <p style={{ marginTop: 24 }}>추천할 상품이 없습니다. 조건을 바꿔 보세요.</p>}

      {others.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ textAlign: 'center', fontSize: 17 }}>다른 격식 단계도 함께 비교해보세요</h2>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${others.length}, 1fr)`, gap: 10, marginTop: 14 }}>
            {others.map((x) => <OtherPick key={x.product.productNo} item={x} />)}
          </div>
        </section>
      )}

      <p className="small muted" style={{ textAlign: 'center', marginTop: 32 }}>
        온답 격식지수 가안 {config.modelVersion} · 개발용 화면
      </p>
    </main>
  );
}

function MainPick({ item, quantity }: { item: ScoredProduct; quantity: number }) {
  const { product, attributes } = item;
  return (
    <section className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
      <div style={{ position: 'relative', background: '#efe9dc' }}>
        {product.detailImage || product.image ? (
          <img src={product.detailImage ?? product.image ?? ''} alt={product.name} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ aspectRatio: '4 / 3' }} />
        )}
        <div style={{
          position: 'absolute', left: 14, top: 14, width: 84, height: 84, borderRadius: '50%',
          background: 'var(--gold)', color: '#fff', display: 'grid', placeItems: 'center', textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)', lineHeight: 1.1,
        }}>
          <div>
            <div style={{ fontSize: 10 }}>온답<br />격식지수</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{Math.round(item.matchScore)}<span style={{ fontSize: 11 }}>점</span></div>
          </div>
        </div>
      </div>

      <div style={{ padding: 18 }}>
        <span className="pill gold">{item.tier}</span>
        <h2 style={{ marginTop: 8 }}>
          {attributes.region !== '국내' && !product.name.includes(attributes.region) && `[${attributes.region}] `}
          {product.name}
        </h2>
        {attributes.story && <p className="small muted" style={{ margin: '4px 0 0' }}>{attributes.story}</p>}

        <div className="spread" style={{ marginTop: 14 }}>
          <span className="muted small">1개</span>
          <b>{won(product.price)}</b>
        </div>
        <div className="spread" style={{ marginTop: 4 }}>
          <span className="small">총 {quantity}개</span>
          <b style={{ fontSize: 20 }}>{won(product.price * quantity)}</b>
        </div>

        <div style={{ background: '#f4f7f5', borderRadius: 12, padding: 14, marginTop: 16 }}>
          <div className="small" style={{ fontWeight: 700, color: 'var(--green)' }}>ONDAP&apos;S PICK!</div>
          <p className="small" style={{ margin: '6px 0 8px' }}>{item.reason}</p>
          <div className="tags">{attributes.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>
        </div>

        <details style={{ marginTop: 14 }}>
          <summary className="small muted" style={{ cursor: 'pointer' }}>격식지수는 이렇게 계산됐어요</summary>
          <div style={{ marginTop: 10 }}><ScoreBreakdown item={item} /></div>
        </details>

        <a className="btn block" style={{ marginTop: 16 }} href={product.url} target="_blank" rel="noreferrer">
          이 상품 보러 가기
        </a>
      </div>
    </section>
  );
}

function OtherPick({ item }: { item: ScoredProduct }) {
  const { product } = item;
  return (
    <a className="card" href={product.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', overflow: 'hidden', display: 'block' }}>
      <div style={{ background: 'var(--gold-weak)', color: '#7a5b17', fontSize: 11, fontWeight: 700, textAlign: 'center', padding: '4px 0' }}>
        {item.tier}
      </div>
      {product.image && <img src={product.image} alt={product.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />}
      <div style={{ padding: 10 }}>
        <div className="small" style={{ fontWeight: 600, lineHeight: 1.35 }}>{product.name}</div>
        <div className="small muted" style={{ marginTop: 4 }}>{won(product.price)}</div>
        <div className="small" style={{ marginTop: 2, color: 'var(--green)' }}>격식지수 {Math.round(item.matchScore)}점</div>
      </div>
    </a>
  );
}
