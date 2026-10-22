import type { Metadata } from 'next';
import { getCatalog, logRecommendation } from '@/data/repository.ts';
import { recommend } from '@/engine/recommend.ts';
import { eventIds, relationIds } from '@/engine/labels.ts';
import type { EngineConfig, EventType, Relation, ScoredProduct } from '@/engine/types.ts';
import { BUDGET_STEPS, MAX_EXCLUDE, MAX_QTY, budgetChipText, budgetText, parseResultQuery, resultHref, shippingFee, type ResultQuery } from '@/lib/result-query.ts';
import { ScoreBreakdown } from '../components/score-breakdown.tsx';
import { CloseCondOnOutside, RememberQuery, SavePickButton } from './client-bits.tsx';
import { ShareButton } from './share-button.tsx';

export const dynamic = 'force-dynamic';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 카카오톡 등으로 공유할 때 보이는 제목·그림 (그림은 /og/result가 같은 조건으로 그린다)
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const q = parseResultQuery(await searchParams);
  const { config } = await getCatalog();
  const event = q.event as EventType;
  const relation = q.relation as Relation;
  if (!config.events[event] || !config.relations[relation]) return {};
  const title = `${config.events[event].name} 자리에 맞춘 답례품 | 온답`;
  const description = `${config.relations[relation].name}께 드릴 답례품을 격식지수로 골랐습니다. 추천 세 가지를 확인해 보세요.`;
  const image = { url: `/og${resultHref(q)}`, width: 1200, height: 630, alt: title };
  return { title, description, openGraph: { title, description, images: [image], type: 'website', locale: 'ko_KR' }, twitter: { card: 'summary_large_image', title, description, images: [image.url] } };
}

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
  const q = parseResultQuery(await searchParams);
  const catalog = await getCatalog();
  const { config } = catalog;

  const event = q.event as EventType;
  const relation = q.relation as Relation;
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
  const quantity = q.qty;

  const result = recommend(catalog, { event, relation, budgetMax: q.budget ?? undefined, quantity, exclude: q.exclude });
  if (q.exclude.length === 0) await logRecommendation(result, config.modelVersion); // '빼고 다시'는 같은 고객의 다시 보기라 세지 않는다
  const [main, ...others] = result.results;
  const eventName = config.events[event].name;
  const calm = event === 'funeral'; // 장례는 축하 느낌(인주색 도장·찍히는 움직임)을 빼고 차분하게
  const packagingHref = (productNo: number) => {
    const p = new URLSearchParams({ product: String(productNo), qty: String(quantity), event, relation });
    if (q.budget !== null) p.set('budget', String(q.budget));
    return `/packaging?${p}`;
  };
  // 뺄 수 있는 칸이 남았을 때만 "빼고 다시" 링크를 준다
  const excludeHref = (productNo: number) => (q.exclude.length < MAX_EXCLUDE ? resultHref(q, { exclude: [...q.exclude, productNo] }) : null);
  const bannedCount = result.excluded.filter((x) => x.reason.startsWith(`${eventName} 제외`)).length;

  return (
    <main className={calm ? 'mobile mood-calm' : 'mobile'}>
      <TopBar />
      <RememberQuery query={q} />
      <CloseCondOnOutside />

      <section className="result-head">
        {calm ? (
          <>
            <h1 style={{ fontSize: 26 }}>조문해 주신 분들께 드릴<br />답례품을 골랐습니다</h1>
            <p className="lead" style={{ fontSize: 14 }}>경황이 없으신 중에도 감사의 마음을 전하실 수 있도록 정리했어요.</p>
          </>
        ) : (
          <h1 style={{ fontSize: 26 }}>{eventName} 자리에 맞춘<br />답례품을 골랐습니다</h1>
        )}
        <ConditionBar q={q} config={config} />
        <div style={{ marginTop: 12 }}><ShareButton title={`${eventName} 답례품`} /></div>
        <p className="result-note">
          상품 {catalog.products.length}개를 격식지수로 비교했습니다.
          {bannedCount > 0 && ` ${eventName} 자리에 어울리지 않는 ${bannedCount}개는 미리 뺐습니다.`}
          {q.exclude.length > 0 && <> 빼 두신 상품 {q.exclude.length}개는 제외했어요. <a className="text-link" href={resultHref(q, { exclude: [] })}>모두 되돌리기</a></>}
          {result.notice && <><br /><span style={{ color: 'var(--danger)' }}>{result.notice}</span></>}
        </p>
      </section>

      {main ? (
        <MainPick item={main} quantity={quantity} packagingHref={packagingHref(main.product.productNo)} excludeHref={excludeHref(main.product.productNo)} />
      ) : (
        <section className="card" style={{ padding: 22, marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>조건에 맞는 상품이 없습니다</h2>
          <p className="small muted" style={{ margin: '6px 0 16px' }}>예산을 넓히거나 관계를 바꿔 다시 찾아보세요.</p>
          {q.exclude.length > 0 && <a className="btn block" style={{ marginBottom: 8 }} href={resultHref(q, { exclude: [] })}>뺀 상품 되돌리기</a>}
          <a className="btn ghost block" href="/">조건 바꾸기</a>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h2 className="alt-title">다른 격식 단계의 선택</h2>
          <p className="small muted" style={{ margin: 0 }}>같은 자리에서 조금 더 실속 있게, 또는 가볍게 고를 수 있는 상품입니다.</p>
          <div className="alt-list">
            {others.map((x) => <OtherPick key={x.product.productNo} item={x} packagingHref={packagingHref(x.product.productNo)} excludeHref={excludeHref(x.product.productNo)} />)}
          </div>
        </section>
      )}

      {result.results.length > 1 && <CompareTable items={result.results} quantity={quantity} />}

      <p className="foot-note">온답 격식지수 가안 {config.modelVersion}</p>
    </main>
  );
}

// 결과 화면에서 조건 하나만 바로 바꾼다. 같은 이름의 <details>는 하나만 열린다 (스크립트 없음)
function ConditionBar({ q, config }: { q: ResultQuery; config: EngineConfig }) {
  const reset = { exclude: [] }; // 조건이 바뀌면 뺀 상품도 의미가 달라진다
  return (
    <div className="cond-bar">
      <Cond label={config.events[q.event as EventType].name} title="행사">
        {eventIds(config).map((id) => <CondLink key={id} href={resultHref(q, { event: id, ...reset })} on={id === q.event}>{config.events[id].name}</CondLink>)}
      </Cond>
      <Cond label={config.relations[q.relation as Relation].name} title="받는 분">
        {relationIds(config).map((id) => <CondLink key={id} href={resultHref(q, { relation: id, ...reset })} on={id === q.relation}>{config.relations[id].name}</CondLink>)}
      </Cond>
      <Cond label={budgetChipText(q.budget)} title="1개당 예산">
        {BUDGET_STEPS.map((b) => <CondLink key={String(b)} href={resultHref(q, { budget: b, ...reset })} on={b === q.budget}>{budgetText(b)}</CondLink>)}
      </Cond>
      <Cond label={`${q.qty.toLocaleString('ko-KR')}개`} title="수량">
        <form action="/result" className="cond-qty">
          <input type="hidden" name="event" value={q.event} />
          <input type="hidden" name="relation" value={q.relation} />
          {q.budget !== null && <input type="hidden" name="budget" value={q.budget} />}
          {q.exclude.length > 0 && <input type="hidden" name="exclude" value={q.exclude.join(',')} />}
          <input className="num-input" type="number" name="qty" inputMode="numeric" min={1} max={MAX_QTY} defaultValue={q.qty} aria-label="수량" required />
          <button type="submit" className="btn small">바꾸기</button>
        </form>
      </Cond>
    </div>
  );
}

function Cond({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <details className="cond" name="cond">
      <summary aria-label={`${title}: ${label}, 바꾸기`}>{label}</summary>
      <div className="cond-pop" role="group" aria-label={`${title} 바꾸기`}>{children}</div>
    </details>
  );
}

function CondLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return <a className="chip" href={href} aria-current={on ? 'true' : undefined}>{children}</a>;
}

function MainPick({ item, quantity, packagingHref, excludeHref }: { item: ScoredProduct; quantity: number; packagingHref: string; excludeHref: string | null }) {
  const { product, attributes } = item;
  const image = product.detailImage ?? product.image;
  const subtotal = product.price * quantity;
  const shipping = shippingFee(subtotal);
  return (
    <article className="pick">
      <div className="pick-media">
        {image ? <img src={image} alt={product.name} /> : <div style={{ aspectRatio: '4 / 3' }} />}
        <SavePickButton variant="overlay" pick={{ productNo: product.productNo, name: product.name, price: product.price, image: product.image, url: product.url }} />
        <a className="seal" href="/formality" aria-label={`격식지수 ${Math.round(item.matchScore)}점, 격식지수 설명 보기`} style={{ textDecoration: 'none' }}>
          <div>
            <div className="seal-label">격식지수</div>
            <div className="seal-score num">{Math.round(item.matchScore)}</div>
          </div>
        </a>
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
          <span className="muted">{quantity.toLocaleString('ko-KR')}개 합계</span>
          <span>{won(subtotal)}</span>
          <span className="muted">배송비</span>
          <span>{shipping ? won(shipping) : '무료'}</span>
          <span className="muted" style={{ alignSelf: 'center' }}>예상 결제 금액</span>
          <span className="total">{won(subtotal + shipping)}</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>한 곳으로 받을 때 기준이에요. 산간·도서 지역은 배송비가 더 들 수 있어요.</p>

        <div className="reason">
          <div className="label">고른 이유</div>
          <p>{item.reason}</p>
          {attributes.tags.length > 0 && <div className="tags">{attributes.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>}
        </div>

        <details className="disclosure">
          <summary>격식지수 계산 보기</summary>
          <div style={{ marginTop: 12 }}><ScoreBreakdown item={item} /></div>
          <p className="small" style={{ margin: '12px 0 0' }}><a className="text-link" href="/formality">격식지수는 어떻게 매기나요?</a></p>
        </details>

        <div className="pick-actions">
          <a className="btn block" href={product.url} target="_blank" rel="noreferrer">이 상품 보러 가기</a>
          <a className="btn ghost block" href={packagingHref}>포장·스티커 꾸미기 <span className="small" style={{ fontWeight: 500, color: 'var(--muted)' }}>무료</span></a>
          {excludeHref && <a className="text-link small exclude-link" href={excludeHref}>이 상품은 빼고 다시 보기</a>}
        </div>
      </div>
    </article>
  );
}

function OtherPick({ item, packagingHref, excludeHref }: { item: ScoredProduct; packagingHref: string; excludeHref: string | null }) {
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
          <a className="btn ghost small" href={packagingHref}>포장 꾸미기</a>
          <SavePickButton variant="inline" pick={{ productNo: product.productNo, name: product.name, price: product.price, image: product.image, url: product.url }} />
          {excludeHref && <a className="btn ghost small" style={{ border: 'none' }} href={excludeHref} aria-label={`${product.name} 빼고 다시 보기`}>빼기</a>}
        </div>
      </div>
    </article>
  );
}

// 추천 상품을 한 표에 나란히 (휴대폰에서는 옆으로 밀어 본다)
function CompareTable({ items, quantity }: { items: ScoredProduct[]; quantity: number }) {
  const rows: [string, (x: ScoredProduct) => React.ReactNode][] = [
    ['격식 단계', (x) => x.tier],
    ['격식지수', (x) => <b>{Math.round(x.matchScore)}</b>],
    ['1개 가격', (x) => won(x.product.price)],
    [`${quantity.toLocaleString('ko-KR')}개 합계`, (x) => won(x.product.price * quantity)],
    ['산지', (x) => x.attributes.region],
    ['분류', (x) => x.attributes.category],
    ['지역 상생', (x) => (x.bonuses.some((b) => b.reason.startsWith('소멸위기지역')) ? '인구감소지역 상품' : '—')],
  ];
  return (
    <details className="disclosure compare">
      <summary>{items.length}개 상품 한눈에 비교</summary>
      <div className="compare-scroll">
        <table className="compare-table num">
          <thead>
            <tr>
              <td />
              {items.map((x) => <th key={x.product.productNo} scope="col">{x.product.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cell]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {items.map((x) => <td key={x.product.productNo}>{cell(x)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
