'use client';

import { useEffect, useState, useTransition } from 'react';
import { OCCASIONS, PURPOSES, SENDERS, type FormalityInput } from '@/engine/eligibility.ts';
import type { RecommendedScenario } from '@/engine/formality-intake.ts';
import { getTopEventScenariosAction, testPilotEvent } from './intake-actions.ts';

const relations = { senior: '상급자/어르신', business: '거래처/공식', peer: '동료/친구', family: '가족/친밀' } as const;
type Input = Pick<FormalityInput, 'event' | 'relation' | 'sender' | 'purpose'>;
type Result = Awaited<ReturnType<typeof testPilotEvent>>;

export function EventTest({ productNo, ready }: { productNo: number; ready: boolean }) {
  const [input, setInput] = useState<Input>({ event: 'ceremony', relation: 'business', sender: 'public', purpose: 'return' });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const [topState, setTopState] = useState<{
    status: 'idle' | 'loading' | 'success' | 'empty' | 'error';
    error?: string;
    scenarios: RecommendedScenario[];
  }>({ status: 'idle', scenarios: [] });

  // 검수 완료 시 자동으로 적격 행사 예시(최대 3개)를 분석하여 표시
  useEffect(() => {
    let ignore = false;
    if (!ready) {
      setTopState({ status: 'idle', scenarios: [] });
      setResult(null);
      return;
    }

    setTopState({ status: 'loading', scenarios: [] });
    getTopEventScenariosAction(productNo)
      .then((items) => {
        if (!ignore) {
          if (!items || items.length === 0) {
            setTopState({ status: 'empty', scenarios: [] });
          } else {
            setTopState({ status: 'success', scenarios: items });
          }
        }
      })
      .catch((e) => {
        if (!ignore) {
          setTopState({
            status: 'error',
            error: e instanceof Error ? e.message : '행사 예시를 불러오지 못했습니다.',
            scenarios: [],
          });
        }
      });

    return () => {
      ignore = true;
    };
  }, [productNo, ready]);

  function retryTopScenarios() {
    setTopState({ status: 'loading', scenarios: [] });
    getTopEventScenariosAction(productNo)
      .then((items) => {
        if (!items || items.length === 0) {
          setTopState({ status: 'empty', scenarios: [] });
        } else {
          setTopState({ status: 'success', scenarios: items });
        }
      })
      .catch((e) => {
        setTopState({
          status: 'error',
          error: e instanceof Error ? e.message : '행사 예시를 불러오지 못했습니다.',
          scenarios: [],
        });
      });
  }

  function change(patch: Partial<Input>) {
    setInput((value) => ({ ...value, ...patch }));
    setResult(null);
    setError('');
  }

  function applyScenario(s: RecommendedScenario) {
    setInput({
      event: s.event,
      relation: s.relation,
      sender: s.sender,
      purpose: s.purpose,
    });
    setResult(null);
    setError('');
  }

  return (
    <section className="panel intake-section" style={{ marginTop: 20 }} aria-label="3단계 행사 적합성 확인">
      <div className="spread intake-section-title">
        <div>
          <h2>3. 행사 적합성 확인</h2>
          <p className="small muted">
            상품 희소값을 바탕으로 기준을 충족하는 행사 예시를 확인하고, 특정 행사 조건에 대해 허용 기준 충족 여부를 직접 시험합니다.
          </p>
        </div>
      </div>

      {/* 기준 통과 행사 예시 영역 */}
      <div className="top-scenarios-section" style={{ marginBottom: 24 }}>
        <div className="spread" style={{ alignItems: 'baseline', marginBottom: 10 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>
            기준 통과 행사 예시 <span className="small muted">(최대 3개 · 검토용 예시)</span>
          </h3>
          <span className="small muted">
            * 고객 추천 순위가 아닌, 상품의 희소 속성이 행사 허용 기준을 통과한 검토용 예시입니다.
          </span>
        </div>

        {!ready ? (
          <div className="notice" style={{ background: 'var(--surface-sunken, #f8f9fa)', margin: 0 }}>
            <p className="small muted" style={{ margin: 0 }}>
              💡 위의 <b>[격식지수 판정하기 (검수 완료)]</b>를 완료하면 이 상품이 기준을 충족하는 행사 예시(최대 3개)를 자동으로 보여드립니다.
            </p>
          </div>
        ) : topState.status === 'loading' ? (
          <div className="notice" style={{ margin: 0 }}>
            <span className="small muted">행사 적격 예시를 분석하는 중…</span>
          </div>
        ) : topState.status === 'error' ? (
          <div className="notice" style={{ margin: 0, background: 'var(--red-weak, #fdf0f0)', borderColor: 'var(--red, #d32f2f)' }}>
            <p className="small" style={{ margin: '0 0 6px', color: 'var(--red, #d32f2f)' }}>
              ✗ 행사 예시 조회 실패: {topState.error}
            </p>
            <button type="button" className="btn ghost small" style={{ fontSize: 12, padding: '3px 8px' }} onClick={retryTopScenarios}>
              다시 시도
            </button>
          </div>
        ) : topState.status === 'empty' ? (
          <div className="notice" style={{ margin: 0 }}>
            <p className="small muted" style={{ margin: 0 }}>
              허용 기준을 충족하는 행사 예시가 없습니다. (희소 기준 미달이거나 모든 행사 조건이 제외 설정됨)
            </p>
          </div>
        ) : (
          <div className="top-scenarios-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {topState.scenarios.map((sc, idx) => (
              <div
                key={`${sc.event}-${sc.relation}-${sc.sender}-${sc.purpose}`}
                className="top-scenario-card"
                style={{
                  border: '1px solid var(--line-strong, #ccc)',
                  borderRadius: 8,
                  padding: 12,
                  background: 'var(--surface, #fff)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div>
                  <div className="row" style={{ gap: 6, marginBottom: 4, alignItems: 'center' }}>
                    <span className="pill" style={{ background: 'var(--pine-weak, #e8f3ed)', color: 'var(--pine-deep, #1b4d3e)', fontSize: 11, fontWeight: 700 }}>
                      예시 {idx + 1}
                    </span>
                    <span className="small" style={{ fontWeight: 600 }}>{OCCASIONS[sc.event]}</span>
                  </div>
                  <b style={{ fontSize: 14, display: 'block', lineHeight: 1.4, color: 'var(--pine-deep, #1b4d3e)' }}>
                    {sc.headline}
                  </b>
                  <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.35 }}>
                    {sc.reason}
                  </p>
                </div>
                <div style={{ borderTop: '1px dashed var(--line, #eee)', paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="small muted" style={{ fontSize: 11 }}>
                    행사 격식 {sc.eventScore}점 · 허용 희소 {Math.round(sc.band.min * 100)}~{Math.round(sc.band.max * 100)}점
                  </span>
                  <button
                    type="button"
                    className="btn ghost small"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => applyScenario(sc)}
                    title="아래 직접 시험 조건에 채워 넣기"
                  >
                    직접 시험에 적용 ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 수동 특정 조건 시험 */}
      <div style={{ borderTop: '1px solid var(--line, #eee)', paddingTop: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>특정 행사 조건 직접 시험</h3>
        <p className="small muted" style={{ marginBottom: 12 }}>
          원하는 조건(행사 종류·받는 분·보내는 주체·행사 목적)을 선택하여 이 상품이 허용 기준을 충족하는지 확인합니다.
        </p>

        <div className="event-test-fields" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
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

        {!ready && <p className="small muted" style={{ marginTop: 8 }}>먼저 위의 [격식지수 판정하기 (검수 완료)]를 눌러 상품 희소값을 확정해 주세요.</p>}
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
      </div>
    </section>
  );
}
