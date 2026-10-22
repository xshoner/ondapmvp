'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recommend } from '@/engine/recommend.ts';
import type { Catalog, EngineConfig, EventType, Relation } from '@/engine/types.ts';
import { saveConfigAction } from '../actions.ts';
import { eventIds as orderedEvents, relationIds as orderedRelations } from '@/engine/labels.ts';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

function Num({ value, onChange, step = 0.1, min, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <input type="number" value={value} step={step} min={min} max={max}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
  );
}

export function WeightsEditor({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [config, setConfig] = useState<EngineConfig>(() => structuredClone(catalog.config));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ event: EventType; relation: Relation; budget: number }>({ event: 'funeral', relation: 'senior', budget: 60000 });

  const eventIds = orderedEvents(config);
  const relationIds = orderedRelations(config);

  function edit(mutator: (c: EngineConfig) => void) {
    setConfig((c) => {
      const next = structuredClone(c);
      mutator(next);
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  const before = useMemo(
    () => recommend(catalog, { event: preview.event, relation: preview.relation, budgetMax: preview.budget }),
    [catalog, preview],
  );
  const after = useMemo(
    () => recommend({ ...catalog, config }, { event: preview.event, relation: preview.relation, budgetMax: preview.budget }),
    [catalog, config, preview],
  );

  function save() {
    startTransition(async () => {
      await saveConfigAction(config);
      setDirty(false);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="weights-grid">
      <div style={{ display: 'grid', gap: 20 }}>
        <section className="panel">
          <h2>행사별 가중치와 격식 목표</h2>
          <p className="small muted">가중치가 클수록 그 지표가 순위에 크게 작용합니다. 격식 목표는 격식 적합도가 몇 점일 때 가장 좋은지입니다(0~10).</p>
          <table className="data">
            <thead>
              <tr>
                <th style={{ top: 0 }}>행사</th>
                {config.indicators.map((i) => <th key={i.id} style={{ top: 0 }}>{i.name}</th>)}
                <th style={{ top: 0 }}>격식 목표</th>
              </tr>
            </thead>
            <tbody>
              {eventIds.map((ev) => (
                <tr key={ev}>
                  <td>{config.events[ev].name}</td>
                  {config.indicators.map((i) => (
                    <td key={i.id}>
                      <Num value={config.events[ev].weights[i.id] ?? 0} min={0} onChange={(v) => edit((c) => { c.events[ev].weights[i.id] = v; })} />
                    </td>
                  ))}
                  <td><Num value={config.events[ev].formalityTarget} step={0.5} min={0} max={10} onChange={(v) => edit((c) => { c.events[ev].formalityTarget = v; })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>관계별 보정</h2>
          <p className="small muted">행사 가중치에 곱하는 값(비우면 1)과, 격식 목표를 올리거나 내리는 값입니다.</p>
          <table className="data">
            <thead>
              <tr>
                <th style={{ top: 0 }}>관계</th>
                {config.indicators.map((i) => <th key={i.id} style={{ top: 0 }}>{i.name} ×</th>)}
                <th style={{ top: 0 }}>격식 목표 ±</th>
              </tr>
            </thead>
            <tbody>
              {relationIds.map((r) => (
                <tr key={r}>
                  <td>{config.relations[r].name}</td>
                  {config.indicators.map((i) => (
                    <td key={i.id}>
                      <Num value={config.relations[r].multipliers[i.id] ?? 1} min={0} onChange={(v) => edit((c) => { c.relations[r].multipliers[i.id] = v; })} />
                    </td>
                  ))}
                  <td><Num value={config.relations[r].formalityShift} step={0.5} onChange={(v) => edit((c) => { c.relations[r].formalityShift = v; })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>보너스와 규칙</h2>
          <table className="data" style={{ maxWidth: 560 }}>
            <tbody>
              {([
                ['eventFit', '행사 어울림 (+)'],
                ['eventMiss', '행사 미지정 (−)'],
                ['relationFit', '관계 어울림 (+)'],
                ['meaning', '선물의 의미 일치 (+)'],
                ['depopulation', '소멸위기지역 상생 (+)'],
              ] as const).map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td><Num value={config.bonus[k]} step={1} onChange={(v) => edit((c) => { c.bonus[k] = v; })} /> 점</td>
                </tr>
              ))}
              <tr>
                <td>격식 목표에서 1 벗어날 때 감점</td>
                <td><Num value={config.targetSlope} step={0.1} min={0} onChange={(v) => edit((c) => { c.targetSlope = v; })} /> 점</td>
              </tr>
              <tr>
                <td>결과 부족 시 예산 확대 배수</td>
                <td><Num value={config.budgetRelaxRatio} step={0.1} min={1} onChange={(v) => edit((c) => { c.budgetRelaxRatio = v; })} /> 배</td>
              </tr>
              <tr>
                <td>같은 카테고리 최대 개수</td>
                <td><Num value={config.diversity.maxPerCategory} step={1} min={1} onChange={(v) => edit((c) => { c.diversity.maxPerCategory = v; })} /> 개</td>
              </tr>
              <tr>
                <td>소멸위기지역 (쉼표로 구분)</td>
                <td>
                  <input type="text" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px' }}
                    value={config.depopulationAreas.join(', ')}
                    onChange={(e) => edit((c) => { c.depopulationAreas = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); })} />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>점수 기준 예시</h2>
          <p className="small muted">상품 지표를 매길 때 점수 막대 아래에 보이는 도움말입니다. 누가 매겨도 같은 기준이 되도록 점수대마다 어떤 상품인지 한 줄로 적어 주세요.</p>
          <table className="data">
            <thead>
              <tr>
                <th style={{ top: 0, width: 110 }}>지표</th>
                {([['high', '8~10점'], ['mid', '4~7점'], ['low', '0~3점']] as const).map(([k, label]) => <th key={k} style={{ top: 0 }}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {config.indicators.map((ind, i) => (
                <tr key={ind.id}>
                  <td>{ind.name}</td>
                  {(['high', 'mid', 'low'] as const).map((k) => (
                    <td key={k}>
                      <input
                        type="text" maxLength={120} aria-label={`${ind.name} ${k === 'high' ? '높은' : k === 'mid' ? '중간' : '낮은'} 점수 예시`}
                        placeholder={k === 'high' ? '예: 울릉도 명이처럼 산지 한정·소량' : ''}
                        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px' }}
                        value={ind.examples?.[k] ?? ''}
                        onChange={(e) => edit((c) => { c.indicators[i].examples = { ...c.indicators[i].examples, [k]: e.target.value }; })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* 미리보기 */}
      <aside className="panel weights-preview">
        <h3>바꾸면 어떻게 달라지나</h3>
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          <select value={preview.event} onChange={(e) => setPreview({ ...preview, event: e.target.value as EventType })}>
            {eventIds.map((ev) => <option key={ev} value={ev}>{config.events[ev].name}</option>)}
          </select>
          <select value={preview.relation} onChange={(e) => setPreview({ ...preview, relation: e.target.value as Relation })}>
            {relationIds.map((r) => <option key={r} value={r}>{config.relations[r].name}</option>)}
          </select>
          <select value={preview.budget} onChange={(e) => setPreview({ ...preview, budget: Number(e.target.value) })}>
            {[30000, 60000, 100000, 200000].map((b) => <option key={b} value={b}>{won(b)}</option>)}
          </select>
        </div>
        {(['저장된 설정', '수정 중'] as const).map((label, idx) => {
          const r = idx === 0 ? before : after;
          return (
            <div key={label} style={{ marginTop: 14 }}>
              <div className="small" style={{ fontWeight: 700, color: idx === 1 ? 'var(--green)' : 'var(--muted)' }}>{label}</div>
              <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {r.results.map((x) => {
                  const moved = idx === 1 && before.results.findIndex((b) => b.product.productNo === x.product.productNo) !== after.results.indexOf(x);
                  return (
                    <li key={x.product.productNo} className="small" style={{ marginBottom: 4 }}>
                      {x.product.name} <b>{x.matchScore}</b>
                      {moved && <span className="pill gold" style={{ marginLeft: 4, fontSize: 10, padding: '0 6px' }}>변동</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
        <div style={{ marginTop: 18, display: 'grid', gap: 8 }}>
          <button className="btn block" onClick={save} disabled={!dirty || pending}>{pending ? '저장 중…' : '설정 저장'}</button>
          {dirty && <button className="btn ghost block small" onClick={() => { setConfig(structuredClone(catalog.config)); setDirty(false); }}>되돌리기</button>}
          {saved && <span className="small" style={{ color: 'var(--green)' }}>저장했습니다. <a href="/admin/verify">검증 화면에서 전체 결과 보기 →</a></span>}
        </div>
      </aside>
    </div>
  );
}
