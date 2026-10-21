import { getCatalog, logRecommendation } from '@/data/repository.ts';
import { recommend } from '@/engine/recommend.ts';
import type { EventType, Relation, ScoredProduct } from '@/engine/types.ts';
import { ScoreBreakdown } from '../components/score-breakdown.tsx';

export const dynamic = 'force-dynamic';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function TopBar() {
  return (
    <header className="topbar">
      <a className="back" href="/">‹ 조건 바꾸기</a>
      <a className="brand" href="/" style={{ fontSize: 18 }}><span className="brand-mark" aria-hidden />온답</a>
      <span style={{ width: 72 }} />
    </header>
  );
}

export default async function ResultPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const catalog = await getCatalog();
  const { config } = catalog;

  const event = String(sp.event ?? '') as EventType;
  const relation = String(sp.relation ?? '') as Relation;
  if (!config.events[event] || !config.relations[relation]) {
    return (
      <main className="mobile">
        <TopBar />
        <h1 style={{ fontSize: 24, marginTop: 24 }}>자리와 받는 분을 다시 골라 주세요</h1>
        <p className="lead">주소에 행사나 관계 정보가 빠져 있습니다.</p>
        <a className="btn block" style={{ marginTop: 24 }} href="/">처음으로</a>
      </main>
    );
  }
  const budgetMax = sp.budget ? Number(sp.budget) : undefined;
  const quantity = Math.max(1, Number(sp.qty ?? 1) || 1);

  const result = recommend(catalog, { event, relation, budgetMax, quantity });
  await logRecommendation(result, config.modelVersion);
  const [main, ...others] = result.results;
  const eventName = config.events[event].name;
  const packagingHref = (productNo: number) => {
    const q = new URLSearchParams({ product: String(productNo), qty: String(quantity), event, relation });
    if (budgetMax) q.set('budget', String(budgetMax));
    return `/packaging?${q}`;
  };
  const bannedCount = result.excluded.filter((x) => x.reason.startsWith(`${eventName} 제외`)).length;

  return (
    <main className="mobile">
      <TopBar />

      <section className="result-head">
        <h1 style={{ fontSize: 26 }}>{eventName} 자리에 맞춘<br />답례품을 골랐습니다</h1>
        <div className="meta">
          <span>{config.relations[relation].name}</span>
          <span>{budgetMax ? `1개 ${won(budgetMax)} 이하` : '예산 상관없음'}</span>
          <span>{quantity.toLocaleString('ko-KR')}개</span>
        </div>
        <p className="result-note">
          상품 {catalog.products.length}개를 격식지수로 비교했습니다.
          {bannedCount > 0 && ` ${eventName} 자리에 어울리지 않는 ${bannedCount}개는 미리 뺐습니다.`}
          {result.notice && <><br /><span style={{ color: 'var(--danger)' }}>{result.notice}</span></>}
        </p>
      </section>

      {main ? (
        <MainPick item={main} quantity={quantity} packagingHref={packagingHref(main.product.productNo)} />
      ) : (
        <section className="card" style={{ padding: 22, marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>조건에 맞는 상품이 없습니다</h2>
          <p className="small muted" style={{ margin: '6px 0 16px' }}>예산을 넓히거나 관계를 바꿔 다시 찾아보세요.</p>
          <a className="btn ghost block" href="/">조건 바꾸기</a>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h2 className="alt-title">다른 격식 단계의 선택</h2>
          <p className="small muted" style={{ margin: 0 }}>같은 자리에서 조금 더 실속 있게, 또는 가볍게 고를 수 있는 상품입니다.</p>
          <div className="alt-list">
            {others.map((x) => <OtherPick key={x.product.productNo} item={x} packagingHref={packagingHref(x.product.productNo)} />)}
          </div>
        </section>
      )}

      <p className="foot-note">온답 격식지수 가안 {config.modelVersion}</p>
    </main>
  );
}

function MainPick({ item, quantity, packagingHref }: { item: ScoredProduct; quantity: number; packagingHref: string }) {
  const { product, attributes } = item;
  const image = product.detailImage ?? product.image;
  return (
    <article className="pick">
      <div className="pick-media">
        {image ? <img src={image} alt={product.name} /> : <div style={{ aspectRatio: '4 / 3' }} />}
        <div className="seal" role="img" aria-label={`격식지수 ${Math.round(item.matchScore)}점`}>
          <div>
            <div className="seal-label">격식지수</div>
            <div className="seal-score num">{Math.round(item.matchScore)}</div>
          </div>
        </div>
      </div>

      <div className="pick-body">
        <div className="tier">{item.tier}</div>
        <h2 className="pick-name">
          {attributes.region !== '국내' && !product.name.includes(attributes.region) && `[${attributes.region}] `}
          {product.name}
        </h2>
        {attributes.story && attributes.story !== product.name && <p className="pick-story">{attributes.story}</p>}

        <div className="price-table num">
          <span className="muted">1개</span>
          <span>{won(product.price)}</span>
          <span className="muted" style={{ alignSelf: 'center' }}>{quantity.toLocaleString('ko-KR')}개 합계</span>
          <span className="total">{won(product.price * quantity)}</span>
        </div>

        <div className="reason">
          <div className="label">고른 이유</div>
          <p>{item.reason}</p>
          {attributes.tags.length > 0 && <div className="tags">{attributes.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>}
        </div>

        <details className="disclosure">
          <summary>격식지수 계산 보기</summary>
          <div style={{ marginTop: 12 }}><ScoreBreakdown item={item} /></div>
        </details>

        <div className="pick-actions">
          <a className="btn block" href={product.url} target="_blank" rel="noreferrer">이 상품 보러 가기</a>
          <a className="btn ghost block" href={packagingHref}>포장·스티커 꾸미기 <span className="small" style={{ fontWeight: 500, color: 'var(--muted)' }}>무료</span></a>
        </div>
      </div>
    </article>
  );
}

function OtherPick({ item, packagingHref }: { item: ScoredProduct; packagingHref: string }) {
  const { product } = item;
  return (
    <article className="alt">
      <a href={product.url} target="_blank" rel="noreferrer" aria-label={`${product.name} 보러 가기`}>
        {product.image ? <img src={product.image} alt="" /> : <span className="ph" />}
      </a>
      <div style={{ minWidth: 0 }}>
        <div className="tier" style={{ fontSize: 12 }}>{item.tier}</div>
        <a className="alt-name" href={product.url} target="_blank" rel="noreferrer">{product.name}</a>
        <div className="alt-meta num">
          <span>{won(product.price)}</span>
          <span className="score">격식지수 {Math.round(item.matchScore)}</span>
        </div>
        <div className="alt-actions">
          <a className="btn ghost small" href={product.url} target="_blank" rel="noreferrer">상품 보기</a>
          <a className="btn ghost small" href={packagingHref}>포장 꾸미기</a>
        </div>
      </div>
    </article>
  );
}
