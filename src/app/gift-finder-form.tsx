'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { forgetLastQuery, loadLastQuery, type LastQuery } from '@/lib/device.ts';
import { QtyInput } from './components/qty-input.tsx';
import { BUDGET_STEPS, budgetChipText, budgetText, clampQty, perItemBudget, resultHref, won } from '@/lib/result-query.ts';

type Option = { id: string; name: string };

// 경조사 봉투에 쓰는 글자를 행사 표지로 쓴다
const HANJA: Record<string, string> = {
  funeral: '弔', wedding: '婚', longevity: '壽', birth: '誕', promotion: '榮', opening: '開', thanks: '謝', birthday: '生',
};

const QUICK_ADD = [10, 50, 100];
const MAX_TOTAL_DIGITS = 10; // 99억 원. 입력칸은 숫자만 (쉼표를 넣으면 중간을 고칠 때 커서가 끝으로 튄다)

export function GiftFinderForm({ events, relations, initial }: { events: Option[]; relations: Option[]; initial?: LastQuery | null }) {
  const router = useRouter();
  const [event, setEvent] = useState<string | null>(initial?.event ?? null);
  const [relation, setRelation] = useState<string | null>(initial?.relation ?? null);
  // 예산은 1개당으로 고르거나, 전체 예산을 넣으면 수량으로 나눠 1개당 예산을 잡는다.
  // 결과에서 돌아온 예산이 칩에 없는 값(전체 예산으로 계산한 값)이면 그 값을 칩 하나로 더해 고른 채로 둔다
  const budgetSteps = initial?.budget != null && !BUDGET_STEPS.includes(initial.budget) ? [initial.budget, ...BUDGET_STEPS] : BUDGET_STEPS;
  const [budgetMode, setBudgetMode] = useState<'each' | 'total'>('each');
  const [budget, setBudget] = useState<number | null>(initial ? initial.budget : 50000);
  const [total, setTotal] = useState('');
  const [quantity, setQuantity] = useState(initial?.qty ?? 10);
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<LastQuery | null>(null);

  // 지난 조건은 이 기기에만 있으므로 화면을 그린 뒤 읽는다 (서버 화면과 어긋나지 않게)
  useEffect(() => {
    const q = loadLastQuery();
    if (!initial && q && events.some((e) => e.id === q.event) && relations.some((r) => r.id === q.relation)) setLast(q);
  }, [events, relations, initial]);

  const totalWon = Number(total) || 0;
  const effectiveBudget = budgetMode === 'each' ? budget : perItemBudget(totalWon, quantity);
  const budgetReady = budgetMode === 'each' || effectiveBudget !== null;
  const ready = event !== null && relation !== null && quantity > 0 && budgetReady;
  const setQty = (n: number) => setQuantity(clampQty(n));

  function submit() {
    if (!ready || event === null || relation === null) return;
    setPending(true);
    router.push(resultHref({ event, relation, budget: effectiveBudget, qty: quantity, exclude: [] }));
  }

  const nameOf = (list: Option[], id: string | null) => list.find((x) => x.id === id)?.name;
  const eventName = nameOf(events, event);
  const relationName = nameOf(relations, relation);

  return (
    <div>
      {last && (
        <div className="resume-card">
          <a href={resultHref({ ...last, exclude: [] })}>
            <span className="resume-label">지난번 조건으로 보기</span>
            <span className="resume-detail">
              {nameOf(events, last.event)} · {nameOf(relations, last.relation)} · {budgetChipText(last.budget)} · {last.qty.toLocaleString('ko-KR')}개
            </span>
          </a>
          <button type="button" aria-label="지난번 조건 지우기" onClick={() => { forgetLastQuery(); setLast(null); }}>×</button>
        </div>
      )}

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
        <div className="spread" style={{ alignItems: 'baseline' }}>
          <h2 className="step-label"><span className="step-no">3</span>예산</h2>
          <div className="seg" role="group" aria-label="예산 정하는 방법">
            <button type="button" aria-pressed={budgetMode === 'each'} onClick={() => setBudgetMode('each')}>1개당</button>
            <button type="button" aria-pressed={budgetMode === 'total'} onClick={() => setBudgetMode('total')}>전체 예산</button>
          </div>
        </div>
        {budgetMode === 'each' ? (
          <div className="chips">
            {budgetSteps.map((b) => (
              <button key={String(b)} type="button" className="chip" aria-pressed={budget === b} onClick={() => setBudget(b)}>
                {b === null ? '상관없음' : budgetText(b)}
              </button>
            ))}
          </div>
        ) : (
          <div className="total-budget">
            <label className="money-input">
              <span className="sr-only">전체 예산</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                placeholder="예: 1500000"
                value={total}
                onChange={(e) => setTotal(e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_TOTAL_DIGITS))}
              />
              <span aria-hidden>원</span>
            </label>
            <p className="small" style={{ margin: '8px 0 0', color: effectiveBudget ? 'var(--ink-soft)' : 'var(--muted)' }} aria-live="polite">
              {effectiveBudget
                ? <>{won(totalWon)} ÷ {quantity.toLocaleString('ko-KR')}개 = <b>1개당 {won(effectiveBudget)} 이하</b>로 찾아요</>
                : '행사 전체에 쓸 금액을 넣으면 수량으로 나눠 1개당 예산을 잡아 드려요'}
            </p>
          </div>
        )}
      </section>

      <section className="step">
        <h2 className="step-label"><span className="step-no">4</span><label htmlFor="qty">수량</label><span className="hint">받는 분 수만큼</span></h2>
        <div className="row" style={{ gap: 10 }}>
          <div className="stepper">
            <button type="button" aria-label="수량 줄이기" onClick={() => setQty(quantity - (quantity > 10 ? 10 : 1))}>−</button>
            <QtyInput id="qty" value={quantity} onValue={setQty} />
            <button type="button" aria-label="수량 늘리기" onClick={() => setQty(quantity + (quantity >= 10 ? 10 : 1))}>+</button>
          </div>
          <div className="chips quick-add">
            {QUICK_ADD.map((n) => (
              <button key={n} type="button" className="chip" aria-label={`수량 ${n}개 더하기`} onClick={() => setQty(quantity + n)}>+{n}</button>
            ))}
          </div>
        </div>
      </section>

      <div className="sticky-cta">
        <p className="summary-line" aria-live="polite">
          {ready ? (
            <><b>{eventName}</b>, {relationName}, {budgetChipText(effectiveBudget)}, {quantity.toLocaleString('ko-KR')}개</>
          ) : !event ? '어떤 자리인지 먼저 골라 주세요'
            : !relation ? '받는 분과의 관계를 골라 주세요'
            : totalWon > 0 ? '전체 예산이 수량보다 적어요. 금액이나 수량을 확인해 주세요'
            : '전체 예산을 넣어 주세요'}
        </p>
        <button type="button" className="btn block" disabled={!ready || pending} onClick={submit}>
          {pending ? '고르는 중…' : '답례품 세 가지 추천받기'}
        </button>
      </div>
    </div>
  );
}
