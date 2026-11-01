import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { getCatalog, logRecommendation } from '@/data/repository.ts';
import { recommend } from '@/engine/recommend.ts';
import { eventIds, isEvent, isRelation, relationIds } from '@/engine/labels.ts';
import { isDepopulationArea } from '@/engine/formality.ts';
import type { EngineConfig, EventType, Relation, ScoredProduct } from '@/engine/types.ts';
import { BUDGET_STEPS, MAX_EXCLUDE, MAX_QTY, budgetChipText, budgetText, parseResultQuery, resultHref, type ResultQuery, won } from '@/lib/result-query.ts';
import { CloseCondOnOutside, FeedbackBox, RememberQuery } from './client-bits.tsx';
import { MainPick, OtherPick } from './pick-cards.tsx';
import { ShareButton } from './share-button.tsx';
import { CreateApprovalButton } from './create-approval-button.tsx';
import { isApprovalEnabled } from '@/approval/guard.ts';

export const dynamic = 'force-dynamic';

// 링크 미리보기·검색 수집기 (카카오톡 미리보기는 kakaotalk-scrap, 네이버 Yeti, 다음 Daumoa). 카카오톡 안 브라우저(KAKAOTALK)는 사람이다
const isBot = (ua: string | null) => !ua || /bot|crawl|spider|slurp|scrap|facebookexternalhit|daumoa|yeti|whatsapp|preview/i.test(ua);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 카카오톡 등으로 공유할 때 보이는 제목·그림 (그림은 /og/result가 같은 조건으로 그린다)
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const q = parseResultQuery(await searchParams);
  const { config } = await getCatalog();
  const { event, relation } = q;
  if (!isEvent(config, event) || !isRelation(config, relation)) return {};
  const title = `${config.events[event].name} 자리에 맞춘 답례품 | 온답`;
  const description = `${config.relations[relation].name}께 드릴 답례품을 행사와 예산에 맞춰 골랐습니다.`;
  const image = { url: `/og${resultHref(q)}`, width: 1200, height: 630, alt: title };
  return { title, description, openGraph: { title, description, images: [image], type: 'website', locale: 'ko_KR' }, twitter: { card: 'summary_large_image', title, description, images: [image.url] } };
}

function TopBar({ back = '/' }: { back?: string }) {
  return (
    <header className="topbar">
      <a className="back" href={back}>‹ 조건 바꾸기</a>
      <a className="brand" href="/" style={{ fontSize: 18 }}><span className="brand-mark" aria-hidden />온답</a>
      <span style={{ width: 72 }} />
    </header>
  );
}

export default async function ResultPage({ searchParams }: { searchParams: SearchParams }) {
  const q = parseResultQuery(await searchParams);
  const catalog = await getCatalog();
  const { config } = catalog;

  const { event, relation } = q;
  if (!isEvent(config, event) || !isRelation(config, relation)) {
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
  const userAgent = (await headers()).get('user-agent');
  const mobile = /Mobi|Android|iPhone|iPad/i.test(userAgent ?? '');
  // '빼고 다시'는 같은 고객의 다시 보기, 미리보기 수집 봇(카카오톡·검색엔진 등)은 사람이 아니라 세지 않는다
  if (q.exclude.length === 0 && !isBot(userAgent)) {
    // cookies()는 after 밖에서 읽는다. 응답 후에도 Next가 저장 완료를 기다린다.
    const { createClient } = await import('@/lib/supabase/server.ts');
    const { dataSource } = await import('@/lib/supabase/env.ts');
    const db = dataSource() === 'supabase' ? await createClient() : undefined;
    after(() => logRecommendation(result, catalog.formalityEvidence ? 'v2' : config.modelVersion, db));
  }
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

  return (
    <main className={calm ? 'mobile mood-calm' : 'mobile'}>
      <TopBar back={`/${resultHref(q, { exclude: [] }).slice('/result'.length)}`} />
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
        {q.exclude.length > 0 && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--paper-deep)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--ink-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>제외해 둔 상품이 {q.exclude.length}개 있습니다.</span>
            <a className="text-link" style={{ fontWeight: 600 }} href={resultHref(q, { exclude: [] })}>
              제외 상품 모두 되돌리기
            </a>
          </div>
        )}
        {result.notice && (
          <div style={{ marginTop: 10, padding: '10px 14px', background: '#FEF2F2', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--danger)', lineHeight: 1.45 }}>
            ※ {result.notice}
          </div>
        )}
      </section>

      {main ? (
        <MainPick item={main} quantity={quantity} mobile={mobile} packagingHref={packagingHref(main.product.productNo)} excludeHref={excludeHref(main.product.productNo)} />
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
          <h2 className="alt-title" style={{ fontSize: 18, fontWeight: 700, margin: '36px 0 6px' }}>
            함께 비교할 만한 대안 추천
          </h2>
          <p className="small muted" style={{ margin: '0 0 14px' }}>
            받는 분의 취향이나 예산에 맞춰 다른 선택지도 살펴보세요.
          </p>
          <div className="alt-list">
            {others.map((x, idx) => (
              <OtherPick
                key={x.product.productNo}
                rank={idx + 2}
                item={x}
                quantity={quantity}
                mobile={mobile}
                packagingHref={packagingHref(x.product.productNo)}
                excludeHref={excludeHref(x.product.productNo)}
              />
            ))}
          </div>
        </section>
      )}

      {result.results.length > 1 && <CompareTable items={result.results} quantity={quantity} config={config} />}

      {/* 부가 기능: 결과 공유 및 (로컬 환경일 때) 결재 문서 작성 */}
      {main && (
        <section
          style={{
            marginTop: 24,
            marginBottom: 20,
            padding: '14px 16px',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>추천 결과 공유</span>
            <ShareButton title={`${eventName} 답례품`} label="결과 공유" />
          </div>

          {isApprovalEnabled() && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: 0 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                    추천 상품 비교·결재 문서 만들기
                  </span>
                </div>
                <CreateApprovalButton
                  className="btn ghost small"
                  query={q}
                  candidates={result.results.map((r) => ({ productNo: r.product.productNo, price: r.product.price }))}
                  label="결재 문서(품의서) 작성"
                />
              </div>
            </>
          )}
        </section>
      )}

      {main && <FeedbackBox query={q} productNos={result.results.map((x) => x.product.productNo)} />}
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
        {BUDGET_STEPS.map((b) => (
          <CondLink
            key={String(b)}
            href={resultHref(q, { budget: b, budgetMode: 'per_item', totalBudget: null, ...reset })}
            on={b === q.budget && q.budgetMode !== 'total'}
          >
            {budgetText(b)}
          </CondLink>
        ))}
      </Cond>
      <Cond label={`${q.qty.toLocaleString('ko-KR')}개`} title="수량">
        <form action="/result" className="cond-qty">
          <input type="hidden" name="event" value={q.event} />
          <input type="hidden" name="relation" value={q.relation} />
          {q.budget !== null && <input type="hidden" name="budget" value={q.budget} />}
          {q.exclude.length > 0 && <input type="hidden" name="exclude" value={q.exclude.join(',')} />}
          {q.budgetMode && <input type="hidden" name="budgetMode" value={q.budgetMode} />}
          {q.totalBudget !== undefined && q.totalBudget !== null && <input type="hidden" name="totalBudget" value={q.totalBudget} />}
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

// 추천 상품을 한 표에 나란히 (휴대폰에서는 옆으로 밀어 본다)
function CompareTable({ items, quantity, config }: { items: ScoredProduct[]; quantity: number; config: EngineConfig }) {
  const rows: [string, (x: ScoredProduct, idx: number) => React.ReactNode][] = [
    ['추천 순위', (_, idx) => <b>{idx === 0 ? '1위 (대표)' : `${idx + 1}위 대안`}</b>],
    ['격식 단계', (x) => x.tier],
    ['1개 단가', (x) => won(x.product.price)],
    [`${quantity.toLocaleString('ko-KR')}개 상품 합계`, (x) => <b>{won(x.product.price * quantity)}</b>],
    ['산지', (x) => x.attributes.region],
    ['분류', (x) => x.attributes.category],
    ['지역 상생', (x) => (isDepopulationArea(config, x.attributes.region) ? '인구감소지역 상품' : '—')],
  ];
  return (
    <details className="disclosure compare">
      <summary style={{ fontSize: 15, fontWeight: 600 }}>{items.length}개 추천 상품 한눈에 비교하기</summary>
      <div className="compare-scroll">
        <table className="compare-table num">
          <thead>
            <tr>
              <td />
              {items.map((x, idx) => (
                <th key={x.product.productNo} scope="col">
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--pine)', fontWeight: 700, marginBottom: 2 }}>
                    {idx === 0 ? '1위 추천' : `${idx + 1}위 대안`}
                  </span>
                  {x.product.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cell]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {items.map((x, idx) => <td key={x.product.productNo}>{cell(x, idx)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8, textAlign: 'right', fontSize: 12 }}>
        ※ 모바일에서는 표를 좌우로 스크롤하여 3개 상품을 비교할 수 있습니다.
      </p>
    </details>
  );
}
