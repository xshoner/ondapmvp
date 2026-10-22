'use client';

// AI 지표 일괄 제안: 여러 상품을 골라 차례로 제안을 받고(무료 등급 호출 한도 때문에 간격을 둔다), 상품마다 확인 후 저장한다
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { applySuggestion, type AiSuggestion } from '@/ai/suggest.ts';
import { emptyAttributes } from '@/data/attributes-csv.ts';
import { baseIndex } from '@/engine/formality.ts';
import type { Cafe24Product, EngineConfig, ProductAttributes } from '@/engine/types.ts';
import { saveAttributesAction, suggestScoresAction } from '../actions.ts';

type Props = { products: Cafe24Product[]; attributes: ProductAttributes[]; config: EngineConfig };
type Item = { status: 'waiting' | 'asking' | 'ready' | 'failed' | 'saved' | 'skipped'; suggestion?: AiSuggestion; message?: string };

const GAP_MS = 2500; // 호출 사이 간격 (무료 등급 분당 호출 한도 보호)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function BatchSuggest({ products, attributes, config }: Props) {
  const router = useRouter();
  const attrMap = useMemo(() => new Map(attributes.map((a) => [a.productNo, a])), [attributes]);
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const list = products.filter((p) => !onlyUnreviewed || !attrMap.get(p.productNo)?.reviewed);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(products.filter((p) => !attrMap.get(p.productNo)?.reviewed).map((p) => p.productNo)));
  const [items, setItems] = useState<Map<number, Item>>(new Map());
  const [running, setRunning] = useState(false);
  const [markReviewed, setMarkReviewed] = useState(false);
  const stop = useRef(false);

  const setItem = (no: number, item: Item) => setItems((m) => new Map(m).set(no, item));
  const attrsOf = (no: number) => attrMap.get(no) ?? emptyAttributes(config, no);

  const run = async () => {
    const queue = list.map((p) => p.productNo).filter((no) => selected.has(no));
    if (queue.length === 0) return;
    stop.current = false;
    setRunning(true);
    setItems(new Map(queue.map((no) => [no, { status: 'waiting' } as Item])));
    for (let i = 0; i < queue.length; i++) {
      if (stop.current) break;
      const no = queue[i];
      setItem(no, { status: 'asking' });
      const a = attrsOf(no);
      try {
        const r = await suggestScoresAction(no, { region: a.region, category: a.category, story: a.story, tags: a.tags });
        setItem(no, r.ok ? { status: 'ready', suggestion: r.suggestion } : { status: 'failed', message: r.message });
      } catch (e) {
        setItem(no, { status: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
      if (i < queue.length - 1) await sleep(GAP_MS);
    }
    setRunning(false);
  };

  const save = async (no: number) => {
    const it = items.get(no);
    if (!it?.suggestion) return;
    try {
      await saveAttributesAction({ ...applySuggestion(attrsOf(no), it.suggestion), reviewed: markReviewed || attrsOf(no).reviewed });
      setItem(no, { ...it, status: 'saved' });
    } catch (e) {
      setItem(no, { ...it, status: 'failed', message: `저장 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const saveAll = async () => {
    for (const [no, it] of items) if (it.status === 'ready') await save(no);
    router.refresh();
  };

  const ready = [...items.values()].filter((x) => x.status === 'ready').length;
  const done = [...items.values()].filter((x) => x.status !== 'waiting' && x.status !== 'asking').length;
  const nameOf = (no: number) => products.find((p) => p.productNo === no)?.name ?? `상품번호 ${no}`;
  const eventName = (id: string) => config.events[id as keyof typeof config.events]?.name ?? id;

  return (
    <div className="grid-2">
      <aside className="panel" style={{ padding: 16, position: 'sticky', top: 80 }}>
        <div className="spread">
          <b>상품 고르기</b>
          <span className="small muted">{selected.size}개 선택</span>
        </div>
        <label className="small row" style={{ gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={onlyUnreviewed} onChange={(e) => setOnlyUnreviewed(e.target.checked)} />
          검토 안 한 상품만 보기
        </label>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button type="button" className="btn ghost small" onClick={() => setSelected(new Set(list.map((p) => p.productNo)))}>모두 선택</button>
          <button type="button" className="btn ghost small" onClick={() => setSelected(new Set())}>선택 해제</button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
          {list.map((p) => (
            <li key={p.productNo}>
              <label className="row small" style={{ gap: 8, padding: '6px 4px', flexWrap: 'nowrap', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(p.productNo)} disabled={running}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(p.productNo)) n.delete(p.productNo); else n.add(p.productNo); return n; })} />
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>{p.name}</span>
                {attrMap.get(p.productNo)?.reviewed && <span className="pill">검토</span>}
              </label>
            </li>
          ))}
        </ul>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {running ? (
            <button type="button" className="btn ghost block" onClick={() => { stop.current = true; }}>멈추기 ({done}/{items.size})</button>
          ) : (
            <button type="button" className="btn block" disabled={selected.size === 0} onClick={() => void run()}>선택한 {selected.size}개 AI 제안 받기</button>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            한 상품에 몇 초씩 걸리고, 무료 호출 한도 때문에 사이에 잠깐 쉽니다. 제안은 저장하기 전까지 반영되지 않습니다.
          </p>
        </div>
      </aside>

      <section className="panel">
        <div className="spread" style={{ marginBottom: 14 }}>
          <b>제안 결과 {items.size > 0 && <span className="small muted" style={{ fontWeight: 400 }}>{done}/{items.size} 완료, 저장 대기 {ready}개</span>}</b>
          <div className="row" style={{ gap: 10 }}>
            <label className="small row" style={{ gap: 6 }}>
              <input type="checkbox" checked={markReviewed} onChange={(e) => setMarkReviewed(e.target.checked)} />
              저장할 때 검토 완료로 표시
            </label>
            <button type="button" className="btn small" disabled={ready === 0 || running} onClick={() => void saveAll()}>저장 대기 {ready}개 모두 저장</button>
          </div>
        </div>

        {items.size === 0 && <p className="small muted" style={{ margin: 0 }}>왼쪽에서 상품을 고르고 ‘AI 제안 받기’를 누르세요. 상품 스토리를 먼저 채워 두면 제안이 더 정확합니다.</p>}

        <div style={{ display: 'grid', gap: 12 }}>
          {[...items].map(([no, it]) => {
            const before = attrsOf(no);
            const after = it.suggestion ? applySuggestion(before, it.suggestion) : null;
            return (
              <article key={no} className="card" style={{ padding: 16 }}>
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <b>{nameOf(no)}</b>
                    <div className="small muted">상품번호 {no}</div>
                  </div>
                  <span className={`pill ${it.status === 'failed' ? 'red' : it.status === 'saved' ? '' : 'gray'}`}>
                    {{ waiting: '대기', asking: '제안 받는 중', ready: '저장 대기', failed: '실패', saved: '저장함', skipped: '건너뜀' }[it.status]}
                  </span>
                </div>
                {it.message && <p className="small" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>{it.message}</p>}
                {it.suggestion && after && (
                  <>
                    {it.suggestion.summary && <p className="small" style={{ margin: '8px 0' }}>{it.suggestion.summary}</p>}
                    <table className="data designs-table">
                      <thead>
                        <tr>
                          <th>지표</th>
                          {config.indicators.map((i) => <th key={i.id} className="right">{i.name}</th>)}
                          <th className="right">기본 점수</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="muted">지금</td>
                          {config.indicators.map((i) => <td key={i.id} className="right">{before.scores[i.id] ?? 0}</td>)}
                          <td className="right">{baseIndex(config, before)}</td>
                        </tr>
                        <tr>
                          <td><b>제안</b></td>
                          {config.indicators.map((i) => {
                            const changed = (after.scores[i.id] ?? 0) !== (before.scores[i.id] ?? 0);
                            return <td key={i.id} className="right" style={changed ? { fontWeight: 700, color: 'var(--pine)' } : undefined} title={it.suggestion!.reasons[i.id]}>{after.scores[i.id] ?? 0}</td>;
                          })}
                          <td className="right"><b>{baseIndex(config, after)}</b></td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="small muted" style={{ margin: '8px 0 0' }}>
                      어울리는 자리: {after.events.map(eventName).join(', ') || '없음'}
                      {after.excludedEvents.length > 0 && ` / 제외: ${after.excludedEvents.map((x) => `${eventName(x.event)}(${x.reason})`).join(', ')}`}
                    </p>
                    {it.status === 'ready' && (
                      <div className="row" style={{ gap: 8, marginTop: 12 }}>
                        <button type="button" className="btn small" onClick={() => void save(no).then(() => router.refresh())}>적용하고 저장</button>
                        <a className="btn ghost small" href={`/admin?product=${no}`} target="_blank" rel="noreferrer">상품 편집에서 자세히</a>
                        <button type="button" className="btn ghost small" style={{ border: 'none' }} onClick={() => setItem(no, { ...it, status: 'skipped' })}>건너뛰기</button>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
