'use client';

import { useMemo, useState } from 'react';
import type { Catalog, Relation } from '@/engine/types.ts';
import { evaluateFormality, initialPolicy, OCCASIONS, parseWorkspace, PURPOSES, RANK_FACTORS, RARE_FACTORS, SENDERS, type FormalityInput, type FormalityWorkspace, type ProductEvidence, type RareFactor } from '@/engine/eligibility.ts';
import { formalitySamples, SAMPLE_INPUT } from '@/engine/formality-samples.ts';
import { saveBlob } from '@/lib/device.ts';
import { won } from '@/lib/result-query.ts';

const RELATIONS = { senior: '상급자/어르신', business: '거래처/공식', peer: '동료/친구', family: '가족/친밀' } as const;

function Num({ label, value, min, max, step = 1, onValue }: { label: string; value: number; min: number; max: number; step?: number; onValue: (n: number) => void }) {
  return <input aria-label={label} type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ''} onChange={(e) => { if (e.target.value !== '') onValue(Number(e.target.value)); }} style={{ width: 90 }} />;
}

export function FormalityWorkbench({ catalog, pilotEvidence = [] }: { catalog: Catalog; pilotEvidence?: ProductEvidence[] }) {
  const samples = useMemo(() => formalitySamples(catalog), [catalog]);
  const [workspace, setWorkspace] = useState<FormalityWorkspace>(() => samples.workspace);
  const [input, setInput] = useState<FormalityInput>({ ...SAMPLE_INPUT });
  const [selectedNo, setSelectedNo] = useState(samples.catalog.products[0].productNo);
  const [message, setMessage] = useState('');
  const active = workspace.source === 'sample' ? samples.catalog : catalog;
  const evidence = workspace.evidence.find((e) => e.productNo === selectedNo) ?? { productNo: selectedNo, reviewed: false, factors: {} };
  const evaluation = useMemo(() => {
    try { return { result: evaluateFormality(active, workspace, input), error: '' }; }
    catch (e) { return { result: null, error: e instanceof Error ? e.message : '설정을 확인해 주세요.' }; }
  }, [active, workspace, input]);
  function edit(fn: (w: FormalityWorkspace) => void) {
    setWorkspace((w) => { const next = structuredClone(w); fn(next); return next; });
    setMessage('');
  }
  function editEvidence(fn: (e: ProductEvidence) => void, review = false) {
    edit((w) => {
      let item = w.evidence.find((e) => e.productNo === selectedNo);
      if (!item) { item = { productNo: selectedNo, reviewed: false, factors: {} }; w.evidence.push(item); }
      if (!review) item.reviewed = false;
      fn(item);
    });
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('검증 파일은 2MB까지 불러올 수 있습니다.');
      const next = parseWorkspace(JSON.parse(await file.text()));
      const products = next.source === 'sample' ? samples.catalog.products : catalog.products;
      const known = new Set(products.map((p) => p.productNo));
      if (next.evidence.some((e) => !known.has(e.productNo))) throw new Error('현재 상품 목록에 없는 상품번호가 있습니다. 상품을 확인해 주세요.');
      setWorkspace(next); setSelectedNo(products[0]?.productNo ?? 0); setMessage('기준과 근거를 불러왔습니다. 행사 조건은 현재 선택을 유지합니다.');
    } catch (e) { setMessage(e instanceof Error ? e.message : '파일을 읽지 못했습니다.'); }
  }
  function download(result = false) {
    try {
      const value = result ? evaluation.result : parseWorkspace(workspace);
      if (!value) throw new Error('유효한 계산 결과가 없습니다.');
      saveBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), result ? 'ondap-formality-result.json' : 'ondap-formality-workspace.json');
      setMessage('파일로 내보냈습니다. 결과 파일에는 당시 카탈로그·기준·근거가 포함됩니다.');
    } catch (e) { setMessage(e instanceof Error ? e.message : '내보내지 못했습니다.'); }
  }
  return <>
    <header className="page-head spread" style={{ alignItems: 'flex-start' }}>
      <div>
        <h1>격식지수 v2 검증실</h1>
        <p>특허출원 구조(행사 분석부 → 상품 속성 평가부 → 매칭 필터부 → 상품 추천부)에 따른 전체 시뮬레이션 및 기준표 검증입니다.</p>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <a className="btn ghost small" href="/admin/formality">← 상품 평가·시험으로 돌아가기</a>
      </div>
    </header>
    <p className="notice">{workspace.source === 'sample' ? '가상 샘플 3개로 검증 중입니다. 이름·가격·경력·생산량·점수는 모두 예시입니다.' : `현재 카탈로그(로컬 검수 상품 ${pilotEvidence.filter((e) => e.reviewed).length}건 포함)로 검증 중입니다. 실제 근거를 입력하고 검수한 상품만 후보가 됩니다.`} 기준 수치는 검수 전 가안입니다. 고객 추천에는 적용되지 않습니다.</p>
    <section className="panel" style={{ marginBottom: 20 }}>
      <h2>검증 자료</h2>
      <p className="small muted">자료를 전환하면 입력 중인 기준·근거가 초기화됩니다. 보관하려면 먼저 파일로 내보내세요. 이 화면은 DB에 저장하지 않으며 새로고침하면 초기화됩니다. 개인정보·비공개 서류는 근거 칸에 넣지 마세요.</p>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label>자료 <select aria-label="검증 자료" value={workspace.source} onChange={(e) => {
          const source = e.target.value as FormalityWorkspace['source'];
          setWorkspace(source === 'sample' ? structuredClone(samples.workspace) : { format: 'ondap-formality-v2', source, policy: initialPolicy(catalog), evidence: structuredClone(pilotEvidence) });
          setSelectedNo((source === 'sample' ? samples.catalog : catalog).products[0]?.productNo ?? 0); setMessage('');
        }}><option value="sample">가상 샘플 3개</option><option value="catalog">현재 카탈로그</option></select></label>
        <button className="btn ghost small" onClick={() => download()}>기준·근거 파일로 내보내기</button>
        <label>기준·근거 파일 불러오기 <input aria-label="기준·근거 파일 불러오기" type="file" accept="application/json,.json" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel">
        <h2>1. 행사와 기준</h2>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label>행사 <select aria-label="행사" value={input.event} onChange={(e) => setInput({ ...input, event: e.target.value as FormalityInput['event'] })}>{Object.entries(OCCASIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label>관계 <select aria-label="관계" value={input.relation} onChange={(e) => setInput({ ...input, relation: e.target.value as Relation })}>{Object.entries(RELATIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label>발신 주체 <select aria-label="발신 주체" value={input.sender} onChange={(e) => setInput({ ...input, sender: e.target.value as FormalityInput['sender'] })}>{Object.entries(SENDERS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label>목적 <select aria-label="목적" value={input.purpose} onChange={(e) => setInput({ ...input, purpose: e.target.value as FormalityInput['purpose'] })}>{Object.entries(PURPOSES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label>1개당 예산 <Num label="1개당 예산" min={1} max={100000000} value={input.budget ?? 50000} onValue={(budget) => setInput({ ...input, budget })} /></label>
          <label><input type="checkbox" checked={input.budget === null} onChange={(e) => setInput({ ...input, budget: e.target.checked ? null : 50000 })} /> 예산 제한 없음</label>
          <label>수량 <Num label="검증 수량" min={1} max={100000} value={input.quantity} onValue={(quantity) => setInput({ ...input, quantity })} /></label>
        </div>
        {evaluation.error && <p role="alert" className="notice">{evaluation.error}</p>}
        {evaluation.result && <div aria-live="polite" style={{ marginTop: 16 }}>
          <b>행사 격식지수 {evaluation.result.event.score}점</b> · 희소 속성 허용 {evaluation.result.event.band.min}~{evaluation.result.event.band.max}
          <p className="small">행사 {evaluation.result.event.parts.event} + 관계 {evaluation.result.event.parts.relation} + 발신 주체 {evaluation.result.event.parts.sender} + 목적 {evaluation.result.event.parts.purpose} (0~100 제한)</p>
          {evaluation.result.event.incomplete && <p className="notice">발신 주체 또는 목적이 미입력입니다. 공식 문서 생성 전 보완해야 합니다.</p>}
        </div>}
        <details style={{ marginTop: 12 }}><summary>기준표 편집 (검증용 가안)</summary>
          <p><label>기준 버전 <input aria-label="기준 버전" value={workspace.policy.version} maxLength={80} onChange={(e) => edit((w) => { w.policy.version = e.target.value; })} /></label></p>
          <p className="small muted">행사·관계 초기값은 기존 목표와 보정의 10배이며 새 모델에서 검수한 값이 아닙니다. 수정본은 다른 버전 이름으로 보관하세요.</p>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
            {(['eventBase', 'relationShift', 'senderShift', 'purposeShift'] as const).map((group) => {
              const labels = group === 'eventBase' ? OCCASIONS : group === 'relationShift' ? RELATIONS : group === 'senderShift' ? SENDERS : PURPOSES;
              const values = workspace.policy[group];
              const limit = group === 'senderShift' || group === 'purposeShift' ? 20 : 100;
              return <div key={group}><h3>{({ eventBase: '행사 기본점수', relationShift: '관계 보정', senderShift: '주체 보정', purposeShift: '목적 보정' })[group]}</h3>{Object.entries(values).map(([key, value]) => <p key={key}><label>{(labels as Record<string, string>)[key]} <Num label={`${group} ${key}`} min={group === 'eventBase' ? 0 : -limit} max={limit} value={value} onValue={(n) => edit((w) => { (w.policy[group] as Record<string, number>)[key] = n; })} /></label></p>)}</div>;
            })}
          </div>
          <table className="data"><caption>행사 점수 구간별 희소값 범위</caption><thead><tr><th>구간 시작</th><th>하한</th><th>상한</th></tr></thead><tbody>{workspace.policy.bands.map((band, i) => <tr key={i}>{(['from', 'min', 'max'] as const).map((key) => <td key={key}><Num label={`구간 ${i + 1} ${key}`} value={band[key]} min={0} max={key === 'from' ? 100 : 1} step={key === 'from' ? 1 : 0.01} onValue={(n) => edit((w) => { w.policy.bands[i][key] = n; })} /></td>)}</tr>)}</tbody></table>
          <h3>희소 속성 결합 가중치</h3><div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>{(Object.keys(RARE_FACTORS) as RareFactor[]).map((key) => <label key={key}>{RARE_FACTORS[key].name} <Num label={`${RARE_FACTORS[key].name} 가중치`} value={workspace.policy.rarityWeights[key]} min={0} max={100} onValue={(n) => edit((w) => { w.policy.rarityWeights[key] = n; })} /></label>)}</div>
          <h3>필터 통과 후 순위 가중치</h3><div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>{(Object.keys(RANK_FACTORS) as (keyof typeof RANK_FACTORS)[]).map((key) => <label key={key}>{RANK_FACTORS[key]} <Num label={`${key} 순위 가중치`} value={workspace.policy.rankWeights[key]} min={0} max={100} onValue={(n) => edit((w) => { w.policy.rankWeights[key] = n; })} /></label>)}</div>
        </details>
      </section>
      <section className="panel">
        <h2>2. 상품별 희소 근거</h2>
        <label>상품 <select aria-label="근거 편집 상품" value={selectedNo} onChange={(e) => setSelectedNo(Number(e.target.value))}>{active.products.map((p) => <option key={p.productNo} value={p.productNo}>{p.name}</option>)}</select></label>
        <p className="small muted">근거를 읽고 0~10의 평가값을 입력합니다. 모르는 속성은 ‘미입력’으로 두세요. 문장만으로 자동 채점하지 않습니다. 근거를 수정하면 검수 확인이 해제됩니다.</p>
        <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>속성·초기 평가 기준</th><th>평가값</th><th>자료·출처와 판단 근거</th></tr></thead><tbody>{(Object.keys(RARE_FACTORS) as RareFactor[]).map((key) => <tr key={key}>
          <td><b>{RARE_FACTORS[key].name}</b><p className="small muted" style={{ maxWidth: 310 }}>{RARE_FACTORS[key].guide}</p></td>
          <td><label><input type="checkbox" aria-label={`${RARE_FACTORS[key].name} 입력됨`} checked={Boolean(evidence.factors[key])} onChange={(e) => editEvidence((item) => { if (e.target.checked) item.factors[key] = { score: 0, basis: '' }; else delete item.factors[key]; })} /> {evidence.factors[key] ? '입력됨' : '미입력'}</label>{evidence.factors[key] && <Num label={`${RARE_FACTORS[key].name} 점수`} value={evidence.factors[key]!.score} min={0} max={10} step={0.1} onValue={(n) => editEvidence((item) => { item.factors[key]!.score = n; })} />}</td>
          <td>{evidence.factors[key] && <textarea aria-label={`${RARE_FACTORS[key].name} 근거`} rows={3} maxLength={2000} style={{ width: '100%', minWidth: 220 }} value={evidence.factors[key]!.basis} onChange={(e) => editEvidence((item) => { item.factors[key]!.basis = e.target.value; })} />}</td>
        </tr>)}</tbody></table></div>
        <p><label><input aria-label="상품 근거 검수 확인" type="checkbox" checked={evidence.reviewed} onChange={(e) => editEvidence((item) => { item.reviewed = e.target.checked; }, true)} /> {workspace.source === 'sample' ? '가상 자료로 통과·제외 동작을 검수함' : '근거·평가값을 운영자가 검수함'}</label></p>
      </section>
      <section className="panel">
        <h2>3. 후보 판정과 추천</h2>
        <p className="small muted">희소값은 근거가 있는 속성 중 가중치가 양수인 2개 이상을 정규화·결합합니다. 적격 필터 후 신뢰·실용성·가격으로 평가하며, 희소값은 순위 점수에 다시 더하지 않습니다. 예산이 없으면 가격 가중치를 제외합니다.</p>
        {evaluation.result && <>
          <ol>{evaluation.result.selected.map((d) => <li key={d.product.productNo}><b>{d.product.name}</b> · 순위 평가 {d.rankScore}점 · {won(d.product.price)} × {input.quantity}개 = {won(d.product.price * input.quantity)} (상품대만)</li>)}</ol>
          {evaluation.result.notice && <p className="notice">{evaluation.result.notice}</p>}
          <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>상품</th><th>희소값</th><th>근거 충족도</th><th>판정</th><th>순위 평가</th><th>이유</th></tr></thead><tbody>{evaluation.result.decisions.map((d) => <tr key={d.product.productNo}>
            <td>{d.product.name}</td><td>{d.rarity.value?.toFixed(3) ?? '산출 보류'}</td><td>{d.rarity.used.length}/5 · {d.rarity.reviewed ? '검수 확인' : '미검수'}</td><td>{d.eligible ? '적격' : '제외'}</td><td>{d.rankScore === null ? '평가하지 않음' : d.rankScore}</td><td>{d.reason}</td>
          </tr>)}</tbody></table></div>
          <button className="btn ghost small" style={{ marginTop: 12 }} onClick={() => download(true)}>판정 결과·당시 자료 내보내기</button>
        </>}
        <p className="small muted">현재는 적격 상위 최대 3개를 검증합니다. 실속·표준·격식 구성안, 결재 문서, 법령 적합성·실제 납기 보장은 이 점수에 포함되지 않습니다.</p>
      </section>
    </div>
  </>;
}
