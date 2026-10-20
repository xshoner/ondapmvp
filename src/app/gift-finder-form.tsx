'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Option = { id: string; name: string };

const BUDGETS: { value: number | null; label: string }[] = [
  { value: 30000, label: '3만 원 이하' },
  { value: 50000, label: '5만 원 이하' },
  { value: 100000, label: '10만 원 이하' },
  { value: 200000, label: '20만 원 이하' },
  { value: null, label: '상관없음' },
];

export function GiftFinderForm({ events, relations }: { events: Option[]; relations: Option[] }) {
  const router = useRouter();
  const [event, setEvent] = useState<string | null>(null);
  const [relation, setRelation] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(50000);
  const [quantity, setQuantity] = useState(10);
  const [pending, setPending] = useState(false);

  const ready = event !== null && relation !== null && quantity > 0;

  function submit() {
    if (!ready) return;
    const params = new URLSearchParams({ event, relation, qty: String(quantity) });
    if (budget !== null) params.set('budget', String(budget));
    setPending(true);
    router.push(`/result?${params}`);
  }

  return (
    <div>
      <div className="step">
        <div className="step-label">1. 어떤 자리인가요?</div>
        <div className="chips">
          {events.map((e) => (
            <button key={e.id} type="button" className="chip" aria-pressed={event === e.id} onClick={() => setEvent(e.id)}>
              {e.name}
            </button>
          ))}
        </div>
      </div>

      <div className="step">
        <div className="step-label">2. 받는 분은 어떤 관계인가요?</div>
        <div className="chips">
          {relations.map((r) => (
            <button key={r.id} type="button" className="chip" aria-pressed={relation === r.id} onClick={() => setRelation(r.id)}>
              {r.name}
            </button>
          ))}
        </div>
      </div>

      <div className="step">
        <div className="step-label">3. 1개당 예산</div>
        <div className="chips">
          {BUDGETS.map((b) => (
            <button key={b.label} type="button" className="chip" aria-pressed={budget === b.value} onClick={() => setBudget(b.value)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="step">
        <label className="step-label" htmlFor="qty">4. 수량</label>
        <input
          id="qty"
          className="num-input"
          type="number"
          inputMode="numeric"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(0, Number(e.target.value)))}
        />
      </div>

      <div className="sticky-cta">
        <button type="button" className="btn block" disabled={!ready || pending} onClick={submit}>
          {pending ? '고르는 중…' : '내 상황에 맞는 선물 찾기'}
        </button>
      </div>
    </div>
  );
}
