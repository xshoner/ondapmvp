'use client';

import { useState } from 'react';
import type { Budget, EventId, RecommendationRequest, RelationId } from '../../recommendation/contracts.ts';
import { EVENT_NAMES, RELATION_NAMES, won } from './types.ts';

const HANJA: Record<EventId, string> = {
  funeral: '弔',
  wedding: '婚',
  longevity: '壽',
  birth: '誕',
  promotion: '榮',
  opening: '開',
  thanks: '謝',
  birthday: '生',
  ceremony: '禮',
  conference: '會',
  anniversary: '創',
  holiday: '節',
};

const BUDGET_PRESETS = [30000, 50000, 70000, 100000];
const QUICK_ADD = [10, 50, 100];

export interface FinderFormProps {
  initialRequest?: Partial<RecommendationRequest>;
  onSubmit: (request: RecommendationRequest) => void;
  loading?: boolean;
}

export function CoreFinderForm({ initialRequest, onSubmit, loading = false }: FinderFormProps) {
  const [event, setEvent] = useState<EventId>(initialRequest?.event ?? 'wedding');
  const [relation, setRelation] = useState<RelationId>(initialRequest?.relation ?? 'business');

  // 예산 모드: 'per_item' | 'total' | 'none'
  const initialMode = initialRequest?.budget?.mode ?? 'per_item';
  const [budgetMode, setBudgetMode] = useState<'per_item' | 'total' | 'none'>(initialMode);

  // 1개당 예산
  const [perItemBudget, setPerItemBudget] = useState<number>(
    initialRequest?.budget?.mode === 'per_item' ? initialRequest.budget.amount : 50000,
  );

  // 전체 예산 (원본 보존용 문자열/숫자)
  const [totalBudgetInput, setTotalBudgetInput] = useState<string>(
    initialRequest?.budget?.mode === 'total' ? String(initialRequest.budget.amount) : '500000',
  );

  // 수량
  const [quantity, setQuantity] = useState<number>(initialRequest?.quantity ?? 10);

  const totalBudgetAmount = Number(totalBudgetInput.replace(/\D/g, '')) || 0;

  const handleQtyChange = (val: number) => {
    const next = Math.max(1, Math.min(100000, Math.floor(val)));
    setQuantity(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let budget: Budget;
    if (budgetMode === 'none') {
      budget = { mode: 'none' };
    } else if (budgetMode === 'total') {
      budget = { mode: 'total', amount: totalBudgetAmount };
    } else {
      budget = { mode: 'per_item', amount: perItemBudget };
    }

    onSubmit({
      event,
      relation,
      quantity,
      budget,
      excludedProductNos: initialRequest?.excludedProductNos ?? [],
      sender: initialRequest?.sender ?? 'unknown',
      purpose: initialRequest?.purpose ?? 'unknown',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="finder-form card" style={{ padding: 20, marginBottom: 24 }}>
      {/* 1. 어떤 자리인가요? */}
      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>
          <span style={{ color: 'var(--pine, #2D5A43)', marginRight: 6 }}>1</span>어떤 자리인가요?
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 }}>
          {(Object.entries(EVENT_NAMES) as [EventId, string][]).map(([id, name]) => {
            const active = event === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setEvent(id)}
                style={{
                  padding: '8px 4px',
                  borderRadius: 6,
                  border: active ? '2px solid var(--pine, #2D5A43)' : '1px solid var(--line, #E6E1D8)',
                  background: active ? 'var(--pine, #2D5A43)' : '#FFF',
                  color: active ? '#FFF' : 'var(--ink, #333)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 16, opacity: active ? 0.9 : 0.6 }}>{HANJA[id] ?? '禮'}</span>
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. 받는 분과의 관계 */}
      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>
          <span style={{ color: 'var(--pine, #2D5A43)', marginRight: 6 }}>2</span>받는 분과의 관계
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {(Object.entries(RELATION_NAMES) as [RelationId, string][]).map(([id, name]) => {
            const active = relation === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setRelation(id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: active ? '2px solid var(--pine, #2D5A43)' : '1px solid var(--line, #E6E1D8)',
                  background: active ? 'var(--pine, #2D5A43)' : '#FFF',
                  color: active ? '#FFF' : 'var(--ink, #333)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. 예산 설정 */}
      <section style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            <span style={{ color: 'var(--pine, #2D5A43)', marginRight: 6 }}>3</span>예산
          </h3>
          <div style={{ display: 'flex', border: '1px solid var(--line, #E6E1D8)', borderRadius: 6, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setBudgetMode('per_item')}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                border: 'none',
                background: budgetMode === 'per_item' ? 'var(--pine, #2D5A43)' : '#FFF',
                color: budgetMode === 'per_item' ? '#FFF' : 'var(--ink-soft, #555)',
                cursor: 'pointer',
                fontWeight: budgetMode === 'per_item' ? 600 : 400,
              }}
            >
              1개당
            </button>
            <button
              type="button"
              onClick={() => setBudgetMode('total')}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                border: 'none',
                borderLeft: '1px solid var(--line, #E6E1D8)',
                borderRight: '1px solid var(--line, #E6E1D8)',
                background: budgetMode === 'total' ? 'var(--pine, #2D5A43)' : '#FFF',
                color: budgetMode === 'total' ? '#FFF' : 'var(--ink-soft, #555)',
                cursor: 'pointer',
                fontWeight: budgetMode === 'total' ? 600 : 400,
              }}
            >
              전체 예산
            </button>
            <button
              type="button"
              onClick={() => setBudgetMode('none')}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                border: 'none',
                background: budgetMode === 'none' ? 'var(--pine, #2D5A43)' : '#FFF',
                color: budgetMode === 'none' ? '#FFF' : 'var(--ink-soft, #555)',
                cursor: 'pointer',
                fontWeight: budgetMode === 'none' ? 600 : 400,
              }}
            >
              예산 없음
            </button>
          </div>
        </div>

        {budgetMode === 'per_item' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {BUDGET_PRESETS.map((amt) => {
              const active = perItemBudget === amt;
              return (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setPerItemBudget(amt)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 20,
                    border: active ? '2px solid var(--pine, #2D5A43)' : '1px solid var(--line, #E6E1D8)',
                    background: active ? '#ECFDF5' : '#FFF',
                    color: active ? 'var(--pine, #2D5A43)' : 'var(--ink, #333)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {won(amt)} 이하
                </button>
              );
            })}
          </div>
        )}

        {budgetMode === 'total' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                inputMode="numeric"
                value={totalBudgetInput}
                onChange={(e) => setTotalBudgetInput(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="예: 500000"
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--line, #E6E1D8)',
                  fontSize: 16,
                  width: '100%',
                  maxWidth: 200,
                }}
              />
              <span style={{ fontSize: 14 }}>원</span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-soft, #666)' }}>
              {totalBudgetAmount > 0
                ? `${won(totalBudgetAmount)} ÷ ${quantity}개 = 1개당 약 ${won(Math.floor(totalBudgetAmount / quantity))} 기준`
                : '전체 행사 총예산을 입력해 주세요.'}
            </p>
          </div>
        )}

        {budgetMode === 'none' && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted, #666)' }}>
            ※ 예산 한도 없이 행사 격식과 적합도(E)만을 기준으로 추천합니다. 가격 실속(V)은 미평가됩니다.
          </p>
        )}
      </section>

      {/* 4. 수량 */}
      <section style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>
          <span style={{ color: 'var(--pine, #2D5A43)', marginRight: 6 }}>4</span>수량
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line, #E6E1D8)', borderRadius: 6 }}>
            <button
              type="button"
              onClick={() => handleQtyChange(quantity - 1)}
              style={{ width: 36, height: 36, border: 'none', background: '#FFF', fontSize: 18, cursor: 'pointer' }}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={100000}
              value={quantity}
              onChange={(e) => handleQtyChange(Number(e.target.value))}
              style={{
                width: 60,
                height: 36,
                textAlign: 'center',
                border: 'none',
                borderLeft: '1px solid var(--line, #E6E1D8)',
                borderRight: '1px solid var(--line, #E6E1D8)',
                fontSize: 16,
                fontWeight: 600,
              }}
            />
            <button
              type="button"
              onClick={() => handleQtyChange(quantity + 1)}
              style={{ width: 36, height: 36, border: 'none', background: '#FFF', fontSize: 18, cursor: 'pointer' }}
            >
              +
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {QUICK_ADD.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleQtyChange(quantity + n)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 16,
                  border: '1px solid var(--line, #E6E1D8)',
                  background: '#FFF',
                  fontSize: 12,
                  color: 'var(--ink-soft, #555)',
                  cursor: 'pointer',
                }}
              >
                +{n}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 제출 버튼: 요구사항 6번 "무조건 추천 3개 같은 고정 문구 금지" 준수 */}
      <button
        type="submit"
        disabled={loading}
        className="btn block"
        style={{
          width: '100%',
          padding: '14px',
          borderRadius: 8,
          background: 'var(--pine, #2D5A43)',
          color: '#FFF',
          border: 'none',
          fontSize: 16,
          fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? '추천 계산 중…' : '답례품 추천받기'}
      </button>
    </form>
  );
}
