'use client';

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { baseIndex } from '@/engine/formality.ts';
import { changeImpact, standing, withAttributes, type Standing } from '@/engine/impact.ts';
import { filterAndScore } from '@/engine/recommend.ts';
import type { Cafe24Product, Catalog, EngineConfig, EventType, Indicator, ProductAttributes, Relation } from '@/engine/types.ts';
import { attributeDiff } from '@/data/attribute-diff.ts';
import { emptyAttributes } from '@/data/attributes-csv.ts';
import type { AttributeChange } from '@/data/repository.ts';
import { getAttributeHistoryAction, saveAttributesAction, suggestScoresAction, syncCafe24Action, type SyncReport } from './actions.ts';
import { applySuggestion, type AiSuggestion } from '@/ai/suggest.ts';
import { AiSuggestionPanel } from './ai-suggestion-panel.tsx';
import { MainPick } from '../result/pick-cards.tsx';
import { isTyping } from '@/lib/device.ts';
import { kstLabel } from '@/lib/kst.ts';
import { eventIds as orderedEvents, relationIds as orderedRelations } from '@/engine/labels.ts';

type Props = {
  products: Cafe24Product[];
  attributes: ProductAttributes[];
  config: EngineConfig;
  mallId: string;
  syncedAt: string | null;
  initialProduct?: number | null; // AI 일괄 제안 등에서 특정 상품을 열 때 (/admin?product=27)
};

type Tab = 'edit' | 'diagnose' | 'preview' | 'history';
const TABS: [Tab, string][] = [['edit', '지표 입력'], ['diagnose', '추천 진단'], ['preview', '고객 카드 미리보기'], ['history', '변경 이력']];
// 알고리즘 검증 화면과 같은 예산 (undefined = 예산 상관없음)
const BUDGETS: (number | undefined)[] = [30000, 60000, 100000, 200000, undefined];

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const budgetLabel = (b: number | undefined) => (b === undefined ? '예산 상관없음' : `1개 ${(b / 10000).toLocaleString('ko-KR')}만 원 이하`);
// 점수 단축키(숫자·↑↓·Delete)는 점수 막대에 포커스가 있을 때만: 글자 입력이나 화면 스크롤을 가로채지 않게
const onSlider = (t: EventTarget | null) => t instanceof HTMLInputElement && t.type === 'range' && t.id.startsWith('s-');

const SHORTCUTS: [string, string][] = [
  ['1 ~ 9, 0', '점수 막대를 누른 뒤 그 지표 점수 (0은 10점, Delete는 0점)'],
  ['↑ ↓', '점수 막대에서 위·아래 지표로'],
  ['Ctrl + S', '저장'],
  ['Ctrl + Enter', '저장하고 다음 상품'],
  ['?', '이 안내 열고 닫기'],
];

export function ProductEditor({ products, attributes, config, mallId, syncedAt, initialProduct }: Props) {
  const router = useRouter();
  const catalog: Catalog = useMemo(() => ({ products, attributes, config }), [products, attributes, config]);
  // 방금 저장한 값: 서버 새로고침(router.refresh)이 오기 전에 그 상품을 다시 열어도 옛 값이 나오지 않게
  const [justSaved, setJustSaved] = useState<Map<number, ProductAttributes>>(new Map());
  useEffect(() => setJustSaved(new Map()), [attributes]);
  const attrMap = useMemo(() => new Map([...attributes.map((a) => [a.productNo, a] as const), ...justSaved]), [attributes, justSaved]);
  const first = products.find((p) => p.productNo === initialProduct) ?? products[0];
  const [selected, setSelected] = useState<number>(first?.productNo ?? 0);
  const [draft, setDraft] = useState<ProductAttributes | null>(() =>
    first ? structuredClone(attrMap.get(first.productNo) ?? emptyAttributes(config, first.productNo)) : null,
  );
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'no' | 'score' | 'review'>('no');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPending, startAi] = useTransition();
  const [tab, setTab] = useState<Tab>('edit');
  const [budget, setBudget] = useState<number | undefined>(60000);
  const [focusIdx, setFocusIdx] = useState(0);
  const [help, setHelp] = useState(false);
  const [showImpact, setShowImpact] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [historyKey, setHistoryKey] = useState(0); // 저장하면 이력을 다시 읽는다

  const product = products.find((p) => p.productNo === selected);
  const eventIds = orderedEvents(config);
  const relationIds = orderedRelations(config);
  const reviewedCount = attributes.filter((a) => a.reviewed).length;
  // 무거운 계산(32가지 상황 × 2)은 막대를 끄는 동안 한 박자 늦게
  const deferredDraft = useDeferredValue(draft);
  const impact = useMemo(
    () => (deferredDraft && dirty ? changeImpact(catalog, deferredDraft, budget) : []),
    [catalog, deferredDraft, dirty, budget],
  );

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

  // 같은 점수를 받은 다른 상품 (점수를 매길 때 기준 삼기). 검토 완료한 상품을 먼저
  const sameScore = useMemo(() => {
    const names = new Map(products.map((p) => [p.productNo, p.name]));
    const m = new Map<string, string[]>();
    for (const a of [...attributes].sort((x, y) => Number(y.reviewed) - Number(x.reviewed))) {
      for (const ind of config.indicators) {
        const k = `${ind.id}:${a.scores[ind.id]}`;
        const name = names.get(a.productNo);
        if (name) m.set(k, [...(m.get(k) ?? []), `${a.productNo}|${name}`]);
      }
    }
    return m;
  }, [attributes, products, config]);

  function open(no: number) {
    setSelected(no);
    setDraft(structuredClone(attrMap.get(no) ?? emptyAttributes(config, no)));
    setDirty(false);
    setMessage(null);
    setSuggestion(null);
    setAiError(null);
    setShowImpact(false);
  }

  function select(no: number) {
    if (dirty && !confirm('저장하지 않은 변경이 있습니다. 다른 상품으로 이동할까요?')) return;
    open(no);
  }

  function askAi() {
    if (!draft) return;
    setAiError(null);
    startAi(async () => {
      const r = await suggestScoresAction(draft.productNo, {
        region: draft.region,
        category: draft.category,
        story: draft.story,
        tags: draft.tags,
      });
      if (r.ok) setSuggestion(r.suggestion);
      else setAiError(r.message);
    });
  }

  function update(patch: Partial<ProductAttributes>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setMessage(null);
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function save(thenNext = false) {
    if (!draft || pending) return;
    startTransition(async () => {
      try {
        await saveAttributesAction(draft);
      } catch (e) {
        setMessage(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      setDirty(false);
      setJustSaved((m) => new Map(m).set(draft.productNo, draft));
      setHistoryKey((k) => k + 1);
      router.refresh();
      const i = list.findIndex((p) => p.productNo === draft.productNo);
      const next = thenNext ? list[i + 1] : undefined;
      if (next) open(next.productNo);
      else setMessage(thenNext ? '저장했습니다. 목록의 마지막 상품입니다.' : '저장했습니다. 추천 결과에 바로 반영됩니다.');
    });
  }

  function sync() {
    startTransition(async () => {
      const r = await syncCafe24Action();
      setMessage(r.message);
      setReport(r.ok ? r.report : null);
      router.refresh();
    });
  }

  // 키보드로 빠르게 입력: 숫자로 점수, ↑↓로 지표 이동, Ctrl+S 저장, Ctrl+Enter 저장 후 다음 상품
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) {
        e.preventDefault();
        if (dirty) save(e.key === 'Enter');
        else if (e.key === 'Enter') { const i = list.findIndex((p) => p.productNo === selected); if (list[i + 1]) select(list[i + 1].productNo); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || tab !== 'edit' || !draft) return;
      if (e.key === '?' && !isTyping(e.target)) return setHelp((h) => !h);
      if (!onSlider(e.target)) return;
      const ind = config.indicators[focusIdx];
      const focusSlider = (i: number) => {
        const next = Math.max(0, Math.min(config.indicators.length - 1, i));
        setFocusIdx(next);
        document.getElementById(`s-${config.indicators[next].id}`)?.focus();
      };
      if (e.key === 'ArrowDown') { e.preventDefault(); focusSlider(focusIdx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusSlider(focusIdx - 1); }
      else if (ind && /^[0-9]$/.test(e.key)) { e.preventDefault(); update({ scores: { ...draft.scores, [ind.id]: Math.min(ind.max, e.key === '0' ? 10 : Number(e.key)) } }); }
      else if (ind && e.key === 'Delete') { e.preventDefault(); update({ scores: { ...draft.scores, [ind.id]: 0 } }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

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
        {report && <SyncReportView report={report} onOpen={select} onClose={() => setReport(null)} />}

        <input
          placeholder="상품명·카테고리 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="상품 검색"
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
                  aria-current={p.productNo === selected ? 'true' : undefined}
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

          <nav className="admin-tabs" style={{ margin: '16px 0 18px' }} aria-label="상품 편집 메뉴">
            {TABS.map(([id, label]) => (
              <a key={id} href={`#${id}`} aria-selected={tab === id} onClick={(e) => { e.preventDefault(); setTab(id); }}>{label}</a>
            ))}
            <span style={{ flex: 1 }} />
            {tab === 'edit' && <button type="button" className="btn ghost small" style={{ alignSelf: 'center' }} onClick={() => setHelp((h) => !h)} aria-expanded={help}>단축키 ?</button>}
          </nav>

          {help && tab === 'edit' && (
            <div className="shortcut-help" role="dialog" aria-label="단축키">
              <dl>{SHORTCUTS.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
            </div>
          )}

          {(tab === 'diagnose' || tab === 'preview') && dirty && <p className="notice" style={{ margin: '0 0 12px' }}>저장하지 않은 지금 입력값으로 계산합니다.</p>}

          {tab === 'diagnose' && (
            <Diagnose catalog={withAttributes(catalog, draft)} productNo={draft.productNo} budget={budget} onBudget={setBudget} />
          )}
          {tab === 'preview' && <CardPreview catalog={withAttributes(catalog, draft)} productNo={draft.productNo} />}
          {tab === 'history' && (
            <History
              key={`${draft.productNo}-${historyKey}`} productNo={draft.productNo} config={config}
              onLoad={(a) => { update(structuredClone(a)); setTab('edit'); setMessage('그때 값을 불러왔습니다. 확인한 뒤 저장하면 되돌려집니다.'); }}
            />
          )}

          {tab === 'edit' && (
            <>
              <div className="spread" style={{ marginBottom: 12 }}>
                <span className="small muted">
                  상품명·가격·스토리를 바탕으로 AI가 지표 점수와 어울리는 상황을 제안합니다. 스토리를 먼저 채우면 더 정확합니다.
                </span>
                <button type="button" className="btn small" onClick={askAi} disabled={aiPending}>
                  {aiPending ? 'AI가 검토하는 중…' : 'AI 점수 제안'}
                </button>
              </div>
              {aiError && <p className="small" style={{ color: 'var(--red)', marginTop: 0 }}>{aiError}</p>}
              {suggestion && (
                <AiSuggestionPanel
                  config={config}
                  draft={draft}
                  suggestion={suggestion}
                  onApplyScore={(id, value) => update({ scores: { ...draft.scores, [id]: value } })}
                  onApplyScores={() => update({ scores: { ...draft.scores, ...suggestion.scores } })}
                  onApplyAll={() => {
                    const next = applySuggestion(draft, suggestion);
                    update(next);
                    setSuggestion(null);
                    setMessage('AI 제안을 적용했습니다. 확인 후 저장하세요.');
                  }}
                  onClose={() => setSuggestion(null)}
                />
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div>
                  <h3 style={{ marginBottom: 12 }}>격식지수 지표 <span className="small muted">(가안 {config.modelVersion})</span></h3>
                  {config.indicators.map((ind, i) => (
                    <div key={ind.id} className={`field score-field${i === focusIdx ? ' focused' : ''}`}>
                      <div className="spread">
                        <label htmlFor={`s-${ind.id}`}>{ind.name}{ind.mode === 'target' && <span className="small muted"> · 상황별 목표 대비</span>}</label>
                        <b>{draft.scores[ind.id] ?? 0}</b>
                      </div>
                      <input
                        id={`s-${ind.id}`}
                        type="range" min={0} max={ind.max} step={1}
                        value={draft.scores[ind.id] ?? 0}
                        onFocus={() => setFocusIdx(i)}
                        onChange={(e) => update({ scores: { ...draft.scores, [ind.id]: Number(e.target.value) } })}
                        style={{ accentColor: 'var(--green)' }}
                      />
                      <span className="small muted">{ind.description}</span>
                      <ScoreHint ind={ind} value={draft.scores[ind.id] ?? 0} same={sameScore.get(`${ind.id}:${draft.scores[ind.id] ?? 0}`)} self={draft.productNo} onOpen={select} />
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
            </>
          )}

          <div className="save-bar">
            {dirty && (
              <ImpactSummary
                rows={impact} config={config} products={products} productNo={draft.productNo} budget={budget}
                open={showImpact} onToggle={() => setShowImpact((o) => !o)} stale={deferredDraft !== draft}
              />
            )}
            <div className="spread">
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={draft.reviewed} onChange={(e) => update({ reviewed: e.target.checked })} />
                검토 완료 (가안 → 확정)
              </label>
              <div className="row">
                {message && <span className="small" role="status" style={{ color: message.startsWith('저장하지 못') ? 'var(--red)' : 'var(--green)' }}>{message}</span>}
                {dirty && <span className="small muted">저장하지 않은 변경</span>}
                <button className="btn" onClick={() => save()} disabled={!dirty || pending}>{pending ? '저장 중…' : '저장하기'}</button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">상품을 선택하세요.</section>
      )}
    </div>
  );
}

// 점수 기준: 관리자가 적은 예시 + 같은 점수를 받은 다른 상품
function ScoreHint({ ind, value, same, self, onOpen }: { ind: Indicator; value: number; same?: string[]; self: number; onOpen(no: number): void }) {
  const band = value >= 8 ? 'high' : value >= 4 ? 'mid' : 'low';
  const example = ind.examples?.[band];
  const others = (same ?? []).map((s) => s.split('|')).filter(([no]) => Number(no) !== self).slice(0, 3);
  if (!example && others.length === 0) return null;
  return (
    <div className="score-hint">
      {example && <div><b>{band === 'high' ? '8~10점' : band === 'mid' ? '4~7점' : '0~3점'} 예:</b> {example}</div>}
      {others.length > 0 && (
        <div>
          같은 {value}점: {others.map(([no, name], i) => (
            <span key={no}>{i > 0 && ', '}<button type="button" className="link-btn" onClick={() => onOpen(Number(no))}>{name}</button></span>
          ))}
        </div>
      )}
    </div>
  );
}

// 저장하면 무엇이 달라지나: 1위가 바뀌는 상황, 이 상품이 추천에 들어가거나 빠지는 상황
function ImpactSummary({ rows, config, products, productNo, budget, open, onToggle, stale }: {
  rows: ReturnType<typeof changeImpact>; config: EngineConfig; products: Cafe24Product[]; productNo: number; budget: number | undefined;
  open: boolean; onToggle(): void; stale: boolean;
}) {
  const name = (no: number | undefined) => (no === undefined ? '없음' : (products.find((p) => p.productNo === no)?.name ?? `#${no}`));
  const label = (r: { event: EventType; relation: Relation }) => `${config.events[r.event].name}·${config.relations[r.relation].name}`;
  const firsts = rows.filter((r) => r.firstChanged);
  const entered = rows.filter((r) => r.entered).length;
  const left = rows.filter((r) => r.left).length;
  return (
    <div className="impact" aria-live="polite" style={{ opacity: stale ? 0.6 : 1 }}>
      {rows.length === 0 ? (
        <span className="small muted">저장해도 32가지 상황의 추천 결과({budgetLabel(budget)})는 그대로입니다.</span>
      ) : (
        <>
          <span className="small">
            저장하면 <b>{budgetLabel(budget)}</b> 기준 32가지 상황 중
            {firsts.length > 0 && <> 1위가 바뀌는 상황 <b>{firsts.length}건</b>{firsts.length ? `(${firsts.slice(0, 2).map(label).join(', ')}${firsts.length > 2 ? ' 외' : ''})` : ''}</>}
            {entered > 0 && <> · 이 상품이 새로 추천되는 상황 <b>{entered}건</b></>}
            {left > 0 && <> · 추천에서 빠지는 상황 <b>{left}건</b></>}
          </span>{' '}
          <button type="button" className="link-btn small" onClick={onToggle} aria-expanded={open}>{open ? '접기' : '자세히'}</button>
          {open && (
            <ul className="impact-list">
              {rows.map((r) => (
                <li key={`${r.event}:${r.relation}`}>
                  <b>{label(r)}</b>{' '}
                  {r.firstChanged && <>1위 {name(r.before[0])} → <b>{name(r.after[0])}</b></>}
                  {r.entered && <span className="pill" style={{ marginLeft: 6 }}>추천에 들어감 · {r.after.indexOf(productNo) + 1}위</span>}
                  {r.left && <span className="pill red" style={{ marginLeft: 6 }}>추천에서 빠짐</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// 이 상품은 왜 추천 안 되나: 상황마다 순위와 빠진 이유
function Diagnose({ catalog, productNo, budget, onBudget }: { catalog: Catalog; productNo: number; budget: number | undefined; onBudget(b: number | undefined): void }) {
  const { config } = catalog;
  const deferred = useDeferredValue(catalog);
  const rows = useMemo(
    () => orderedEvents(config).map((event) => ({ event, cells: orderedRelations(config).map((relation) => ({ relation, s: standing(deferred, productNo, { event, relation }, budget) })) })),
    [deferred, productNo, budget, config],
  );
  const cell = (s: Standing) => {
    if (s.kind === 'shown') return <span className="stand shown">{s.rank}위로 추천</span>;
    if (s.kind === 'diversity') return <span className="stand diversity">점수 {s.rank}위 · 같은 분류 상품이 먼저 들어가 빠짐</span>;
    if (s.kind === 'below') return <span className="stand below">{s.rank}위 · 마지막 추천과 {s.gap}점 차</span>;
    return <span className="stand excluded">{s.reason}</span>;
  };
  return (
    <div>
      <div className="spread" style={{ marginBottom: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>행사 × 관계 32가지 상황에서 이 상품이 몇 위인지, 추천에 안 나오면 왜 빠지는지 봅니다.</p>
        <div className="chips">
          {BUDGETS.map((b) => <button key={String(b)} type="button" className="chip" style={{ padding: '5px 10px', fontSize: 12 }} aria-pressed={b === budget} onClick={() => onBudget(b)}>{budgetLabel(b)}</button>)}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data diagnose-table">
          <thead>
            <tr><th style={{ top: 0 }}>행사 \ 관계</th>{orderedRelations(config).map((r) => <th key={r} style={{ top: 0 }}>{config.relations[r].name}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.event}>
                <td><b>{config.events[row.event].name}</b></td>
                {row.cells.map((c) => <td key={c.relation}>{cell(c.s)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 고객 화면 카드 미리보기: 결과 화면과 같은 카드 부품으로 격식 단계·추천 이유·태그를 본다
function CardPreview({ catalog, productNo }: { catalog: Catalog; productNo: number }) {
  const { config } = catalog;
  const attrs = catalog.attributes.find((a) => a.productNo === productNo);
  const [event, setEvent] = useState<EventType>(attrs?.events[0] ?? orderedEvents(config)[0]);
  const [relation, setRelation] = useState<Relation>(attrs?.relations[0] ?? orderedRelations(config)[0]);
  const { candidates, excluded } = filterAndScore(catalog, { event, relation }, undefined);
  const item = candidates.find((c) => c.product.productNo === productNo);
  const out = excluded.find((x) => x.productNo === productNo);
  return (
    <div>
      <div className="chips">
        {orderedEvents(config).map((id) => <button key={id} type="button" className="chip" style={{ padding: '5px 10px', fontSize: 12 }} aria-pressed={event === id} onClick={() => setEvent(id)}>{config.events[id].name}</button>)}
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        {orderedRelations(config).map((id) => <button key={id} type="button" className="chip" style={{ padding: '5px 10px', fontSize: 12 }} aria-pressed={relation === id} onClick={() => setRelation(id)}>{config.relations[id].name}</button>)}
      </div>
      <div className="card-preview">
        {item ? (
          <MainPick item={item} quantity={10} packagingHref={`/packaging?product=${productNo}&from=pick`} excludeHref={null} preview />
        ) : (
          <p className="notice">이 상황에서는 고객에게 보이지 않습니다: {out?.reason ?? '지표 미입력'}</p>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>수량 10개 기준 화면입니다. 실제 고객에게는 1~3위 안에 들 때 이 카드(1위) 또는 작은 카드로 보입니다.</p>
    </div>
  );
}

// 변경 이력: 누가 언제 무엇을 바꿨는지. '불러오기'로 그때 값을 입력칸에 넣고 저장하면 되돌려진다
function History({ productNo, config, onLoad }: { productNo: number; config: EngineConfig; onLoad(a: ProductAttributes): void }) {
  const [state, setState] = useState<{ history: AttributeChange[] } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    void getAttributeHistoryAction(productNo).then((r) => { if (live) setState(r.ok ? { history: r.history } : { error: r.message }); });
    return () => { live = false; };
  }, [productNo]);
  if (!state) return <p className="small muted">이력을 읽는 중…</p>;
  if ('error' in state) return <p className="notice">이력을 읽지 못했습니다: {state.error}<br />Supabase를 쓴다면 SQL Editor에서 <code>supabase/migrations/20261025000000_operations.sql</code>을 실행했는지 확인하세요.</p>;
  if (state.history.length === 0) return <p className="small muted">아직 바뀐 기록이 없습니다. 이 화면을 연 뒤부터 저장할 때마다 남습니다.</p>;
  return (
    <ol className="history-list">
      {state.history.map((h) => {
        const changes = h.after ? attributeDiff(h.before, h.after, config) : [];
        const target = h.after ?? h.before;
        return (
          <li key={h.id}>
            <div className="spread">
              <span className="small"><b>{kstLabel(h.changedAt)}</b> · {h.changedBy ?? '관리자'} · {h.op === 'insert' ? '처음 입력' : h.op === 'delete' ? '삭제' : '수정'}</span>
              {target && <button type="button" className="btn ghost small" onClick={() => onLoad(target)}>{h.op === 'delete' ? '삭제 전 값 불러오기' : '이때 값 불러오기'}</button>}
            </div>
            {h.op === 'update' && (
              <ul className="small">
                {changes.map((c) => <li key={c.label}><b>{c.label}</b> {c.from || '(빈칸)'} → {c.to || '(빈칸)'}</li>)}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// 카페24 다시 가져오기 결과: 무엇이 바뀌었는지와 바로가기
function SyncReportView({ report, onOpen, onClose }: { report: SyncReport; onOpen(no: number): void; onClose(): void }) {
  const items = (title: string, list: { productNo: number; name: string; from?: number; to?: number }[], note?: string) =>
    list.length > 0 && (
      <div style={{ marginTop: 6 }}>
        <b className="small">{title} {list.length}</b>{note && <span className="small muted"> · {note}</span>}
        <ul className="small sync-list">
          {list.map((p) => (
            <li key={p.productNo}>
              <button type="button" className="link-btn" onClick={() => onOpen(p.productNo)}>{p.name}</button>
              {p.from !== undefined && p.to !== undefined && <span className="muted"> {won(p.from)} → {won(p.to)}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="sync-report" role="status">
      <div className="spread"><b className="small">가져오기 결과: {report.summary}</b><button type="button" className="link-btn small" onClick={onClose}>닫기</button></div>
      {report.alerts.map((a) => (
        <p key={a.productNo} className="small" style={{ color: 'var(--danger)', margin: '6px 0 0' }}>
          최근 30일 1위로 {a.first}번 추천된 ‘{a.name}’이(가) {a.state}되어 추천에서 빠집니다.
        </p>
      ))}
      {items('새 상품', report.added, '지표를 넣어야 추천에 나옵니다')}
      {items('가격 변경', report.priceChanged)}
      {items('품절·판매중지', report.stopped)}
      {items('판매 재개', report.resumed)}
      {report.removed.length > 0 && <p className="small muted" style={{ margin: '6px 0 0' }}>쇼핑몰에서 사라짐 {report.removed.length}: {report.removed.map((p) => p.name).join(', ')}</p>}
    </div>
  );
}
