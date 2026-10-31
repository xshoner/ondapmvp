'use client';

import { useState, useTransition } from 'react';
import { OCCASIONS, PURPOSES, SENDERS, type FormalityInput } from '@/engine/eligibility.ts';
import { testPilotEvent } from '@/app/admin/formality/intake-actions.ts';

const relations = { senior: '상급자/어르신', business: '거래처/공식', peer: '동료/친구', family: '가족/친밀' } as const;
type Input = Pick<FormalityInput, 'event' | 'relation' | 'sender' | 'purpose'>;
type Result = Awaited<ReturnType<typeof testPilotEvent>>;

export function EventTest({ productNo, ready }: { productNo: number; ready: boolean }) {
  const [input, setInput] = useState<Input>({ event: 'ceremony', relation: 'business', sender: 'public', purpose: 'return' });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  function change(patch: Partial<Input>) { setInput((value) => ({ ...value, ...patch })); setResult(null); setError(''); }
  return <section className="panel intake-section">
    <h2>행사에 맞는지 시험</h2>
    <p className="small muted">상품 희소값을 확인한 뒤 행사 조건을 선택해 적합 기준을 시험합니다.</p>
    <div className="event-test-fields">
      <label>행사<select aria-label="시험 행사" value={input.event} disabled={pending} onChange={(e) => change({ event: e.target.value as Input['event'] })}>{Object.entries(OCCASIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>받는 분과 관계<select aria-label="시험 관계" value={input.relation} disabled={pending} onChange={(e) => change({ relation: e.target.value as Input['relation'] })}>{Object.entries(relations).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>보내는 주체<select aria-label="시험 발신 주체" value={input.sender} disabled={pending} onChange={(e) => change({ sender: e.target.value as Input['sender'] })}>{Object.entries(SENDERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>목적<select aria-label="시험 목적" value={input.purpose} disabled={pending} onChange={(e) => change({ purpose: e.target.value as Input['purpose'] })}>{Object.entries(PURPOSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <button className="btn small" disabled={!ready || pending} onClick={() => start(async () => {
      setError(''); setResult(null);
      try { setResult(await testPilotEvent(productNo, input)); } catch (e) { setError(e instanceof Error ? e.message : '시험하지 못했습니다.'); }
    })}>{pending ? '확인 중…' : '행사 적합성 확인'}</button>
    {!ready && <p className="small muted">먼저 상품 정보를 확인하고 계산해 주세요.</p>}
    {error && <p className="notice" role="alert">{error}</p>}
    {ready && result && <div className="notice" role="status"><b>{result.allowed ? '기준 충족' : '기준 미충족'}</b><p>{result.reason}</p><p className="small">행사 격식 {result.eventScore}점 · 상품 희소값 {(result.rarity * 100).toFixed(0)}점 · 해당 행사 허용 {(result.min * 100).toFixed(0)}~{(result.max * 100).toFixed(0)}점</p>{result.incomplete && <p className="small">발신 주체 또는 목적이 미입력입니다.</p>}<p className="small">시험용 기준입니다. 가격·신뢰·실용성 등을 포함한 최종 추천 순위는 별도로 확인해야 합니다.</p></div>}
  </section>;
}
