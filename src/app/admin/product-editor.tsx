'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { baseIndex } from '@/engine/formality.ts';
import type { Cafe24Product, EngineConfig, EventType, ProductAttributes, Relation } from '@/engine/types.ts';
import { saveAttributesAction, syncCafe24Action } from './actions.ts';

type Props = {
  products: Cafe24Product[];
  attributes: ProductAttributes[];
  config: EngineConfig;
  mallId: string;
  syncedAt: string | null;
};

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

// 서버와 브라우저의 로캘 차이로 hydration이 어긋나지 않도록 직접 포맷 (한국 시간)
function kstLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function emptyAttributes(config: EngineConfig, productNo: number): ProductAttributes {
  return {
    productNo,
    region: '국내',
    category: '',
    scores: Object.fromEntries(config.indicators.map((i) => [i.id, 5])),
    events: [],
    relations: [],
    excludedEvents: [],
    meanings: {},
    tags: [],
    story: '',
    reviewed: false,
  };
}

export function ProductEditor({ products, attributes, config, mallId, syncedAt }: Props) {
  const router = useRouter();
  const attrMap = useMemo(() => new Map(attributes.map((a) => [a.productNo, a])), [attributes]);
  const [selected, setSelected] = useState<number>(products[0]?.productNo ?? 0);
  const [draft, setDraft] = useState<ProductAttributes | null>(() =>
    products[0] ? structuredClone(attrMap.get(products[0].productNo) ?? emptyAttributes(config, products[0].productNo)) : null,
  );
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'no' | 'score' | 'review'>('no');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const product = products.find((p) => p.productNo === selected);
  const eventIds = Object.keys(config.events) as EventType[];
  const relationIds = Object.keys(config.relations) as Relation[];
  const reviewedCount = attributes.filter((a) => a.reviewed).length;

  const list = useMemo(() => {
    const q = query.trim();
    const rows = products.filter((p) => !q || p.name.includes(q) || (attrMap.get(p.productNo)?.category ?? '').includes(q));
    const score = (p: Cafe24Product) => {
      const a = attrMap.get(p.productNo);
      return a ? baseIndex(config, a) : -1;
    };
    return [...rows].sort((a, b) =>
      sort === 'score' ? score(b) - score(a)
        : sort === 'review' ? Number(attrMap.get(a.productNo)?.reviewed ?? false) - Number(attrMap.get(b.productNo)?.reviewed ?? false) || a.productNo - b.productNo
          : a.productNo - b.productNo,
    );
  }, [products, attrMap, query, sort, config]);

  function select(no: number) {
    if (dirty && !confirm('저장하지 않은 변경이 있습니다. 다른 상품으로 이동할까요?')) return;
    setSelected(no);
    setDraft(structuredClone(attrMap.get(no) ?? emptyAttributes(config, no)));
    setDirty(false);
    setMessage(null);
  }

  function update(patch: Partial<ProductAttributes>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setMessage(null);
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function save() {
    if (!draft) return;
    startTransition(async () => {
      await saveAttributesAction(draft);
      setDirty(false);
      setMessage('저장했습니다. 추천 결과에 바로 반영됩니다.');
      router.refresh();
    });
  }

  function sync() {
    startTransition(async () => {
      const r = await syncCafe24Action();
      setMessage(r.message);
      router.refresh();
    });
  }

  return (
    <div className="grid-2">
      {/* 상품 목록 */}
      <aside className="panel" style={{ padding: 14, position: 'sticky', top: 72 }}>
        <div className="spread">
          <b>상품 {products.length}개</b>
          <span className="small muted">검토 완료 {reviewedCount}/{attributes.length}</span>
        </div>
        <div className="small muted" style={{ marginTop: 2 }}>
          카페24 {mallId} · {syncedAt ? `${kstLabel(syncedAt)} 동기화` : '아직 동기화 안 함'}
        </div>
        <button className="btn ghost small" style={{ marginTop: 8 }} onClick={sync} disabled={pending}>카페24 상품 다시 가져오기</button>

        <input
          placeholder="상품명·카테고리 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: '100%', marginTop: 12, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}
        />
        <div className="chips" style={{ marginTop: 8 }}>
          {([['no', '번호순'], ['score', '기본 점수순'], ['review', '미검토 먼저']] as const).map(([k, label]) => (
            <button key={k} className="chip" style={{ padding: '5px 10px', fontSize: 12 }} aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>
          ))}
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', maxHeight: 'calc(100vh - 330px)', overflowY: 'auto' }}>
          {list.map((p) => {
            const a = attrMap.get(p.productNo);
            return (
              <li key={p.productNo}>
                <button
                  onClick={() => select(p.productNo)}
                  style={{
                    display: 'grid', gridTemplateColumns: '44px 1fr', gap: 10, width: '100%', textAlign: 'left',
                    padding: 8, border: 0, borderRadius: 10, cursor: 'pointer',
                    background: p.productNo === selected ? 'var(--green-weak)' : 'transparent',
                  }}
                >
                  {p.image ? <img src={p.image} alt="" width={44} height={44} style={{ borderRadius: 8, objectFit: 'cover' }} /> : <span />}
                  <span>
                    <span className="small" style={{ display: 'block', fontWeight: 600, lineHeight: 1.3 }}>{p.name}</span>
                    <span className="small muted">
                      #{p.productNo} · {won(p.price)} · {a ? `기본 ${baseIndex(config, a)}점` : '지표 미입력'}
                    </span>
                    {a?.reviewed ? <span className="pill" style={{ marginLeft: 6, fontSize: 11, padding: '1px 7px' }}>검토</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* 편집 */}
      {product && draft ? (
        <section className="panel">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              {product.image && <img src={product.image} alt="" width={84} height={84} style={{ borderRadius: 10, objectFit: 'cover' }} />}
              <div>
                <div className="small muted">카페24 상품번호 {product.productNo}</div>
                <h2>{product.name}</h2>
                <div className="small">
                  {won(product.price)} · {product.display && product.selling ? '판매 중' : '판매 안 함'}{product.soldOut ? ' · 품절' : ''} ·{' '}
                  <a href={product.url} target="_blank" rel="noreferrer">쇼핑몰에서 보기 ↗</a>
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="small muted">기본 격식 점수</div>
              <div className="serif" style={{ fontSize: 30, color: 'var(--green)' }}>{baseIndex(config, draft)}</div>
            </div>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <h3 style={{ marginBottom: 12 }}>격식지수 지표 <span className="small muted">(가안 {config.modelVersion})</span></h3>
              {config.indicators.map((ind) => (
                <div key={ind.id} className="field">
                  <div className="spread">
                    <label htmlFor={`s-${ind.id}`}>{ind.name}{ind.mode === 'target' && <span className="small muted"> · 상황별 목표 대비</span>}</label>
                    <b>{draft.scores[ind.id] ?? 0}</b>
                  </div>
                  <input
                    id={`s-${ind.id}`}
                    type="range" min={0} max={ind.max} step={1}
                    value={draft.scores[ind.id] ?? 0}
                    onChange={(e) => update({ scores: { ...draft.scores, [ind.id]: Number(e.target.value) } })}
                    style={{ accentColor: 'var(--green)' }}
                  />
                  <span className="small muted">{ind.description}</span>
                </div>
              ))}
            </div>

            <div>
              <h3 style={{ marginBottom: 12 }}>기본 정보</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field">
                  <label htmlFor="region">산지</label>
                  <input id="region" type="text" value={draft.region} onChange={(e) => update({ region: e.target.value })} />
                  {config.depopulationAreas.includes(draft.region) && <span className="small" style={{ color: 'var(--green)' }}>소멸위기지역 상생 가산 대상</span>}
                </div>
                <div className="field">
                  <label htmlFor="category">카테고리</label>
                  <input id="category" type="text" value={draft.category} onChange={(e) => update({ category: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="story">상품 스토리</label>
                <textarea id="story" value={draft.story} onChange={(e) => update({ story: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="tags">해시태그 (쉼표로 구분)</label>
                <input id="tags" type="text" value={draft.tags.join(', ')} onChange={(e) => update({ tags: e.target.value.split(',') })} />
              </div>

              <div className="field">
                <span className="field-label">어울리는 관계</span>
                <div className="chips">
                  {relationIds.map((r) => (
                    <button key={r} type="button" className="chip" style={{ padding: '6px 12px', fontSize: 13 }}
                      aria-pressed={draft.relations.includes(r)} onClick={() => update({ relations: toggle(draft.relations, r) })}>
                      {config.relations[r].name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <h3 style={{ margin: '12px 0 8px' }}>행사별 설정</h3>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 90, top: 0 }}>행사</th>
                <th style={{ width: 70, top: 0 }}>어울림</th>
                <th style={{ width: 70, top: 0 }}>제외</th>
                <th style={{ top: 0 }}>선물의 의미 / 제외 사유</th>
              </tr>
            </thead>
            <tbody>
              {eventIds.map((ev) => {
                const excluded = draft.excludedEvents.find((x) => x.event === ev);
                return (
                  <tr key={ev}>
                    <td>{config.events[ev].name}</td>
                    <td>
                      <input type="checkbox" checked={draft.events.includes(ev)} disabled={!!excluded}
                        onChange={() => update({ events: toggle(draft.events, ev) })} aria-label={`${config.events[ev].name} 어울림`} />
                    </td>
                    <td>
                      <input type="checkbox" checked={!!excluded} aria-label={`${config.events[ev].name} 제외`}
                        onChange={() => update(excluded
                          ? { excludedEvents: draft.excludedEvents.filter((x) => x.event !== ev) }
                          : { excludedEvents: [...draft.excludedEvents, { event: ev, reason: '' }], events: draft.events.filter((x) => x !== ev) })} />
                    </td>
                    <td>
                      {excluded ? (
                        <input type="text" placeholder="제외 사유 (예: 생물이라 대량 발송 부적합)" value={excluded.reason}
                          style={{ width: '100%', border: '1px solid var(--red)', borderRadius: 6, padding: '4px 8px' }}
                          onChange={(e) => update({ excludedEvents: draft.excludedEvents.map((x) => (x.event === ev ? { ...x, reason: e.target.value } : x)) })} />
                      ) : (
                        <input type="text" placeholder="이 행사에서 이 선물이 갖는 의미 (선택)" value={draft.meanings[ev] ?? ''}
                          style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px' }}
                          onChange={(e) => update({ meanings: { ...draft.meanings, [ev]: e.target.value } })} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {draft.excludedEvents.some((x) => !x.reason.trim()) && (
            <p className="small" style={{ color: 'var(--red)' }}>제외 사유를 적어야 저장 시 제외가 유지됩니다.</p>
          )}

          <div className="spread" style={{ marginTop: 20, position: 'sticky', bottom: 0, background: '#fff', paddingTop: 12 }}>
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={draft.reviewed} onChange={(e) => update({ reviewed: e.target.checked })} />
              검토 완료 (가안 → 확정)
            </label>
            <div className="row">
              {message && <span className="small" style={{ color: 'var(--green)' }}>{message}</span>}
              {dirty && <span className="small muted">저장하지 않은 변경</span>}
              <button className="btn" onClick={save} disabled={!dirty || pending}>{pending ? '저장 중…' : '저장하기'}</button>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">상품을 선택하세요.</section>
      )}
    </div>
  );
}
