'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { initialPolicy, OCCASIONS, RARE_FACTORS, parseWorkspace, type FormalityPolicy } from '@/engine/eligibility.ts';
import type { Catalog, Relation } from '@/engine/types.ts';
import { saveConfigAction } from '../actions.ts';

export function WeightsEditor({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [policy, setPolicy] = useState(() => initialPolicy(catalog));
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const edit = (fn: (p: FormalityPolicy) => void) => { setPolicy((old) => { const next = structuredClone(old); fn(next); return next; }); setMessage(''); };
  const input = (label: string, value: number, min: number, max: number, step: number, change: (value: number) => void) => (
    <input aria-label={label} type="number" min={min} max={max} step={step} value={value} onChange={(e) => change(e.target.value === '' ? NaN : Number(e.target.value))} />
  );
  function save() {
    start(async () => {
      try {
        const clean = parseWorkspace({ format: 'ondap-formality-v2', source: 'catalog', evidence: [], policy }).policy;
        await saveConfigAction({ ...catalog.config, formalityV2: clean });
        setMessage('추천 기준을 저장했습니다.'); router.refresh();
      } catch (e) { setMessage(e instanceof Error ? e.message : '저장하지 못했습니다.'); }
    });
  }
  const relations: Record<Relation, string> = { senior: '상급자/어르신', business: '거래처/공식', peer: '동료/지인', family: '가족/친밀' };
  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="panel">
      <h2>종합 추천점수(S) 가중치 (설계 제안값)</h2>
      <p className="small muted">
        행사 적합도(E) 70%와 가격 실속(V) 30%의 조합은 추천 설계를 위한 초기 제안값이며, 검증된 특허 산식이 아닙니다.
      </p>
    </section>
    <section className="panel"><h2>행사 격식과 받는 분 보정</h2>
      <p className="small muted">행사 점수와 관계 보정을 더해 해당 행사에 적용할 희소 기준을 고릅니다.</p>
      <div className="weights-grid"><div>{Object.entries(OCCASIONS).map(([key, label]) => <label className="spread" key={key}>{label}{input(`${label} 행사 점수`, policy.eventBase[key as keyof typeof OCCASIONS], 0, 100, 1, (v) => edit((p) => { p.eventBase[key as keyof typeof OCCASIONS] = v; }))}</label>)}</div>
      <div>{Object.entries(relations).map(([key, label]) => <label className="spread" key={key}>{label}{input(`${label} 보정`, policy.relationShift[key as Relation], -100, 100, 1, (v) => edit((p) => { p.relationShift[key as Relation] = v; }))}</label>)}</div></div>
    </section>
    <section className="panel"><h2>상품 희소 속성 가중치</h2><p className="small muted">근거가 확인된 속성 중 가중치가 큰 항목이 희소값에 더 반영됩니다.</p>
      {Object.entries(RARE_FACTORS).map(([key, item]) => <label className="spread" key={key}>{item.name}{input(`${item.name} 가중치`, policy.rarityWeights[key as keyof typeof RARE_FACTORS], 0, 100, 1, (v) => edit((p) => { p.rarityWeights[key as keyof typeof RARE_FACTORS] = v; }))}</label>)}
    </section>
    <section className="panel"><h2>행사 점수별 허용 희소 구간</h2><p className="small muted">각 행사 점수 이상부터 해당 구간을 적용합니다. 희소값은 0~1입니다.</p>
      <table className="data"><thead><tr><th>행사 점수 이상</th><th>희소값 하한</th><th>희소값 상한</th></tr></thead><tbody>{policy.bands.map((band, i) => <tr key={i}><td>{input(`${i + 1}구간 시작`, band.from, 0, 100, 1, (v) => edit((p) => { p.bands[i].from = v; }))}</td><td>{input(`${i + 1}구간 하한`, band.min, 0, 1, 0.05, (v) => edit((p) => { p.bands[i].min = v; }))}</td><td>{input(`${i + 1}구간 상한`, band.max, 0, 1, 0.05, (v) => edit((p) => { p.bands[i].max = v; }))}</td></tr>)}</tbody></table>
    </section>
    <div className="row"><button className="btn" disabled={pending} onClick={save}>{pending ? '저장 중…' : '기준 저장'}</button><span role="status">{message}</span></div>
  </div>;
}
