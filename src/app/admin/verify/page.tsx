import { getCatalog, getExpectations } from '@/data/repository.ts';
import { recommend } from '@/engine/recommend.ts';
import { scoreForSituation, baseIndex } from '@/engine/formality.ts';
import type { Catalog, EventType, Relation } from '@/engine/types.ts';
import { ScoreBreakdown } from '../../components/score-breakdown.tsx';
import { ExpectationPicker } from './expectation-picker.tsx';
import { eventIds as orderedEvents, relationIds as orderedRelations } from '@/engine/labels.ts';

export const dynamic = 'force-dynamic';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const BUDGETS = [30000, 60000, 100000, 200000];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const catalog = await getCatalog();
  const { config } = catalog;
  const expectations = await getExpectations();
  const budget = Number(sp.budget ?? 60000) || 60000;
  const eventIds = orderedEvents(config);
  const relationIds = orderedRelations(config);
  const selEvent = config.events[String(sp.event) as EventType] ? (String(sp.event) as EventType) : null;
  const selRelation = config.relations[String(sp.relation) as Relation] ? (String(sp.relation) as Relation) : null;

  const grid = eventIds.map((event) =>
    relationIds.map((relation) => ({ event, relation, result: recommend(catalog, { event, relation, budgetMax: budget }) })),
  );
  const cells = grid.flat();
  const firsts = new Set(cells.map((c) => c.result.results[0]?.product.productNo).filter(Boolean));
  const appeared = new Set(cells.flatMap((c) => c.result.results.map((x) => x.product.productNo)));
  const judged = cells.filter((c) => expectations[`${c.event}:${c.relation}`] !== undefined);
  const hits = judged.filter((c) => c.result.results[0]?.product.productNo === expectations[`${c.event}:${c.relation}`]);
  const top3Hits = judged.filter((c) => c.result.results.some((x) => x.product.productNo === expectations[`${c.event}:${c.relation}`]));

  const href = (q: Record<string, string | number>) => `/admin/verify?${new URLSearchParams(Object.entries({ budget, ...q }).map(([k, v]) => [k, String(v)]))}`;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <header className="page-head" style={{ marginBottom: 0 }}>
        <h1>알고리즘 검증</h1>
        <p>행사 8가지와 관계 4가지를 모두 조합해 추천이 자리마다 알맞게 달라지는지 확인합니다.</p>
      </header>
      <section className="panel">
        <div className="spread">
          <div>
            <h2>32개 시나리오 결과 <span className="small muted">격식지수 가안 {config.modelVersion}</span></h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>행사 8 × 관계 4 조합을 같은 예산으로 돌린 1~3위입니다. 칸을 누르면 전체 순위와 점수 내역을 봅니다.</p>
          </div>
          <div className="chips">
            {BUDGETS.map((b) => (
              <a key={b} className="chip" style={{ textDecoration: 'none' }} aria-pressed={b === budget}
                href={href(selEvent && selRelation ? { budget: b, event: selEvent, relation: selRelation } : { budget: b })}>
                1개 {won(b)} 이하
              </a>
            ))}
          </div>
        </div>

        <div className="row" style={{ marginTop: 14, gap: 24 }}>
          <Metric label="1위 상품 종류" value={`${firsts.size}종`} hint="높을수록 상황별로 다른 상품을 추천" />
          <Metric label="1~3위에 나온 상품" value={`${appeared.size} / ${catalog.products.length}종`} hint="한 번도 추천되지 않는 상품 확인용" />
          <Metric label="기대 정답 일치 (1위)" value={judged.length ? `${hits.length} / ${judged.length}` : '—'} hint="시나리오 상세에서 정답을 지정" />
          <Metric label="기대 정답 일치 (3위 안)" value={judged.length ? `${top3Hits.length} / ${judged.length}` : '—'} hint="" />
        </div>

        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table className="data" style={{ tableLayout: 'fixed', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 90, top: 0 }}>행사 \ 관계</th>
                {relationIds.map((r) => <th key={r} style={{ top: 0 }}>{config.relations[r].name}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row[0].event}>
                  <td><b>{config.events[row[0].event].name}</b></td>
                  {row.map(({ event, relation, result }) => {
                    const key = `${event}:${relation}`;
                    const expected = expectations[key];
                    const first = result.results[0]?.product.productNo;
                    const selected = event === selEvent && relation === selRelation;
                    const tone = expected === undefined ? undefined : expected === first ? 'var(--green-weak)' : 'var(--red-weak)';
                    return (
                      <td key={relation} style={{ padding: 0, background: tone, outline: selected ? '2px solid var(--green)' : undefined }}>
                        <a href={href({ event, relation })} style={{ display: 'block', padding: '8px 10px', textDecoration: 'none' }}>
                          {result.results.map((x, i) => (
                            <div key={x.product.productNo} className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: i === 0 ? 600 : 400 }}>
                              {i + 1}. {x.product.name} <span className="muted">{x.matchScore}</span>
                            </div>
                          ))}
                          {result.notice && <div className="small" style={{ color: 'var(--red)' }}>예산 확대</div>}
                        </a>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">초록 칸: 1위가 기대 정답과 일치 · 빨간 칸: 불일치</p>
      </section>

      {selEvent && selRelation && (
        <Detail catalog={catalog} catalogKey={`${selEvent}:${selRelation}`} event={selEvent} relation={selRelation} budget={budget} expected={expectations[`${selEvent}:${selRelation}`] ?? null} />
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <div className="serif" style={{ fontSize: 22, color: 'var(--green)' }}>{value}</div>
      {hint && <div className="small muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

function Detail({ catalog, catalogKey, event, relation, budget, expected }: { catalog: Catalog; catalogKey: string; event: EventType; relation: Relation; budget: number; expected: number | null }) {
  const { config } = catalog;
  const result = recommend(catalog, { event, relation, budgetMax: budget });
  const picked = new Set(result.results.map((x) => x.product.productNo));
  const excludedNos = new Set(result.excluded.map((x) => x.productNo));

  // 제외되지 않은 모든 상품의 점수 (순위표)
  const attrMap = new Map(catalog.attributes.map((a) => [a.productNo, a]));
  const ranked = catalog.products
    .filter((p) => !excludedNos.has(p.productNo) && attrMap.has(p.productNo))
    .map((p) => {
      const a = attrMap.get(p.productNo)!;
      return { product: p, attrs: a, base: baseIndex(config, a), ...scoreForSituation(config, a, event, relation) };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  return (
    <section className="panel">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2>{config.events[event].name} / {config.relations[relation].name} <span className="small muted">1개 {won(budget)} 이하</span></h2>
          {result.notice && <p className="small" style={{ color: 'var(--red)', margin: '4px 0 0' }}>{result.notice}</p>}
        </div>
        <ExpectationPicker
          scenarioKey={catalogKey}
          expected={expected}
          options={ranked.map((r) => ({ productNo: r.product.productNo, name: r.product.name }))}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${result.results.length || 1}, 1fr)`, gap: 14, marginTop: 14 }}>
        {result.results.map((x, i) => (
          <div key={x.product.productNo} className="card" style={{ padding: 14, boxShadow: 'none' }}>
            <div className="spread"><b>{i + 1}위</b><span className="pill gold">{x.tier}</span></div>
            <div style={{ fontWeight: 600, margin: '6px 0' }}>{x.product.name}</div>
            <p className="small muted" style={{ margin: '0 0 10px' }}>{x.reason}</p>
            <ScoreBreakdown item={x} />
          </div>
        ))}
      </div>

      <h3 style={{ margin: '20px 0 8px' }}>전체 순위 ({ranked.length}개, 다양성 규칙 적용 전)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ top: 0 }}>#</th>
              <th style={{ top: 0 }}>상품</th>
              <th style={{ top: 0 }} className="right">격식지수</th>
              <th style={{ top: 0 }} className="right">지표</th>
              {config.indicators.map((i) => <th key={i.id} style={{ top: 0 }} className="right">{i.name}</th>)}
              <th style={{ top: 0 }} className="right">보너스</th>
              <th style={{ top: 0 }}>카테고리</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={r.product.productNo} style={{ background: picked.has(r.product.productNo) ? 'var(--green-weak)' : undefined }}>
                <td>{i + 1}</td>
                <td>
                  {r.product.name}
                  <div className="small muted">{won(r.product.price)}{expected === r.product.productNo ? ' · 기대 정답' : ''}</div>
                </td>
                <td className="right"><b>{r.matchScore}</b></td>
                <td className="right">{r.formalityIndex}</td>
                {r.indicators.map((c) => <td key={c.id} className="right" title={`${c.score}/10 × ${c.weight}`}>{c.points}</td>)}
                <td className="right" title={r.bonuses.map((b) => `${b.reason} ${b.points}`).join('\n')}>
                  {r.bonuses.reduce((s, b) => s + b.points, 0)}
                </td>
                <td className="small">{r.attrs.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary className="small muted" style={{ cursor: 'pointer' }}>제외된 상품 {result.excluded.length}개</summary>
        <ul className="small">
          {result.excluded.map((x) => <li key={x.productNo}>{x.name} — {x.reason}</li>)}
        </ul>
      </details>
    </section>
  );
}
