'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Option = { id: string; name: string };

// 경조사 봉투에 쓰는 글자를 행사 표지로 쓴다
const HANJA: Record<string, string> = {
  funeral: '弔', wedding: '婚', longevity: '壽', birth: '誕', promotion: '榮', opening: '開', thanks: '謝', birthday: '生',
};

const BUDGETS: { value: number | null; label: string }[] = [
  { value: 30000, label: '3만 원 이하' },
  { value: 50000, label: '5만 원 이하' },
  { value: 100000, label: '10만 원 이하' },
  { value: 200000, label: '20만 원 이하' },
  { value: null, label: '상관없음' },
];

const MAX_QTY = 100000;

export function GiftFinderForm({ events, relations }: { events: Option[]; relations: Option[] }) {
  const router = useRouter();
  const [event, setEvent] = useState<string | null>(null);
  const [relation, setRelation] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(50000);
  const [quantity, setQuantity] = useState(10);
  const [pending, setPending] = useState(false);

  const ready = event !== null && relation !== null && quantity > 0;
  const setQty = (n: number) => setQuantity(Math.min(MAX_QTY, Math.max(1, Math.round(n) || 1)));

  function submit() {
    if (!ready) return;
    const params = new URLSearchParams({ event, relation, qty: String(quantity) });
    if (budget !== null) params.set('budget', String(budget));
    setPending(true);
    router.push(`/result?${params}`);
  }

  const eventName = events.find((e) => e.id === event)?.name;
  const relationName = relations.find((r) => r.id === relation)?.name;
  const budgetLabel = BUDGETS.find((b) => b.value === budget)?.label;

  return (
    <div>
      <section className="step">
        <h2 className="step-label"><span className="step-no">1</span>어떤 자리인가요?</h2>
        <div className="occasion-grid">
          {events.map((e) => (
            <button key={e.id} type="button" className="occasion" aria-pressed={event === e.id} onClick={() => setEvent(e.id)}>
              <span className="hanja" aria-hidden>{HANJA[e.id] ?? '禮'}</span>
              {e.name}
            </button>
          ))}
        </div>
      </section>

      <section className="step">
        <h2 className="step-label"><span className="step-no">2</span>받는 분과의 관계</h2>
        <div className="choice-list" role="group" aria-label="받는 분과의 관계">
          {relations.map((r) => (
            <button key={r.id} type="button" aria-pressed={relation === r.id} onClick={() => setRelation(r.id)}>
              {r.name}
              <span className="tick" aria-hidden />
            </button>
          ))}
        </div>
      </section>

      <section className="step">
        <h2 className="step-label"><span className="step-no">3</span>1개당 예산</h2>
        <div className="chips">
          {BUDGETS.map((b) => (
            <button key={b.label} type="button" className="chip" aria-pressed={budget === b.value} onClick={() => setBudget(b.value)}>
              {b.label}
            </button>
          ))}
        </div>
      </section>

      <section className="step">
        <h2 className="step-label"><span className="step-no">4</span><label htmlFor="qty">수량</label><span className="hint">받는 분 수만큼</span></h2>
        <div className="stepper">
          <button type="button" aria-label="수량 줄이기" onClick={() => setQty(quantity - (quantity > 10 ? 10 : 1))}>−</button>
          <input id="qty" type="number" inputMode="numeric" min={1} max={MAX_QTY} value={quantity} onChange={(e) => setQty(Number(e.target.value))} />
          <button type="button" aria-label="수량 늘리기" onClick={() => setQty(quantity + (quantity >= 10 ? 10 : 1))}>+</button>
        </div>
      </section>

      <div className="sticky-cta">
        <p className="summary-line" aria-live="polite">
          {ready ? (
            <><b>{eventName}</b>, {relationName}, {budgetLabel === '상관없음' ? '예산 상관없음' : `1개 ${budgetLabel}`}, {quantity.toLocaleString('ko-KR')}개</>
          ) : event ? '받는 분과의 관계를 골라 주세요' : '어떤 자리인지 먼저 골라 주세요'}
        </p>
        <button type="button" className="btn block" disabled={!ready || pending} onClick={submit}>
          {pending ? '고르는 중…' : '답례품 세 가지 추천받기'}
        </button>
      </div>
    </div>
  );
}
