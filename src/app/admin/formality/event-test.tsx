'use client';

import { useState, useTransition } from 'react';
import { OCCASIONS, PURPOSES, SENDERS, type FormalityInput } from '@/engine/eligibility.ts';
import { testPilotEvent } from './intake-actions.ts';

const relations = { senior: '상급자/어르신', business: '거래처/공식', peer: '동료/친구', family: '가족/친밀' } as const;
type Input = Pick<FormalityInput, 'event' | 'relation' | 'sender' | 'purpose'>;
type Result = Awaited<ReturnType<typeof testPilotEvent>>;

export function EventTest({ productNo, ready }: { productNo: number; ready: boolean }) {
  const [input, setInput] = useState<Input>({ event: 'ceremony', relation: 'business', sender: 'public', purpose: 'return' });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function change(patch: Partial<Input>) {
    setInput((value) => ({ ...value, ...patch }));
    setResult(null);
    setError('');
  }

  return (
    <section className="panel intake-section" style={{ marginTop: 20 }}>
      <div className="spread intake-section-title">
        <div>
          <h2>행사 적합성 시험</h2>
          <p className="small muted">
            상품 희소값을 계산한 뒤, 특정 행사 조건(행사·관계·주체·목적)에 대해 이 상품이 기준을 충족하는지 시험합니다.
          </p>
        </div>
      </div>

      <div className="event-test-fields" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <label>
          <span className="small">행사 종류</span>
          <select aria-label="시험 행사" value={input.event} disabled={pending} onChange={(e) => change({ event: e.target.value as Input['event'] })}>
            {Object.entries(OCCASIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>
          <span className="small">받는 분과의 관계</span>
          <select aria-label="시험 관계" value={input.relation} disabled={pending} onChange={(e) => change({ relation: e.target.value as Input['relation'] })}>
            {Object.entries(relations).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>
          <span className="small">보내는 주체</span>
          <select aria-label="시험 발신 주체" value={input.sender} disabled={pending} onChange={(e) => change({ sender: e.target.value as Input['sender'] })}>
            {Object.entries(SENDERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>
          <span className="small">행사 목적</span>
          <select aria-label="시험 목적" value={input.purpose} disabled={pending} onChange={(e) => change({ purpose: e.target.value as Input['purpose'] })}>
            {Object.entries(PURPOSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>

      <button className="btn small" disabled={!ready || pending} onClick={() => start(async () => {
        setError(''); setResult(null);
        try { setResult(await testPilotEvent(productNo, input)); }
        catch (e) { setError(e instanceof Error ? e.message : '시험하지 못했습니다.'); }
      })}>
        {pending ? '적합성 판정 중…' : '행사 적합성 확인'}
      </button>

      {!ready && <p className="small muted" style={{ marginTop: 8 }}>먼저 위의 [확인하고 계산하기]를 눌러 상품 희소값을 확정해 주세요.</p>}
      {error && <p className="notice" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      {ready && result && (
        <div className="notice" role="status" style={{ marginTop: 16, background: result.allowed ? 'var(--green-weak, #eaf5ea)' : 'var(--red-weak, #fdf0f0)', borderColor: result.allowed ? 'var(--green, #2e7d32)' : 'var(--red, #d32f2f)' }}>
          <b style={{ color: result.allowed ? 'var(--green, #2e7d32)' : 'var(--red, #d32f2f)' }}>
            {result.allowed ? '✓ 행사 기준 충족 (적격 후보)' : '✗ 행사 기준 미충족 (후보 제외)'}
          </b>
          <p style={{ margin: '6px 0' }}>{result.reason}</p>
          <p className="small">
            행사 격식 점수: <b>{result.eventScore}점</b> · 상품 희소값: <b>{(result.rarity * 100).toFixed(0)}점</b> · 허용 기준 구간: <b>{(result.min * 100).toFixed(0)}~{(result.max * 100).toFixed(0)}점</b>
          </p>
          {result.incomplete && <p className="small" style={{ color: 'var(--red)' }}>발신 주체 또는 행사 목적이 미입력 상태입니다.</p>}
          <p className="small muted" style={{ marginTop: 8, borderTop: '1px dashed #ccc', paddingTop: 6 }}>
            * 특허출원서 구조에 따른 1차 적격 후보 필터링 결과입니다. 실제 고객 추천 순위는 가격 실속, 신뢰, 실용성 등을 종합 평가하여 상위 3개를 선정합니다. 전체 카탈로그 시뮬레이션은 <a href="/admin/formality/lab" className="text-link">격식 기준 검증실</a>에서 확인할 수 있습니다.
          </p>
        </div>
      )}
    </section>
  );
}
